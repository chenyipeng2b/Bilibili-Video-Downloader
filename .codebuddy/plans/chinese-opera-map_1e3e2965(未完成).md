---
name: chinese-opera-map
overview: 创建一个中国戏曲演出实时地图网站，使用 ECharts + GeoJSON 展示中国地图，红点（正在演出）、黄点（未来演出）、黑点（已结束，3天后消失），支持手动录入和自动爬取数据，全部在 G 盘开发，自动 commit 到 GitHub。
design:
  architecture:
    framework: html
  styleKeywords:
    - 中国风
    - 暗色主题
    - 脉冲动画
    - 毛玻璃效果
    - 地图可视化
  fontSystem:
    fontFamily: PingFang SC
    heading:
      size: 28px
      weight: 700
    subheading:
      size: 18px
      weight: 600
    body:
      size: 14px
      weight: 400
  colorSystem:
    primary:
      - "#C41E3A"
      - "#A01830"
      - "#8B0000"
    background:
      - "#1a1a2e"
      - "#16213e"
      - "#0f3460"
    text:
      - "#FFFFFF"
      - "#CCCCCC"
      - "#999999"
    functional:
      - "#FF4444"
      - "#F5C518"
      - "#666666"
      - "#4CAF50"
todos:
  - id: init-project
    content: 在 G:\opera-map 创建项目目录结构，初始化 Git 仓库，配置 .gitignore，关联 GitHub 远程仓库 chenyipeng2b/opera-map
    status: completed
  - id: create-data-files
    content: 创建 data/china.json（中国地图 GeoJSON）和 data/performances.json（演出数据初始文件，包含示例数据）
    status: completed
    dependencies:
      - init-project
  - id: build-main-page
    content: 构建 index.html 主页面：ECharts 地图渲染、三色亮点标注、脉冲动画、悬浮信息卡片、图例栏
    status: completed
    dependencies:
      - create-data-files
  - id: build-admin-page
    content: 构建 admin.html 管理页面：演出录入表单、手动数据开关、演出列表展示、编辑/删除功能
    status: completed
    dependencies:
      - create-data-files
  - id: build-crawler
    content: 创建爬虫脚本 js/crawler.js 和 GitHub Actions 工作流 .github/workflows/crawler.yml，实现自动爬取戏曲演出数据
    status: completed
    dependencies:
      - init-project
  - id: style-and-polish
    content: 完善全局样式 css/style.css，实现中国风暗色主题、响应式布局、亮点脉冲动画效果
    status: completed
    dependencies:
      - build-main-page
      - build-admin-page
  - id: push-and-deploy
    content: 提交所有代码并推送到 GitHub，启用 GitHub Pages 部署，验证网站可访问
    status: completed
    dependencies:
      - style-and-polish
      - build-crawler
---

## 用户需求

在中国地图上以可视化亮点形式展示全国戏曲演出信息，让用户能提前了解各地戏曲演出安排。

## 产品概述

一个基于 GitHub Pages 部署的纯前端网站，使用 ECharts 渲染中国地图，以不同颜色亮点标注全国各地戏曲演出状态。支持自动爬取网络演出数据与手动录入双重数据来源。

## 核心功能

- **中国地图可视化**：基于 ECharts + GeoJSON 渲染中国地图，各省市以亮点标注演出位置
- **三色亮点状态**：红色（正在演出中）、黄色（未来即将演出）、黑色（已结束，存留3天后自动消失）
- **手动录入演出**：提供表单页面录入演出名称、地点、时间、剧种等信息，附开关控制是否显示手动录入数据
- **自动爬取数据**：从网络平台（大麦网、猫眼等）自动爬取戏曲类演出信息
- **自动提交 GitHub**：每次数据/代码变更后自动 commit 并 push 到 GitHub，保持部署同步

## 技术栈

- **前端**：HTML + CSS + JavaScript（原生，无框架依赖）
- **地图渲染**：ECharts 5.x + 中国地图 GeoJSON（DataV.GeoAtlas 提供）
- **数据存储**：JSON 文件（`data/performances.json`）
- **爬虫**：Node.js 脚本（Puppeteer/Cheerio）+ GitHub Actions 定时执行
- **部署**：GitHub Pages
- **版本控制**：Git（G:\Git\bin\git.exe），仓库 `chenyipeng2b/opera-map`

## 实现方案

### 整体架构

采用"静态前端 + JSON 数据驱动 + GitHub Actions 自动爬取"架构：

