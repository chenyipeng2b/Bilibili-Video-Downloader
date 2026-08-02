---
name: path-default-checkbox
overview: 在下载路径输入区域增加「保存为默认路径」复选框，让用户显式控制路径是否持久化到下次使用，而非当前的自动保存行为。
todos:
  - id: modify-popup-html-checkbox
    content: 修改 popup.html：在路径输入框下方增加"保存为默认下载路径"复选框
    status: completed
  - id: modify-popup-css-checkbox
    content: 修改 popup.css：增加复选框行样式
    status: completed
    dependencies:
      - modify-popup-html-checkbox
  - id: modify-popup-js-checkbox
    content: 修改 popup.js：els 增加引用、state 增加字段、改造路径保存为条件持久化、复选框事件绑定、重置联动
    status: completed
    dependencies:
      - modify-popup-html-checkbox
---

## 用户需求

下载时能选择下载路径，选好路径后可以勾选"保存为默认下载路径"复选框，勾选后路径持久化到 chrome.storage，下次打开自动恢复；不勾选则路径仅当次下载有效。

## 核心功能

- 在路径输入框下方增加一个复选框"保存为默认下载路径"
- 勾选时，路径修改自动持久化到 chrome.storage.local
- 未勾选时，路径仅对当前 popup 会话有效，关闭后恢复默认
- 复选框自身状态也持久化（键名 `savePathDefault`），打开 popup 时自动恢复
- 重置按钮同时清除路径和取消勾选
- 后端无需改动

## 技术方案

### 实现策略

在 popup.html 路径输入区域下方新增一个复选框，popup.js 中增加对应的状态管理和 chrome.storage 读写逻辑。核心思路是将自动保存改为条件保存——仅在复选框勾选时才调用 `chrome.storage.local.set`。

### 数据流

```
用户输入路径 → state.downloadPath 更新
用户勾选复选框 → state.savePathDefault = true
              → chrome.storage.local.set({ savePathDefault: true })
              → chrome.storage.local.set({ downloadPath: value })

下次打开 popup → chrome.storage.local.get(['downloadPath', 'savePathDefault'])
              → 恢复复选框状态和路径
```

### 关键设计决策

- **存储键名**：新增 `savePathDefault`（布尔值），与现有 `downloadPath` 独立存储
- **勾选时机**：用户在输入路径后勾选时才保存当前路径；若先勾选再输入路径，则在 change 事件时保存
- **去勾选行为**：取消勾选时不清除已保存的路径，仅停止自动持久化
- **重置行为**：清除路径输入框、取消勾选、移除 storage 中两个键

## 需要修改的文件

```
G:\bilibili-downloader\extension\
├── popup.html    # 路径区域新增复选框
├── popup.css     # 复选框行样式
└── popup.js      # els引用、state、路径管理逻辑、事件绑定、初始化
```

## 实现细节

### popup.html

在 `path-input-wrapper` div 下方新增复选框行：

```html
<div class="path-checkbox-row">
  <input type="checkbox" id="save-path-checkbox">
  <label for="save-path-checkbox">保存为默认下载路径</label>
</div>
```

### popup.css

新增 `.path-checkbox-row` 样式：flex 水平布局、小字号、灰色文字、与路径输入框间距 6px。checkbox 使用 B站粉色 `#FB7299` 作为 accent-color。

### popup.js 变更点

1. **els 对象**：新增 `savePathCheckbox: document.getElementById('save-path-checkbox')`
2. **state 对象**：新增 `savePathDefault: false`
3. **loadSavedPath()**：同时读取 `savePathDefault`，恢复复选框 checked 状态和路径
4. **savePath()**：仅在 `state.savePathDefault` 为 true 时执行 `chrome.storage.local.set`
5. **路径 input 事件**：保持实时更新 state，不自动保存
6. **路径 change 事件**：仅在勾选时调用 savePath
7. **复选框 change 事件**：更新 `state.savePathDefault`，持久化自身状态；若当前路径非空且勾选，立即保存当前路径
8. **重置按钮**：同时设置 `savePathCheckbox.checked = false`，移除 `savePathDefault` 键
9. **初始化**：在 DOMContentLoaded 中调用 loadSavedPath 时自动恢复复选框