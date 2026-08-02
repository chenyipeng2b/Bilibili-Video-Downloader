---
name: fix-github-pages-map-loading
overview: 修复 GitHub Pages 上中国戏曲演出地图加载失败的问题，包括修改 .gitattributes、优化 main.js 的加载逻辑和错误处理，然后推送并验证。
todos:
  - id: fix-gitattributes
    content: 修正 .gitattributes 文件，将 *.json binary 改为精确的 -text 规则，避免 GitHub Pages 服务 JSON 文件异常
    status: completed
  - id: fix-loadgeojson
    content: 改进 main.js 的 loadGeoJson() 函数，增加多源回退（GeoJSON.cn 等），并输出详细错误日志
    status: completed
  - id: fix-main-graceful
    content: 改进 main.js 的 main() 函数，GeoJSON 失败时不再完全阻塞，改为渐进式降级（仍加载演出数据）
    status: completed
    dependencies:
      - fix-loadgeojson
  - id: commit-and-push
    content: 提交所有修改并推送到 GitHub，等待 Pages 部署完成
    status: completed
    dependencies:
      - fix-gitattributes
      - fix-main-graceful
  - id: verify-deployment
    content: 使用 [skill:agent-browser] 打开线上页面，截图验证地图渲染、亮点显示、统计数据、底部列表是否正常
    status: completed
    dependencies:
      - commit-and-push
---

## 用户需求

对已完成的中国戏曲演出地图项目执行全面测试验证，并修复测试中发现的 GitHub Pages 地图加载失败问题。

## 测试结果摘要

### 已通过

- GitHub Pages 页面可访问：https://chenyipeng2b.github.io/China-Chinese-Opera-Performance-Map/
- 仓库存在：chenyipeng2b/China-Chinese-Opera-Performance-Map，12 次提交
- 所有 GitHub Actions 工作流（Deploy + pages-build-deployment）全部成功
- 静态资源（css/style.css、js/main.js、data/performances.json）均可正常访问
- HTML 结构正常渲染（导航栏、图例说明、筛选器面板均显示正常）

### 失败项

- **地图加载失败**：页面显示错误遮罩，loadGeoJson() 返回 false
- **演出统计为 0**：地图加载失败后 main() 直接 return，未执行后续初始化

## 根因分析

`.gitattributes` 中 `*.json binary` 规则将 data/china.json（582KB）标记为二进制文件，影响 GitHub Pages 服务此文件的方式，导致浏览器 fetch 解析失败。同时 main.js 的 loadGeoJson() 回退到阿里云 DataV 在线源也失败（可能因 CORS 或网络限制）。此外 main() 函数在 GeoJSON 加载失败后直接 return 过于严格，应至少允许演出数据加载和降级显示。

## 修复目标

1. 修正 .gitattributes 规则，避免影响 GitHub Pages 对 JSON 文件的服务
2. 增强 main.js 的 GeoJSON 加载回退机制，增加更多在线数据源
3. 改进 main() 的错误处理，GeoJSON 失败时不应完全阻塞页面
4. 推送修复后验证 GitHub Pages 部署状态

## 技术方案

### 修复策略

**问题1：`.gitattributes` 中 `*.json binary` 过于激进**

该规则将所有 `.json` 文件标记为 binary，初衷是防止 Git 自动转换换行符破坏 UTF-8 编码。但 GitHub Pages 在服务 binary 文件时可能使用不同的传输方式，导致浏览器 `fetch()` 失败。

**修复方案**：移除 `*.json binary` 规则，改为在 `.gitattributes` 中显式指定 `data/china.json` 和 `data/performances.json` 的编码属性，使用 `-text` 阻止换行符转换但保留 text 分类：

```
data/china.json -text
data/performances.json -text
*.geojson -text
```

`-text` 标记阻止 Git 执行任何换行符转换，但文件仍被视为 text 类（非 binary），GitHub Pages 会正确设置 `Content-Type: application/json; charset=utf-8`。

**问题2：`main.js` 的 `loadGeoJson()` 回退源单一**

当前只有阿里云 DataV 一个在线回退源，且可能因 CORS 或网络限制失败。

**修复方案**：增加多个 GeoJSON 回退源，按优先级依次尝试：

1. 本地 `data/china.json`（主源）
2. `https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json`（阿里云 DataV）
3. `https://geojson.cn/api/data/china-geojson/china.json`（GeoJSON.cn 镜像）
4. 内嵌简化版 GeoJSON（硬编码中国各省份中心坐标，作为最终兜底）

同时在 catch 块中输出详细错误信息（`console.error`）以便调试。

**问题3：`main()` 在 GeoJSON 失败后完全阻塞**

当前逻辑：GeoJSON 加载失败 → 显示错误遮罩 → `return` → 演出数据永不加载。

**修复方案**：改为渐进式降级策略：

- GeoJSON 加载失败 → 不显示 ECharts 地图 → 但仍然加载演出数据 → 在底部演出条展示数据 → 在地图区域显示友好提示"地图数据加载中，请稍后刷新"
- 这样用户至少能看到演出列表和统计数据，不会完全空白

### 关键代码修改

**main.js `loadGeoJson()` 函数签名不变，内部增加多源回退循环**：

```
async function loadGeoJson() {
    const sources = [
        'data/china.json',
        'https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json',
        'https://geojson.cn/api/data/china-geojson/china.json'
    ];
    for (const url of sources) {
        try {
            const resp = await fetch(url);
            if (resp.ok) {
                geoJson = await resp.json();
                console.log('[地图] 成功: ' + url + ' (' + geoJson.features.length + '区域)');
                return true;
            }
        } catch(e) {
            console.warn('[地图] 源失败: ' + url, e.message);
        }
    }
    console.error('[地图] 所有源均失败');
    return false;
}
```

**main.js `main()` 函数改为渐进式降级**：

```
async function main() {
    var geoOk = await loadGeoJson();
    await loadPerformances();
    
    if (geoOk) {
        initChart();
        updateMapData();
    } else {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('error').style.display = 'flex';
        document.getElementById('errorMsg').textContent = '地图数据加载失败，请刷新页面重试。演出数据已正常加载。';
        updateStats();  // 仅更新统计数字
        updatePerfList(getActivePerformances());  // 仍显示底部列表
    }
    document.getElementById('loading').style.display = 'none';
}
```

### 验证计划

修改完成后使用 [skill:agent-browser] 打开 GitHub Pages 页面，截图验证：

1. 地图是否正常渲染（中国地图轮廓 + 省份标签）
2. 三色亮点是否正确标注
3. 演出统计数据是否非零
4. 底部演出条是否显示列表
5. 筛选器是否正常工作

## Agent Extensions

### Skill: agent-browser

- **用途**：修改推送到 GitHub 后，打开线上页面进行可视化验证
- **预期结果**：截取页面截图，确认地图正常渲染、亮点显示正确、统计数据非零、底部演出条有内容