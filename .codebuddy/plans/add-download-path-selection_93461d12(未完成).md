---
name: add-download-path-selection
overview: 为 B站下载器扩展增加自定义下载路径功能：popup 界面添加路径输入框（持久化到 chrome.storage），后端支持自定义输出目录并提供"打开文件夹"API
todos:
  - id: modify-server
    content: 修改 server.py：DownloadRequest 增加 download_path 字段，_do_download 使用自定义路径，新增 /api/open-folder 端点
    status: pending
  - id: modify-background
    content: 修改 background.js：startDownload 增加 downloadPath 参数，新增 openFolder 消息处理
    status: pending
  - id: modify-popup-html
    content: 修改 popup.html：在画质选择下方增加下载路径输入区域，在进度面板增加打开文件夹按钮
    status: pending
  - id: modify-popup-css
    content: 修改 popup.css：增加路径输入框、重置按钮、打开文件夹按钮的样式
    status: pending
    dependencies:
      - modify-popup-html
  - id: modify-popup-js
    content: 修改 popup.js：实现路径读取/持久化、传递 download_path 到下载请求、完成时展示打开文件夹按钮
    status: pending
    dependencies:
      - modify-background
      - modify-popup-html
---

## 用户需求

在现有的 B站视频下载扩展中，增加自定义下载路径选择功能，让用户可以将视频直接保存到指定的文件夹，而不是固定在后端默认的 `downloads` 目录。

## 核心功能

- 在 popup 弹窗中增加下载路径输入区域，用户可自行输入或修改保存路径
- 下载路径通过 `chrome.storage` 持久化，下次打开扩展时自动恢复上次设置的路径
- 后端接受自定义路径参数，在指定目录保存视频文件
- 下载完成后提供「打开文件夹」按钮，直接在资源管理器中定位到下载文件
- 保留现有的「保存到本地」按钮（浏览器下载方式）作为备用方案
- 提供重置为默认路径的快捷按钮

## 技术栈

- 前端：Chrome Extension Manifest V3 (JavaScript)
- 后端：Python FastAPI + httpx + ffmpeg
- 存储：chrome.storage.local（路径持久化）

## 实现方案

### 整体策略

在扩展 popup 中添加一个文本输入框，用户填写目标文件夹路径。该路径通过消息链路（popup → background → backend）传递给后端服务。后端在校验路径合法后，将视频直接保存到用户指定目录。

下载完成后，后端返回完整文件路径；popup 提供「打开文件夹」按钮，调用后端 `/api/open-folder` 端点，由后端使用 `subprocess` 打开 Windows 资源管理器定位到文件。

### 数据流

```
用户输入路径 → chrome.storage.local 持久化 → popup启动时自动加载
                                           ↓
点击下载 → runtimeSendMessage({action:'startDownload', download_path}) 
    → background.js 转发到后端 POST /api/download {download_path}
    → 后端 _do_download 使用自定义路径保存
    → 完成后返回 file_path
    → popup 显示「打开文件夹」「保存到本地」按钮
```

### 关键设计决策

- **路径校验由后端负责**：后端检查路径是否存在、是否可写，无效时回退到默认目录并提示用户
- **使用 `subprocess.Popen(['explorer', '/select,', file_path])`** 在 Windows 资源管理器中打开并选中文件，用户体验最佳
- **保留浏览器下载通道**：即使后端已保存到指定路径，仍保留「保存到本地」按钮作为备份，调用 `chrome.downloads.download({ url, saveAs: true })`
- **存储键名**：使用 `chrome.storage.local` 的 `downloadPath` 键，与其他缓存的 `videoInfo` 隔离

## 需要修改的文件

```
G:\bilibili-downloader\
├── backend\
│   └── server.py              # [MODIFY] DownloadRequest 增加 download_path；_do_download 使用自定义路径；新增 /api/open-folder 端点
├── extension\
│   ├── background.js           # [MODIFY] startDownload 增加 downloadPath 参数；新增 openFolder 消息处理
│   ├── popup.html              # [MODIFY] 增加下载路径输入区域和打开文件夹按钮
│   ├── popup.css               # [MODIFY] 增加路径输入和按钮样式
│   └── popup.js                # [MODIFY] 路径读写与持久化；传递路径到下载；完成回调增加打开文件夹逻辑
```

## 实现细节

### server.py 关键变更

- `DownloadRequest` model 新增 `download_path: str = ""`
- `_do_download` 中：`output_dir = Path(req.download_path) if req.download_path else DOWNLOAD_DIR`，自动创建目录
- 新增 `POST /api/open-folder`：接收 `{"file_path": "..."}`，调用 `subprocess.Popen(['explorer', '/select,', file_path])` 打开文件所在文件夹并选中

### 性能与可靠性

- 下载本身不受路径切换影响，不增加额外 I/O
- 路径持久化采用 `chrome.storage.local`，读写均为异步，不影响 popup 渲染
- 后端路径校验采用 try/except 保护，无效路径自动回退默认目录
- 打开文件夹端点限制仅接受已完成任务的实际文件路径，避免任意路径遍历风险