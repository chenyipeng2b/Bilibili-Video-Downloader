---
name: add-folder-picker-button
overview: 在插件弹出窗口的"恢复默认路径"按钮旁边添加一个"选择文件夹"按钮，点击后调用后端打开原生 Windows 文件夹选择对话框，选中后将路径填入输入框。
todos:
  - id: add-server-endpoint
    content: 在 server.py 中新增 GET /api/select-folder 端点，使用 tkinter.filedialog.askdirectory() 弹出原生文件夹选择对话框并返回路径
    status: completed
  - id: add-folder-button-html
    content: 在 popup.html 的 path-input-wrapper 中，reset-path-btn 旁边增加 select-folder-btn 按钮
    status: completed
  - id: add-folder-button-js
    content: 在 popup.js 的 els 对象中增加 selectFolderBtn 引用，并添加点击事件：fetch 后端接口，将返回路径填入输入框并同步 state
    status: completed
    dependencies:
      - add-folder-button-html
---

## 用户需求

在 B站下载插件的 popup 窗口"保存路径"区域，「恢复默认路径」(↺) 按钮旁边增加一个"选择文件夹"按钮。点击后弹出 Windows 原生文件夹选择对话框，用户选择文件夹后将路径自动填入输入框。

## 核心功能

- 路径输入框右侧新增 📁 文件夹选择按钮，与 ↺ 恢复按钮并列
- 点击按钮后，通过后端调用原生文件夹选择对话框（tkinter filedialog）
- 用户选择文件夹后，路径自动填入输入框，同时同步更新 state 中的 downloadPath
- 如果用户取消选择，不改变当前路径

## 技术栈

- 前端：Chrome Extension (HTML/CSS/JS)
- 后端：FastAPI + Python (tkinter)
- 按钮样式：复用现有 `.btn-icon` 类

## 实现方案

### 总体策略

Chrome 扩展 popup 受安全策略限制，无法通过 `showDirectoryPicker()` 等 Web API 获取真实文件系统路径。采用"前端请求 → 后端弹出原生对话框 → 返回路径"的方案：

1. 前端 popup.js 通过 `fetch` 调用后端新增的 `GET /api/select-folder` 端点
2. 后端使用 Python 标准库 `tkinter.filedialog.askdirectory()` 弹出原生 Windows 文件夹选择对话框
3. 后端返回选中的路径 JSON，前端填入输入框

### 技术决策

- **为何用后端方案而非前端 File System Access API**：`showDirectoryPicker()` 返回的是 `FileSystemDirectoryHandle`，不暴露真实文件系统路径，而下载后端（Python）需要真实路径来保存文件
- **为何用 tkinter 而非其他方案**：tkinter 是 Python 标准库，无需额外安装依赖，且 `askdirectory()` 弹出的对话框与 Windows 原生一致
- **端点设计为 GET**：无请求体，简单直接，前端调用方便

### 注意事项

- 需要隐藏 tkinter 的根窗口（`root.withdraw()`），避免弹出空白 Tk 窗口
- 用户取消对话框时 tkinter 返回空字符串，后端应返回 `{"path": null}`，前端不做任何操作
- 按钮复用 `.btn-icon` 样式，与其他图标按钮视觉统一