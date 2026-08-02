---
name: audio-only-download
overview: 为 B站视频下载扩展新增「仅下载音频」模式，在 popup 中增加视频/音频模式切换，后端跳过视频流下载和合并步骤，仅保存音频流并通过 ffmpeg 转换为 M4A 格式。
todos:
  - id: modify-server-audio
    content: 修改 server.py：DownloadRequest 增加 download_mode 字段，_do_download 增加纯音频下载分支
    status: completed
  - id: modify-background-audio
    content: 修改 background.js：startDownload 增加 downloadMode 参数并传递到后端
    status: completed
  - id: modify-popup-html-audio
    content: 修改 popup.html：在画质选择下方增加下载模式选择器（视频+音频 / 仅音频）
    status: completed
  - id: modify-popup-css-audio
    content: 修改 popup.css：增加模式选择器样式
    status: completed
    dependencies:
      - modify-popup-html-audio
  - id: modify-popup-js-audio
    content: 修改 popup.js：增加 downloadMode 状态管理、持久化和下载传递
    status: completed
    dependencies:
      - modify-background-audio
      - modify-popup-html-audio
---

## 用户需求

在现有B站视频下载扩展中增加"单独只下载音频"功能。用户可以选择仅下载视频的音频流，保存为独立的音频文件（M4A格式），无需下载视频流。

## 核心功能

- 在popup弹窗中增加下载模式选择器，提供"视频+音频"和"仅音频"两种模式
- 选择"仅音频"时，后端仅下载DASH格式的音频流，不下载视频流
- 使用ffmpeg将下载的`.m4s`音频文件无损remux为`.m4a`格式（`-c:a copy`，不重新编码，速度快）
- 输出文件名使用`{视频标题}_audio.m4a`命名
- 旧格式视频（durl，音视频已合并）不支持纯音频提取，后端返回明确错误提示
- 下载模式通过消息链（popup → background → backend）传递，后端负责判断和分流

## 技术栈

- 后端：Python FastAPI + httpx + ffmpeg
- 前端：Chrome Extension Manifest V3 (JavaScript)
- 存储：chrome.storage.local（下载模式持久化）

## 实现方案

### 整体策略

在DownloadRequest模型中新增`download_mode`字段（默认"video"）。当值为"audio"时，`_do_download`跳过视频流下载环节，仅下载音频流，然后用ffmpeg无损remux输出M4A文件。UI层添加单选按钮组让用户切换模式。

### 数据流

```
用户选择模式 → state.downloadMode更新 + chrome.storage持久化
    → 点击下载 → runtimeSendMessage({downloadMode})
    → background.js → POST /api/download {download_mode}
    → server.py _do_download 根据 download_mode 分流:
        "video": 现有逻辑（下载视频+音频+合并）
        "audio": 仅下载音频 → ffmpeg remux → .m4a
```

### 关键设计决策

- **音频输出格式选择M4A**：B站DASH音频流为AAC编码的MP4容器（MIME: audio/mp4），M4A是最通用的AAC音频容器，无需重新编码，`ffmpeg -i audio.m4s -c:a copy output.m4a`极快
- **durl旧格式拒绝策略**：旧格式音视频已混合为一个流，无法无损分离，后端返回明确错误告知用户，不做降级处理（降级会导致下载整个视频后再提取音轨，用户体验差）
- **模式持久化**：使用`chrome.storage.local`的`downloadMode`键持久化用户选择，打开popup时自动恢复
- **不新增ffmpeg新函数**：复用现有的音频文件头，将remux逻辑内联到`_do_download`中（仅2行ffmpeg命令），保持代码简洁

## 需要修改的文件

```
G:\bilibili-downloader\
├── backend\
│   └── server.py              # [MODIFY] DownloadRequest 增加 download_mode；_do_download 增加纯音频下载分支
├── extension\
│   ├── background.js           # [MODIFY] startDownload 增加 downloadMode 参数传递
│   ├── popup.html              # [MODIFY] 画质选择下方增加下载模式选择器
│   ├── popup.css               # [MODIFY] 增加模式选择器样式
│   └── popup.js                # [MODIFY] 增加 downloadMode 状态管理、持久化和传递
```

## 实现细节

### server.py 关键变更

1. `DownloadRequest` (第99行) 新增字段 `download_mode: str = "video"`
2. `_do_download` (第262行) 在获取到`audio_url`后增加判断：

```python
# 纯音频模式
if req.download_mode == "audio":
    if not audio_url:
        raise Exception("此视频为旧格式（音视频已合并），不支持纯音频下载，请选择'视频+音频'模式")
    
    audio_tmp = output_dir / f"{task_id}_audio.m4s"
    safe_title = safe_filename(req.title)
    output_filename = f"{safe_title}_audio.m4a"
    output_path = output_dir / output_filename
    
    task["status"] = "downloading_audio"
    task["message"] = "正在下载音频流..."
    task["progress"] = 0.1
    await _download_file(client, audio_url, audio_tmp, headers, task, 0.1, 0.85)
    
    task["status"] = "processing"
    task["message"] = "正在转换为 M4A..."
    task["progress"] = 0.85
    
    # ffmpeg 无损 remux: m4s → m4a
    cmd = [FFMPEG_PATH, "-y", "-i", str(audio_tmp), "-c:a", "copy", str(output_path)]
    process = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    _, __ = await process.communicate()
    audio_tmp.unlink(missing_ok=True)
    
    if process.returncode != 0:
        raise Exception("音频转换失败")
```

3. 当`download_mode != "audio"`时，保持现有的音视频合并逻辑不变。

### background.js 变更

- `startDownload` 函数签名增加 `downloadMode` 参数
- JSON body 增加 `download_mode: downloadMode || 'video'`

### popup.html 变更

- 在"画质选择"section下方，新增"下载模式"section
- 包含两个单选按钮：`label` 包裹 `input[type=radio]` + 文字，水平排列
- HTML结构参考：

```html
<div class="section" id="mode-section">
  <label class="section-label">下载模式</label>
  <div class="mode-selector">
    <label class="mode-option active">
      <input type="radio" name="download-mode" value="video" checked>
      <span>视频+音频</span>
    </label>
    <label class="mode-option">
      <input type="radio" name="download-mode" value="audio">
      <span>仅音频</span>
    </label>
  </div>
</div>
```

### popup.js 变更

- state 增加 `downloadMode: 'video'`
- 初始化时从 `chrome.storage.local` 读取 `downloadMode`
- 为 radio 按钮绑定 `change` 事件，更新 state 并持久化到 storage
- `startDownload` 传递 `downloadMode: state.downloadMode`

### popup.css 变更

- `.mode-selector`：flex 水平布局，gap间距
- `.mode-option`：圆角边框、padding、cursor:pointer、过渡动画
- `.mode-option.active`：选中态高亮（使用B站粉色 `#FB7299` 边框+浅背景）
- 隐藏原生 radio 按钮，用 label 样式代替

### 性能与可靠性

- 纯音频下载比视频+音频下载快很多（音频流通常只有几MB），不增加额外I/O开销
- ffmpeg remux使用`-c:a copy`，无重新编码，速度极快（通常<1秒）
- 对durl旧格式的拒绝在早期抛出异常，避免下载到一半才发现不支持
- 临时文件清理逻辑保持完整（`unlink(missing_ok=True)`）