# 工作台 Workbench

课表、账单、单词、待办、时间记录，收在一个窗口里。

一个纯前端的个人效率工作台。网页版直接在浏览器打开，桌面版是便于离线使用的 Windows 便携程序，两份共享同一套页面与数据格式。

---

## 功能

| 模块 | 说明 |
|---|---|
| **课表** | 单双周课程表，按周次自动高亮当前课程 |
| **账单** | 收支记录、分类统计、月度汇总 |
| **单词** | 英语四级词库、间隔重复复习 |
| **待办** | 任务清单，支持优先级与完成归档 |
| **时间** | 时间块记录，统计每日时间去向 |
| **笔记** | 轻量 Markdown 笔记 |
| **AI 助手** | 内置对话面板，支持工具调用（可直接记账、查课表、记时间） |

界面采用模块化侧栏布局，每个模块独立加载，可自由增删。

---

## 目录结构

```
.
├── desktop/          桌面版的页面代码（纯 HTML/JS，无需构建）
│   ├── index.html
│   ├── app.js        主逻辑：路由、AI 面板、模块加载
│   ├── modules/      各功能模块（课表 / 账单 / 单词 / 待办 / 时间 / 笔记）
│   └── shared/       公共层：同步、存储、设置、工具调用
│
├── shell/            Electron 外壳（把 desktop/ 打包成 exe）
│   ├── main.js       主进程：窗口、文件读写、跨域请求转发
│   ├── preload.js    暴露给页面的受限 API
│   └── package.json  打包配置
│
└── web/              在线版的页面 + 服务端函数
    ├── index.html
    ├── netlify/
    │   └── functions/  无服务端函数：账号、同步、AI 转发
    └── netlify.toml    路由与 CORS 配置
```

`desktop/` 与 `web/` 的页面代码基本一致，差异在于：桌面版通过 Electron 主进程发送网络请求（绕开 `file://` 的跨域限制），网页版直接调服务端。

---

## 快速开始

### 网页版（本地预览）

纯静态页面，任意 HTTP 服务即可：

```bash
cd web
npx serve .
# 或 python -m http.server 8080
```

打开 `http://localhost:8080`。

AI 功能需要配置服务端（见下文），否则只有本地功能可用。

### 桌面版

```bash
cd shell
npm install
npm start          # 开发调试
npm run portable   # 打包成单文件 exe
```

打包产物输出到仓库根目录的 `dist/`。

---

## 服务端配置

`web/netlify/functions/` 下是 Netlify Functions（Node.js），提供三个接口：

| 路径 | 作用 |
|---|---|
| `POST /api/account` | 注册 / 登录，账号信息以 `sha256(名字+访问码)` 形式存储 |
| `GET/PATCH /api/sync` | 数据读写，按用户隔离 |
| `POST /api/ai` | AI 请求转发（密钥只在服务端，不进前端） |

### 环境变量

在 Netlify 站点后台配置：

| 变量 | 说明 | 必填 |
|---|---|---|
| `AI_BASE` | OpenAI 兼容接口的 Base URL，如 `https://api.example.com/v1` | AI 功能必填 |
| `AI_KEY` | 服务端持有的 API Key | AI 功能必填 |
| `AI_MODEL` | 模型名，如 `gpt-4o-mini` | AI 功能必填 |
| `WB_SITE_ID` | Netlify 站点 ID（存储用） | 是 |
| `WB_BLOBS_TOKEN` | Netlify 个人访问令牌（存储用） | 是 |

数据存储使用 **Netlify Blobs**，无需外部数据库。部署后首次访问会自动创建。

> 说明：`_store.js` 通过 `siteID + token` 显式连接 Blobs，因为 `netlify deploy --dir` 手动部署不会自动注入 `NETLIFY_BLOBS_CONTEXT`。

### 部署

```bash
cd web
netlify deploy --dir .          # 先草稿部署
netlify api restoreSiteDeploy \
  --data '{"site_id":"<你的站点ID>","deploy_id":"<部署ID>"}'
```

`netlify deploy --prod` 在部分账号下会返回 Forbidden，用上面的 API 提升即可。

---

## 技术栈

- **前端**：原生 HTML / CSS / JavaScript，零框架、零构建
- **桌面**：Electron（窗口 + 主进程代理请求）
- **后端**：Netlify Functions（Node.js）
- **存储**：Netlify Blobs
- **AI**：任何 OpenAI 兼容接口（支持 function calling）

选择零框架的原因很简单：这套东西要能在没有网络、没有构建工具的环境里打开就用，而且十年后还能跑。

---

## 数据与隐私

- 所有业务数据存在你自己的服务端存储里，不经过任何第三方
- AI 密钥只存在于服务端环境变量，前端代码里没有
- 账号以 `sha256(名字::访问码)` 存储，不保存明文
- 桌面版默认不联网也能用，同步需要手动开启

---

## 说明

代码里硬编码的服务端地址是作者自用实例。**如果你要部署自己的版本**，记得改这两处：

- `desktop/app.js` 中的 `AI_REMOTE`（桌面版调用的服务端地址）
- `desktop/shared/sync.js` 与 `web/shared/sync.js` 中的 `REMOTE`（同步地址）

否则会走作者的服务端，消耗作者的额度。

---

## License

MIT
