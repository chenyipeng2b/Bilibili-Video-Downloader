---
name: add-actors-to-tooltip
overview: 1. 在地图亮点悬浮弹窗中增加主要演员信息展示；2. 扩大爬虫数据源：新增抖音/小红书/微博/B站等社交媒体搜索模块，通过搜索引擎间接抓取这些平台上的戏曲演出信息。
todos:
  - id: add-actors-to-data
    content: 为 performances.json 中8条手动数据添加 actors 字段，填入对应经典主演名
    status: completed
  - id: add-actors-to-tooltip
    content: 在 main.js showTooltip 函数中剧团行后新增演员信息展示行（条件渲染，复用 .tt-row 样式）
    status: completed
  - id: add-actors-to-crawler
    content: 在 crawler.js normalizeData 中增加 actors 字段保留逻辑
    status: completed
  - id: add-social-crawlers
    content: 在 crawler.js 新增4个社交媒体爬虫模块：B站API搜索、微博搜索、百度site:douyin.com、Bing site:xiaohongshu.com
    status: completed
    dependencies:
      - add-actors-to-crawler
  - id: update-crawlall-and-workflow
    content: 更新 crawler.js crawlAll 主流程调用新模块，更新 .github/workflows/crawler.yml 超时35min和commit message
    status: completed
    dependencies:
      - add-social-crawlers
  - id: commit-and-verify
    content: 提交推送所有改动并验证 GitHub Pages 部署，确认 tooltip 显示演员信息
    status: completed
    dependencies:
      - update-crawlall-and-workflow
      - add-actors-to-data
      - add-actors-to-tooltip
---

## 用户需求

### 需求一：亮点弹窗增加演员信息

在地图上散点标记（小亮点）的悬浮提示弹窗中，增加少量主要演员名字的展示。当前 tooltip 显示状态、名称、剧种、地点、日期、剧团、描述共7项信息，缺少演员信息。

### 需求二：扩大爬虫搜索范围

将抖音、小红书、微博、B站等社交媒体平台纳入爬虫搜索源，捕捉更多戏曲演出信息。考虑到这些平台 Web 端反爬严格，采用间接策略：通过百度/Bing 搜索引擎带 `site:` 限定词抓取公开页面摘要，同时利用 B站公开搜索 API 和微博公开搜索页直接获取数据。

## 核心功能

1. **tooltip 演员展示**：在悬浮弹窗中新增一行演员信息（`👤 主要演员：xxx`），仅当数据有 actors 字段时显示，复用现有 `.tt-row` 样式
2. **手动数据补充演员**：为8条手动录入演出数据（demo001~demo008）各填入1-2位经典主演名
3. **社交媒体爬虫模块**：新增4个爬虫函数——微博搜索、B站搜索API、百度 `site:douyin.com` 定向搜索、Bing `site:xiaohongshu.com` 定向搜索
4. **爬虫数据保留 actors**：normalizeData 增加 actors 字段保留逻辑，确保爬取到的演员信息不丢失
5. **GitHub Actions 适配**：超时延长至35分钟，commit message 更新为包含社交平台名称

## 技术方案

### 实现策略

**演员展示**：纯前端改动，在 `showTooltip` 中增加条件渲染行，数据层和爬虫层同步支持 actors 字段。

**社交媒体爬虫**：不直接请求抖音/小红书页面（反爬太严），改用搜索引擎 `site:` 语法间接抓取，同时利用 B站公开 API 和微博搜索页这两个可直接请求的端点。

### 社交媒体爬虫技术细节

| 平台 | 策略 | 端点 | 可行性 |
| --- | --- | --- | --- |
| **B站** | 公开搜索 JSON API | `api.bilibili.com/x/web-interface/search` | 高，返回结构化 JSON |
| **微博** | 公开搜索 HTML 页 | `s.weibo.com/weibo?q=戏曲演出` | 中，需解析 HTML |
| **抖音** | 百度 `site:douyin.com` 间接搜索 | `www.baidu.com/s?wd=site:douyin.com+戏曲演出` | 中，抓搜索引擎摘要 |
| **小红书** | Bing `site:xiaohongshu.com` 间接搜索 | `www.bing.com/search?q=site:xiaohongshu.com+戏曲演出` | 中，抓搜索引擎摘要 |


### 数据流

```
爬虫执行 → crawlBilibili / crawlWeibo / crawlDouyinViaBaidu / crawlXiaohongshuViaBing
         → 各函数返回含 actors 字段的结果
         → normalizeData 保留 actors
         → deduplicatePerformances 去重
         → 写入 performances.json
         → 前端 loadPerformances 加载
         → showTooltip 条件渲染 actors 行
```

### 关键设计决策

- **actors 字段为空时不显示**：避免 tooltip 中出现空行，保持界面整洁
- **爬虫 actors 提取策略**：从搜索结果文本中正则匹配"主演：xxx"、"演员：xxx"、"某某饰"等模式
- **搜索引擎 site: 搜索**：每个社交平台搜4个关键词（戏曲演出、京剧演出、越剧演出、昆曲演出），每个关键词取前5条
- **B站 API 直接调用**：不需要 Cookie，公开接口，每次搜3个关键词，解析 JSON 中的 `data.result` 数组
- **超时延长至35分钟**：从30分钟延长以容纳4个新增数据源

### 实现注意事项

- 爬虫已有成熟的 `httpGet`、`cleanText`、`extractDate`、`extractCity`、`extractGenre`、`extractTroupe`、`extractVenue`、`extractTitle`、`extractEndDate` 等工具函数，新增模块直接复用
- 爬虫已有 `processSearchSnippet` 通用处理函数，社交媒体搜索结果也可复用
- GitHub Actions 的 commit message 需要更新，包含新平台名称
- 所有改动遵循现有代码风格：ES5 语法、`var` 声明、`function` 关键字