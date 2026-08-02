---
name: edge-screenshot-to-desktop
overview: 使用 PowerShell 捕获当前屏幕截图，保存到用户桌面。同时告知用户 Edge 自带的"捕获整页"功能作为真正的长截图方案。
todos:
  - id: screen-capture
    content: 使用 PowerShell 截取当前屏幕画面并保存 PNG 到桌面
    status: completed
  - id: show-edge-tip
    content: 提示用户 Edge 自带完整长截图功能（Ctrl+Shift+S → 捕获整页）
    status: completed
    dependencies:
      - screen-capture
---

## 用户需求

对当前 Edge 浏览器网页进行截图并保存到桌面。

## 功能说明

- 使用 PowerShell 捕获当前显示器屏幕画面（包含 Edge 浏览器窗口），保存为 PNG 到桌面
- 告知用户 Edge 自带完整长截图功能（Ctrl+Shift+S → 捕获整页），可实现真正的整页滚动截图

## 使用场景

用户正在浏览网页想保存当前页面内容作为图片。

## 技术限制说明

- AI 无法直接操作用户已打开的 Edge 浏览器窗口
- 屏幕截图只能捕获当前可视区域，无法滚动截取不可见部分
- 真正的网页长截图需使用 Edge 内置的"捕获整页"功能

## 实施方案

### 方案一：屏幕截图（立即可执行）

使用 PowerShell 调用 .NET Framework 的 `System.Windows.Forms` 和 `System.Drawing` 抓取所有显示器画面，保存为 PNG 文件到桌面。

**优点**：无需安装任何东西，立即可用
**缺点**：只能截取屏幕当前可视内容，无法获取滚动后的不可见部分

### 方案二：Edge 内置长截图（推荐告知用户）

Edge 浏览器自带完整网页截图功能：

- 快捷键 `Ctrl+Shift+S`
- 选择"捕获整页"
- 自动滚动截取整个网页并保存

**优点**：真正的整页长截图，包含滚动区域
**缺点**：需用户手动操作

### 执行步骤

1. 使用 `[Environment]::GetFolderPath('Desktop')` 动态获取桌面路径
2. 通过 `Add-Type` 加载 `System.Windows.Forms` 和 `System.Drawing`
3. 获取所有显示器边界，创建覆盖所有屏幕的 Bitmap
4. 使用 `Graphics.CopyFromScreen` 截取画面
5. 保存为 `edge_screenshot_时间戳.png` 到桌面
6. 输出 Edge 内置截图快捷键提示

## 实现细节

### 核心 PowerShell 命令

```
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$desktop = [Environment]::GetFolderPath('Desktop')
$screens = [System.Windows.Forms.Screen]::AllScreens
$bounds = [System.Drawing.Rectangle]::FromLTRB(
    ($screens.Bounds.Left | Measure-Object -Minimum).Minimum,
    ($screens.Bounds.Top | Measure-Object -Minimum).Minimum,
    ($screens.Bounds.Right | Measure-Object -Maximum).Maximum,
    ($screens.Bounds.Bottom | Measure-Object -Maximum).Maximum
)
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$g.Dispose()
$path = Join-Path $desktop "edge_screenshot_$(Get-Date -Format 'yyyyMMdd_HHmmss').png"
$bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
```

### 文件命名

- 格式：`edge_screenshot_20260722_143025.png`
- 存放路径：`C:\Users\超级无敌帅阳阳\Desktop\`