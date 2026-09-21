# 开发 qiushuiai 附加组件

本指南介绍如何为 [qiushuiai](https://github.com/benjamin-qhy/qiushuiai) 创建、测试和发布扩展。

---

## 快速开始

> **安装路径规则：**第一方 `qiushuiai-addons` 必须通过 `catalog.json` 中**由 GitHub 公开托管的 tarball URL** 安装。
> **不要**将文档、生成的目录条目或运行时集成改回 npmjs.org 软件包说明，或改为通过身份验证读取 GitHub Packages。
> 运行时安装和移除必须始终无需身份验证。


```bash
# 1. 创建附加组件目录
mkdir -p addons/my-addon/skills/my-skill

# 2. 编写入口文件、package.json 和技能
# 3. 同步目录
bun run sync:catalog

# 4. 验证仓库约定
bun install --frozen-lockfile
bun run check:catalog
bun run typecheck:earendil-compat
bun run test:earendil-compat
bun test standalone-import.test.ts
bun pm pack --dry-run

# 5. 在功能分支上提交，并创建拉取请求
git switch -c feat/my-addon
git add addons/my-addon package.json catalog.json
git commit -m "feat: add my-addon"
git push -u origin feat/my-addon
gh pr create
```

---

## 附加组件结构

> **重要：**独立附加组件软件包必须自包含。
> 如果附加组件以独立 npm 软件包的形式发布（例如 `@qiushuiai/qiushuiai-addon-portainer`），运行时不得依赖其软件包目录之外的仓库根目录文件。除非已将相关文件内置到软件包中，否则不要在已发布的独立软件包中导入 `../../lib/compat/*`。

```
addons/<slug>/
├── index.ts          # 运行时入口（默认导出）
├── web/
│   └── index.ts      # 可选的浏览器端设置面板 / Web 入口
├── package.json      # 软件包清单
├── skills/           # 可选：智能体技能
│   └── my-skill/
│       └── SKILL.md
└── *.ts              # 支持模块
```

---

## 入口文件

默认导出是一个接收 `ExtensionAPI` 的函数：

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const baseDir = dirname(fileURLToPath(import.meta.url));

export default function myAddon(pi: ExtensionAPI) {
  // 注册技能，以便智能体发现
  pi.on("resources_discover", () => ({
    skillPaths: [join(baseDir, "skills", "my-skill", "SKILL.md")],
  }));

  // 注册工具
  pi.registerTool({
    name: "my_tool",
    label: "my_tool",
    description: "此工具的用途。",
    parameters: MyToolSchema,
    async execute(_toolCallId, params, _signal, _update, ctx) {
      return { content: [{ type: "text", text: "结果" }] };
    },
  });
}
```

---

## package.json

```json
{
  "name": "@qiushuiai/qiushuiai-addon-<slug>",
  "version": "0.1.0",
  "description": "一句话说明",
  "type": "module",
  "main": "index.ts",
  "qiushuiai": {
    "displayName": "中文展示名",
    "type": "extension",
    "compatibleVersions": ">=3.0.0",
    "categories": ["machine-category"],
    "displayTags": ["中文标签"],
    "featured": false
  },
  "pi": {
    "extensions": ["index.ts"],
    "web": {
      "entries": ["web/index.ts"]
    },
    "skills": ["skills"]
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@sinclair/typebox": "*"
  },
  "keywords": ["qiushuiai", "qiushuiai-addon"],
  "license": "MIT"
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | ✓ | `@qiushuiai/qiushuiai-addon-<slug>` |
| `version` | ✓ | 每次功能变更都必须提升版本号 |
| `description` | ✓ | 显示在目录和 Web 界面中 |
| `qiushuiai.displayName` | ✓ | 中文展示名 |
| `qiushuiai.type` | ✓ | `"extension"` 或 `"skill"` |
| `qiushuiai.compatibleVersions` | ✓ | 当前正式目录统一为 `>=3.0.0` |
| `qiushuiai.categories` | ✓ | 稳定的英文机器分类，用于检索和程序判断 |
| `qiushuiai.displayTags` | ✓ | 用于网站和主程序展示的中文标签 |
| `qiushuiai.featured` | ✓ | 是否为核心推荐插件；不得根据中文标签推断 |
| `pi.extensions` | ✓ | 入口文件——通常为 `["index.ts"]` |
| `peerDependencies` | ✓ | 必须声明导入的 Pi 核心软件包（`@earendil-works/pi-coding-agent`、`@earendil-works/pi-ai`、`@earendil-works/pi-tui`），导入 `@sinclair/typebox` 时也必须声明 |


---

## 技能

技能会教智能体在*何时以及如何*使用你的工具：

```
addons/<slug>/skills/<skill-name>/SKILL.md
```

前置元数据：
```yaml
---
name: my-skill
description: 此技能教给智能体的内容
distribution: public
---
```

通过 `resources_discover` 注册技能：
```ts
pi.on("resources_discover", () => ({
  skillPaths: [join(baseDir, "skills", "my-skill", "SKILL.md")],
}));
```

---

## 扩展 API 参考

| 能力 | 方法 |
|---|---|
| 注册工具 | `pi.registerTool({ name, parameters, execute })` |
| 生命周期钩子 | `pi.on("before_agent_start", fn)` |
| 资源发现 | `pi.on("resources_discover", fn)` |
| 交互式界面 | `ctx.ui.select()`, `.confirm()`, `.input()` |
| 进度 | `ctx.ui.setWorkingMessage(text)` |
| 状态 | `ctx.ui.setStatus(key, text)` |
| 小组件 | `ctx.ui.setWidget(key, content, options)` |
| 提示通知 | `ctx.ui.notify(message, type)` |

### 工具参数

使用 `@sinclair/typebox`。封闭的字符串选项应写成 `Type.String({ enum: [...] })`；不要使用字面量联合类型，因为某些提供商的模式方言会拒绝它们：

```ts
import { Type } from "@sinclair/typebox";

const Params = Type.Object({
  action: Type.String({ enum: ["get", "list"] }),
  id: Type.Optional(Type.String()),
});
```

### KV 存储

持久化配置或状态：

```ts
import { createExtensionStorage } from "./compat/extension-kv.js";

const kv = createExtensionStorage("my-addon");
kv.set("config", value, "chat", chatJid);   // 每个聊天独立
kv.set("prefs", value, "global");            // 跨聊天共享
```

### 设置面板与直接配置 API

对于提供**设置**面板的附加组件：

#### 运行时端

使用 qiushuiai 暴露的全局注册器，直接从运行时入口注册配置处理器：

```ts
const registerAddonConfigApi = globalThis.__qiushuiai_registerAddonConfigApi;

registerAddonConfigApi?.("my-addon", "config", {
  get: async () => loadConfig(),
  set: async (payload) => {
    const next = saveConfig(payload);
    return { ok: true, config: next };
  },
}, import.meta.dir);
```

#### 浏览器端

使用 qiushuiai 提供的浏览器全局对象，并请求经过身份验证的本地配置 API：

```ts
const API = "/agent/addons/api/my-addon";
const preactHtm = globalThis.__qiushuiaiPreactHtm || globalThis.__qiushuiaiPreact;

await fetch(`${API}/config`);
await fetch(`${API}/config`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ enabled: true }),
});
```

`/agent/keychain` 仅用于密钥。**不要**围绕内部斜杠命令构建新的设置面板。

---

## 测试

单元测试必须保留仓库和测试目录 `bunfig.toml` 中的预加载配置。每次运行都会在导入附加组件前隔离工作区、数据库、主目录、Pi 配置和临时目录，并移除继承的生产环境凭据。新建的测试目录需要有自己的预加载配置（系统会自动检查）。浏览器测试必须明确指定可随时销毁的 `QIUSHUIAI_E2E_URL`、`QIUSHUIAI_E2E_DISPOSABLE=1`；如果启用了身份验证，还必须指定仅供测试使用的 `QIUSHUIAI_E2E_INTERNAL_SECRET`。切勿将当前活动实例作为默认测试目标。

`prepare-addon-test-instance.ts` 始终会创建一个全新的临时工作区，并输出其路径。它绝不会安装到继承的 `QIUSHUIAI_WORKSPACE` 中。在可随时销毁的运行时停止之前，保留所准备的目录；之后只移除输出中明确归属本次测试的根目录。

### 独立导入测试

```bash
bun test standalone-import.test.ts
```

验证 `standalone-import.test.ts` 中所列附加组件能否独立导入。

### 兼容性检查

```bash
bun run typecheck:earendil-compat
bun run test:earendil-compat
bun pm pack --dry-run
```

对于浏览器层面的附加组件变更，运行 `bun run addon:e2e`；如需测试完整的附加组件矩阵，则使用 `bun run addon:e2e:all`。

### 目录验证

```bash
bun run check:catalog
```

### 界面截图工作流（推荐）

对于带有设置面板或其他实质性 Web 界面的附加组件，贡献者应从 **microVM 测试实例**中截取画面，并将截图与附加组件文档一同提交。

推荐流程：

1. 使用 `microvm-ui-test` 技能在 microVM 上部署和测试
2. 将 microVM 准备成目标附加组件的**干净截图环境**：
   - microVM 的附加组件目录应优先使用临时 **overlayfs** 挂载，避免破坏性地反复复制和删除
   - 在该覆盖层中只安装或暴露目标附加组件
3. 使用共享脚本截取界面：
   ```bash
   cd /workspace/qiushuiai-addons
   PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright \
     bun run scripts/capture-addon-settings-screenshot.ts \
     --url http://192.168.1.78:8080 \
     --pane "<面板标签>" \
     --out addons/<slug>/assets/settings-pane-microvm.png
   ```
4. 在 `addons/<slug>/README.md` 中引用该截图
6. 带设置面板的附加组件最好至少提供一张截图；非界面附加组件可不提供截图

尽可能将截图存放在 `addons/<slug>/assets/` 下，以便 README 使用稳定的相对路径引用。

---

## 发布

### CI 中会执行什么

1. `validate-metadata` 会在拉取请求和推送到 `main` 时运行；它会检查生成的元数据和 Earendil 兼容性。
2. 附加组件或目录脚本发生变更后，`sync-catalog` 会在 `main` 上运行，并可能同时更新 `catalog.json` 和根目录的 `package.json`。
3. 附加组件、目录、资源或构建发生变更后，`build + deploy` 会在 `main` 上运行，并发布 GitHub Pages 网站和公开的 `.tgz` 文件。
4. Pages 构建会校验并发布当前保留的 7 个公开 tarball；仓库不使用 GitHub Packages。

### 手动同步

```bash
bun run sync:catalog    # 重新生成
bun run check:catalog   # 只验证（不同步时以状态码 1 退出）
```

### 同步之后

在 `catalog.json` 的新条目中添加 `owner` 和 `contributors`——这些字段由人工维护，同步脚本会保留它们，但无法自动生成：

```json
"owner": { "login": "你的用户名", "url": "https://github.com/你的用户名" },
"contributors": []
```

---

## 约定

- 短标识：使用小写 kebab-case（`proxmox`、`dev-tools`、`kanban-board-widget`）
- 每个附加组件只设一个扩展入口
- 只使用对等依赖——绝不打包导入的 Pi 核心软件包（`@earendil-works/pi-coding-agent`、`@earendil-works/pi-ai`、`@earendil-works/pi-tui`）
- 绝不从 qiushuiai 运行时内部模块导入
- `lib/compat/` 仅供仓库内开发使用——已发布的软件包必须内置自身所需的所有兼容层
- 浏览器端设置面板必须使用**直接的后端附加组件配置 API**（`/agent/addons/api/<addon>/<action>`），密钥仍应通过 `/agent/keychain` 处理
- 运行时端的设置和配置处理器应在模块加载时通过 `globalThis.__qiushuiai_registerAddonConfigApi(...)` 注册，使 Web 面板不依赖斜杠命令
- v3 不提供旧版斜杠命令配置桥接；禁止依赖 `/addon-config-get` / `/addon-config-set`
- 设置面板附加组件的界面发生实质性变化时，应至少包含一张从 microVM 测试实例截取并提交到 README 的截图
- 技能应放在 `skills/<name>/SKILL.md` 中
- 每次功能变更都必须提升版本号
- 每次编辑 `package.json` 后都要运行 `sync:catalog`
- 第一方附加组件的目录安装条目必须保持 `kind: "tarball"`，并使用公开的 `https://benjamin-qhy.github.io/qiushuiai-addons/packages/...tgz` URL

## Git 工作流

- **始终使用拉取请求**——绝不直接提交到 `main`
- 创建功能分支，提交并推送，然后通过 `gh pr create` 创建拉取请求
- 等待用户批准或明确说“合并”后再执行合并
- 使用 `gh pr merge --merge --delete-branch` 完成合并和清理
- 拉取请求说明应包含：摘要、变更内容、测试结果
- 每个拉取请求只包含一项逻辑变更；不要捆绑无关工作

### 工作树

- 并行工作时使用 `git worktree add`，不要在主检出目录中切换分支
- 合并拉取请求后，移除工作树（`git worktree remove <path>`），并通过 `git worktree list` 确认已清理
- 开始新工作前，运行 `git worktree list`，并清理所有陈旧或孤立的工作树（`git worktree prune`）
- 绝不保留已合并分支的工作树

## 当前维护范围

仅保留 sample-addon、observability、settings-dialog-screenshot、export-timeline-pdf、kanban-editor、vent、plan-sidebar。其余插件已移除，未经用户要求不要恢复或继续其开发测试。
