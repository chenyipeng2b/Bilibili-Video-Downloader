---
name: add-actors-to-tooltip
overview: 在地图亮点悬浮弹窗（tooltip）中增加主要演员信息展示，同步更新数据和爬虫字段。
todos:
  - id: add-actors-to-data
    content: 为 performances.json 中8条手动数据添加 actors 字段，填入对应经典主演名
    status: pending
  - id: add-actors-to-tooltip
    content: 在 main.js showTooltip 函数中新增演员信息展示行（剧团行后，条件渲染）
    status: pending
  - id: add-actors-to-crawler
    content: 在 crawler.js normalizeData 中增加 actors 字段保留逻辑
    status: pending
  - id: commit-and-verify
    content: 提交推送并验证 GitHub Pages 部署，确认 tooltip 显示演员信息
    status: pending
    dependencies:
      - add-actors-to-data
      - add-actors-to-tooltip
      - add-actors-to-crawler
---

## 用户需求

在地图上"小亮点"（散点标记）的悬浮提示中增加主要演员名字展示。当前 tooltip 显示状态、名称、剧种、地点、日期、剧团、描述，缺少演员信息。

## 核心功能

- 在悬浮提示弹窗中新增一行演员信息（使用 👤 emoji 标识，复用 `.tt-row` 样式）
- 为8条手动录入的演出数据补充 actors 字段（每条填1-2位主要演员）
- 爬虫的 normalizeData 函数保留 actors 字段，确保爬取数据如有演员信息不会丢失

## 技术方案

### 实现方式

纯前端修改，涉及3个文件的增量改动：

1. **`data/performances.json`** — 为8条 `"source": "manual"` 的数据条目各增加 `"actors"` 字段，填入对应剧目的经典主演名（如京剧《贵妃醉酒》填"梅兰芳"、越剧《梁山伯与祝英台》填"袁雪芬、范瑞娟"等）
2. **`js/main.js`** 第258行后 — 在 `showTooltip` 函数中剧团行之后插入条件渲染的演员行
3. **`js/crawler.js`** 第1105行 — `normalizeData` 返回对象中增加 `actors: item.actors || ''` 保留爬取数据中的演员字段

### 关键设计决策

- 演员行使用条件渲染：`perf.actors` 存在且非空时才显示，避免空行
- 复用现有 `.tt-row` CSS 类，无需新增样式
- `normalizeData` 中 actors 默认为空字符串，兼容爬虫抓不到演员数据的场景

### 目录结构

```
G:\opera-map\
├── data/
│   └── performances.json  # [MODIFY] 8条手动数据各加 "actors" 字段
├── js/
│   ├── main.js            # [MODIFY] showTooltip 新增演员行
│   └── crawler.js         # [MODIFY] normalizeData 保留 actors
```