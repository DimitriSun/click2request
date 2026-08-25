# Click2Request

> 一个 Chrome 扩展：开启录制后，你在网页上的点击操作所产生的 API 请求会被自动记录；在可视化面板中查看、整理、回放，并一键导出为 **JMeter / Python requests / curl / Postman / HAR** 等自动化测试脚本。
>
> 完全离线可用，适配局域网服务（`localhost` / `192.168.x.x` / 自签名 https），数据只保存在本地浏览器中。

English intro: A Chrome extension that records browser API traffic with one click, then lets you visualize, replay and export the requests as JMeter / Python / curl / Postman / HAR for automated testing. Fully offline, works with LAN services.

---

## 功能特性

- **一键录制**：工具栏开关 / 快捷键 `Ctrl+Shift+R`，记录当前标签页全部请求（自动过滤图片、CSS、JS 等静态资源）
- **全量捕获**：基于 `chrome.debugger`（CDP Network 域），包含请求/响应头、请求体、**完整响应体**、TTFB / 下载耗时分解
- **会话管理**：每次录制为一个会话，可重命名、删除；SW 被回收或浏览器重启后可自动恢复录制
- **可视化面板**：
  - 会话列表（请求数 / API 数 / 错误数 / 占用大小，可按时间/请求数/API 数/大小排序）
  - 请求列表 + 瀑布图（按方法 / 状态 / 域名筛选、关键词搜索，点击标题可按时间/方法/状态/路径/耗时/大小排序）
  - 请求详情（参数、头、JSON 树形响应体、耗时分解条）
  - API 统计（方法分布 / 状态码分布 / 响应时间趋势 / 调用次数与耗时排行，ECharts 本地渲染；API 明细表可按任意列排序）
- **响应式**：窄窗口/高分屏下表格与瀑布自动横向滚动，不再挤压错位
- **回放冒烟**：扩展内直接重放选中请求或整个会话，对比录制 vs 重放（状态码 / 耗时 / 响应体一致性），红绿标记
- **Cookie 策略**：回放时可选「当前浏览器 Cookie / 录制时的 Cookie / 不带 Cookie」
- **变量与环境**：`{{变量名}}` 标记 URL / 头 / 体中的任意片段，支持 dev / test / prod 环境切换 `{{baseUrl}}`，导出与回放共用
- **导出**：curl、Python requests、JMeter (.jmx)、Postman Collection (v2.1)、HAR；可选敏感头脱敏、API 去重；文件直接保存到默认下载目录，文件名带正确扩展名
- **零流量**：插件运行时不发起任何网络请求（回放是唯一的主动网络操作），断网不影响查看与导出