```
opera-map/
├── index.html          # 主页面（地图展示）
├── admin.html          # 管理页面（手动录入）
├── css/
│   └── style.css       # 全局样式
├── js/
│   ├── map.js          # 地图渲染核心逻辑
│   ├── data.js         # 数据加载与处理
│   ├── admin.js        # 录入表单逻辑
│   └── crawler.js      # 爬虫脚本（Node.js）
├── data/
│   ├── performances.json    # 演出数据
│   └── china.json           # 中国地图 GeoJSON
├── .github/
│   └── workflows/
│       └── crawler.yml      # GitHub Actions 定时爬取
└── .gitignore
```

### 数据流设计

1. **数据加载**：页面加载时从 `data/performances.json` 读取演出数据
2. **状态计算**：根据当前日期与演出开始/结束日期比较，确定亮点颜色
3. **过期清理**：演出结束后超过3天的数据不渲染（保留在 JSON 中由爬虫脚本定期清理）
4. **手动录入**：admin.html 表单提交后写入 JSON，触发自动 commit
5. **爬虫更新**：GitHub Actions 每天定时运行爬虫脚本，更新 JSON 数据

### 亮点状态判断逻辑

```javascript
function getStatus(perf) {
  const now = new Date();
  const start = new Date(perf.startDate);
  const end = new Date(perf.endDate);
  const threeDaysAfterEnd = new Date(end.getTime() + 3 * 86400000);
  
  if (now >= start && now <= end) return 'live';      // 红色 - 正在演出
  if (now < start) return 'upcoming';                  // 黄色 - 未来演出
  if (now > end && now <= threeDaysAfterEnd) return 'ended'; // 黑色 - 已结束3天内
  return null; // 超过3天，不显示
}
```

### 关键设计决策

1. **纯前端方案**：无需后端服务器，所有逻辑在浏览器端完成，GitHub Pages 直接托管
2. **ECharts 选型**：开源免费，中国地图 GeoJSON 可直接从 DataV.GeoAtlas 获取，无需注册 API Key
3. **GitHub Actions 爬虫**：利用 GitHub 免费 CI 定时运行爬虫脚本，避免本地持续运行
4. **JSON 数据文件**：简单直接，易于读写和维护，适合 GitHub Pages 静态托管

### 性能考量

- 演出数据量预估在数百条级别，JSON 文件大小可控（<100KB）
- ECharts 散点图渲染亮点，性能优秀
- 地图 GeoJSON 首次加载后浏览器缓存
- 避免频繁刷新，数据更新通过 GitHub Actions 定时触发

## 设计风格

采用中国风与现代简约结合的设计风格，以深色背景搭配中国传统色彩（朱红、明黄、墨色），营造戏曲文化氛围。地图为主体视觉核心，亮点闪烁动画增强演出动态感。

## 页面设计

### 主页面（index.html）- 中国戏曲演出地图

- **顶部导航栏**：左侧项目标题"中国戏曲演出地图"，右侧"手动录入"入口按钮，使用朱红色渐变背景
- **地图主体区**：ECharts 中国地图占据页面主要区域，各省份轮廓线为暗金色，亮点使用脉冲动画效果
- **图例栏**：地图下方水平排列三个图例——红色圆点+文字"正在演出"、黄色圆点+文字"即将演出"、黑色圆点+文字"已结束"
- **侧边信息面板**：鼠标悬浮亮点时弹出信息卡片，显示演出名称、地点、时间、剧种
- **底部状态栏**：显示数据更新时间、演出总数统计

### 管理页面（admin.html）- 演出信息录入

- **表单区**：居中的卡片式表单，包含演出名称、剧种下拉选择、省份/城市、开始日期、结束日期、详细地址、演出团体、描述等字段
- **开关控制**：表单顶部"显示手动录入数据"开关，一键控制所有手动录入亮点的显示/隐藏
- **演出列表**：表单下方展示已录入的演出列表，支持编辑和删除
- **操作按钮**：保存按钮使用朱红色，取消按钮使用灰色

### 视觉效果

- 亮点使用 CSS 脉冲动画（scale + opacity），正在演出的红色亮点动画频率更高
- 地图背景使用深色（#1a1a2e），省份区域使用半透明暗金色
- 信息卡片使用毛玻璃效果（backdrop-filter: blur）
- 整体配色：朱红 #C41E3A、明黄 #F5C518、墨色 #2C2C2C、背景深蓝 #1a1a2e

## Agent Extensions

### SubAgent

- **code-explorer**
- 用途：在项目创建过程中探索 G 盘目录结构、检查 Git 配置、验证 bilibili-downloader 项目的 Git 模式作为参考
- 预期结果：确认 G 盘环境就绪，获取已有项目的 Git 配置模式

### Skill

- **skill-creator**
- 用途：如果后续需要将爬虫脚本封装为可复用的技能
- 预期结果：创建标准化的爬虫技能模块