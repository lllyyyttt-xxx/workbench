<div align="center">

# 工作台 Workbench

课表、记账、背单词、待办、随手记，收在一个窗口里。

桌面端和网页端是五个模块。数据默认只存在你自己的电脑上，不注册也能用。

[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/lllyyyttt-xxx/workbench?label=release)](https://github.com/lllyyyttt-xxx/workbench/releases/latest)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Web-lightgrey.svg)](#下载)

<img src="docs/shot-home.webp" width="880" alt="工作台首页">

</div>

---

## 功能

| 模块 | 说明 |
|---|---|
| **英语工作台** | 四六级词库查词、间隔重复背词、单词本、原文阅读（文中的考纲词自动点亮） |
| **生活** | 记账（可从备忘录整段粘贴自动拆账）、待办、倒计时（一次/每周/每月/每年） |
| **随机挑战** | 一分钟到一整天四档题池，共 33 题，完成或放弃都记录，统计完成率与连续天数 |
| **时间管理** | 单双周课表、按步拆解的规划、时间块记录、番茄钟（关掉页面仍继续计时） |
| **随手记** | 灵感速记（回车即存）、情绪与精力打分、三十天趋势 |
| **AI 助手** | 内置对话面板，支持 39 个工具调用，可直接改课表、记账、加待办；写操作先弹确认 |

界面采用模块化侧栏布局，每个模块独立加载，可自由增删。

---

## 下载

**桌面版（Windows 10 / 11，64 位）** —— 免安装，解压即用：

> <https://github.com/lllyyyttt-xxx/workbench/releases/latest/download/workbench.zip>

约 151 MB。解压后双击 `工作台.exe`。首次运行 Windows 可能提示「未知发布者」，点
「更多信息 → 仍要运行」——没有做代码签名。数据存在 `%APPDATA%\工作台\`，卸载只需
删掉解压目录和数据文件夹。

**网页版**：任意静态服务器托管 `web/` 目录即可，详见下文。

> 说明：Release 里的 exe 是作者自用构建，AI 请求走作者自建的后台，**不保证长期可用**。
> 需要稳定使用请自行部署（源码完整开源），或在「设置 → 助手设置」里填自己的接口。

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

> 打包读取的是**当前目录**的 `desktop/`（`shell/package.json` 里 `extraResources`
> 指向 `../desktop`）。所以打出来的 exe 里有什么，取决于你这份代码里有什么。

---

## 目录结构

```
.
├── desktop/          桌面版的页面代码（纯 HTML/JS，无需构建）
│   ├── index.html
│   ├── app.js        主逻辑：路由、AI 面板、模块加载
│   ├── modules/      五个功能模块（english / life / challenge / time / notes）
│   └── shared/       公共层：同步、存储、设置、工具调用
│
├── shell/            Electron 外壳（把 desktop/ 打包成 exe）
│   ├── main.js       主进程：窗口、文件读写、跨域请求转发
│   ├── preload.js    暴露给页面的受限 API
│   └── package.json  打包配置
│
├── web/              在线版的页面 + 服务端函数
│   ├── index.html
│   ├── netlify/
│   │   └── functions/  三个服务端函数：账号、同步、AI 转发
│   └── netlify.toml    路由与 CORS 配置
│
└── docs/             截图与数据来源说明
```

`desktop/` 与 `web/` 的页面代码基本一致，差异在于：桌面版通过 Electron 主进程发送
网络请求（绕开 `file://` 的跨域限制），网页版直接调服务端。

---

## 词库与原文数据

仓库里的英语模块只带**可自由分发**的数据：

| 数据 | 来源 | 规模 |
|---|---|---|
| 四六级词库 | [ECDICT](https://github.com/skywind3000/ECDICT)（MIT） | 四级 3844 词、六级 1952 词 |
| 阅读文章 | 本项目作者原创（MIT） | 6 篇，98 句 |

**不含四六级考试真题原文**——那部分版权不属于本项目，请自行准备。详见
[docs/DATA-SOURCES.md](docs/DATA-SOURCES.md)。

### 数据结构

数据都在英语模块的 `<script>` 开头，每个数组占一行：

- 桌面版：`desktop/modules/english/index.html` 第 379–386 行
- 网页版：`web/modules/english/index.html` 第 381–388 行

| 变量 | 作用 | 字段 |
|---|---|---|
| `CET4_WORDS` | 四级词库 | `{ "w": 单词, "p": 音标, "pos": 词性, "m": 释义, "freq": 词频, "level": "cet4" }` |
| `CET6_WORDS` | 六级专属词库 | 同上，`level` 固定 `"cet6"` |
| `SENTS` | 句子 | `[出处, 小标题, 英文原句]`，小标题可留空字符串 |
| `PAPERS` | 文章 | `{ "l": 标题, "v": "cet4"/"cet6", "p": [[句子下标...], ...] }`，外层是段落 |
| `EXAM` | 单词出现在哪些文章 | `{ 单词: { "n": 次数, "f": [词形...], "p": [PAPERS 下标...] } }` |
| `SENT_INDEX` | 单词出现在哪些句子 | `{ 单词: { "i": [SENTS 下标...] } }` |

### 换自己的数据

三条规则：

1. **键一律小写**（查表时统一 `toLowerCase()`）。
2. **下标必须自洽**：`PAPERS[*].p` 指向 `SENTS`，`EXAM[*].p` 指向 `PAPERS`，
   `SENT_INDEX[*].i` 指向 `SENTS`。越界只会被静默过滤（表现为「读文章正文空白」），不会报错。
3. **`CET4_WORDS` 与 `CET6_WORDS` 不能重名**（合并去重时后者会被丢弃）。

把自备词表转成一行：

```js
const rows = require('./my-words.json');   // [{ w, p, pos, m, freq }]
const line = 'const CET4_WORDS = ' + JSON.stringify(rows.map(r => ({
  w: r.w, p: r.p || '', pos: r.pos || '', m: r.m, freq: r.freq || 0, level: 'cet4',
}))) + ';';
```

模块自带的「导出 / 导入」只处理**单词本与复习进度**，不含词库。

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

> 说明：`_store.js` 通过 `siteID + token` 显式连接 Blobs，因为 `netlify deploy --dir`
> 手动部署不会自动注入 `NETLIFY_BLOBS_CONTEXT`。

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
- **词库数据**：ECDICT（MIT），见 [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md)

选择零框架的原因很简单：这套东西要能在没有网络、没有构建工具的环境里打开就用，
而且十年后还能跑。

---

## 数据与隐私

- 所有业务数据存在你自己的设备或你自己的服务端存储里，不经过任何第三方
- AI 密钥只存在于服务端环境变量，前端代码里没有
- 账号以 `sha256(名字::访问码)` 存储，不保存明文
- 桌面版默认不联网也能用，同步需要手动开启

---

## 说明

代码里没有任何硬编码的服务端地址，两个地址默认是**空字符串**，需要你自己填：

- `desktop/app.js` 中的 `AI_REMOTE`（桌面版调用的服务端地址，留空则用「设置 → 助手设置」里填的接口）
- `desktop/shared/sync.js` 与 `web/shared/sync.js` 中的 `REMOTE`（同步后端地址，留空则用同源）

想用 AI：在「设置 → 助手设置」填接口地址、密钥、模型名，只存在本机。
想用多设备同步：自行部署 `web/` 到 Netlify，然后把 `REMOTE` 指向你的站点。

---

## License

[MIT](LICENSE)

词库数据来自 ECDICT，其许可与版权声明见 [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md)。