## 安装
### 下载发行版本
1. Chrome打开扩展程序管理页面(或直接打开chrome://extensions)，打开「开发者模式」
2. 直接拖入crx文件
> Edge浏览器需要组策略添加id信任才能开启

### 克隆项目方式：
1. 下载或git clone项目
2. Chrome打开扩展程序管理页面(或直接打开chrome://extensions)，打开「开发者模式」
3. 点击「加载已解压的扩展程序」，选择项目目录

## 使用流程

```
① 点击工具栏图标 → 「开始录制」
② 在页面上正常操作（登录、查询、翻页…）
③ 回来点击「停止」（或再次按 Ctrl+Shift+R）
④ 打开可视化面板：查看会话 → 请求详情 / 瀑布 / API 统计
⑤ 回放：选中请求或「回放全部」，首次会请求该站点的访问权限
⑥ 导出：选格式 → 预览 → 下载文件
```

## 权限说明

| 权限 | 用途 |
|---|---|
| `debugger` | 捕获请求/响应（仅在用户开启录制时 attach 当前标签页，关闭即 detach） |
| `storage` | 本地存储设置与录制状态 |
| `cookies` | 回放「当前浏览器 Cookie」策略（`chrome.cookies` 读取） |
| `scripting` + `activeTab` | 自签名 https 场景的「页面内回放」 |
| 可选 host 权限 | 首次回放某域名时按需申请，可拒绝（拒绝只影响回放） |

> 导出文件使用 `<a download>` 方式直接保存到浏览器默认下载目录（文件名带正确扩展名，如 `.jmx` / `.py`），因此**不需要** `downloads` 权限。

## 离线 / 局域网说明

- 全部资源（含 ECharts）本地打包，无 CDN、无远程字体，插件自身 0 网络请求
- 录制任意 `http://localhost`、`http://192.168.x.x`、主机名页面均无需授权
- 回放需为该域名授予一次访问权限（`chrome.permissions.request`，可在弹窗中拒绝）
- 自签名 https：后台回放会因 TLS 校验失败，可用「页面内回放」借助已信任证书的页面上下文完成
- 断网不影响已录制数据的查看、统计与导出

## 项目结构

```
├── manifest.json              # MV3 清单
├── src/
│   ├── background/
│   │   ├── service-worker.js  # 入口：录制生命周期、消息路由、崩溃恢复、保活
│   │   ├── capture.js         # CDP 捕获层（debugger attach / Network 事件归一化）
│   │   ├── recorder.js        # 录制过滤 + 会话/请求落库
│   │   └── replay.js          # 回放（三种 Cookie 策略 + 页面内回放）
│   ├── shared/
│   │   ├── db.js              # IndexedDB：schema、CRUD、统计（SW 与面板共用）
│   │   ├── settings.js        # chrome.storage.local 设置封装
│   │   ├── variables.js       # 变量/环境解析与替换
│   │   ├── permissions.js     # 可选 host 权限辅助
│   │   ├── utils.js           # 通用工具
│   │   └── exporters/         # 导出器（新增格式只需加一个文件并注册）
│   │       ├── index.js       # 导出器注册表
│   │       ├── curl.js / python.js / jmx.js / postman.js / har.js
│   ├── popup/                 # 工具栏开关
│   ├── dashboard/             # 可视化面板（SPA，hash 路由）
│   │   ├── dashboard.js       # 路由与外壳
│   │   ├── views/             # sessions / session-detail / request-detail / stats / modals
│   │   └── vendor/echarts.min.js
│   └── offscreen/             # Service Worker 保活（录制期间 20s ping）
├── icons/                     # 16/32/48/128 PNG
└── scripts/                   # check / smoke-test / gen-icons / package
```

## 开发命令

```bash
npm run check         # 全部 JS/JSON 语法检查
npm run smoke         # 导出器冒烟测试（Node 环境，无需浏览器）
npm run gen-icons     # 重新生成图标
npm run package       # 打包 zip 到 dist/
npm run e2e:fetch-cft # 下载 Chrome for Testing 到 .e2e-cft/
npm run e2e           # 端到端测试（需先执行 e2e:fetch-cft）
```

E2E 说明：品牌版 Google Chrome 在管理员权限下会拒绝 `--load-extension`，因此测试使用 **Chrome for Testing**（Chromium，无此限制）。测试自动拉起真实浏览器加载扩展，驱动 popup 完成「开始录制 → 页面请求 → 停止 → 面板验证」全流程，并覆盖导出格式选择、弹窗关闭等 UI 行为。

## 如何扩展

**新增导出格式**：在 `src/shared/exporters/` 新建文件，导出 `generate(records, options) => string`，在 `index.js` 注册即可，面板自动出现该格式选项。

**新增视图**：在 `src/dashboard/views/` 新建模块导出 `render(container, params)`，在 `dashboard.js` 的 `routes` 数组加一条路由。

**更换捕获层**：`capture.js` 的 `CaptureSession` 是唯一与 CDP 交互的地方（`start/stop/onRecord/onDetach`），如后续改用 webRequest 方案，只需替换该类，录制/存储/面板/导出均不受影响。

## 已知限制

- 录制期间若在目标标签页打开 DevTools，debugger 会被抢占，录制自动暂停（关闭 DevTools 后点「继续」）
- 响应体默认上限 2MB（设置中可调），超限截断并标记
- 回放基于记录时的请求头；若接口依赖动态签名/一次性 token，需在变量中替换
- 长会话的瀑布图最多展示前 500 条，可用筛选缩小范围

## License

MIT
