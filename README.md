# QiushuiAI 插件

面向 [QiushuiAI](https://github.com/benjamin-qhy/qiushuiai) 的官方扩展、技能和组件。完整目录请访问 **[QiushuiAI 插件中心](https://benjamin-qhy.github.io/qiushuiai-addons/)**。

仓库开发和软件包生成需要 Bun 1.4.0 或更高版本。Bun 1.3 无法读取第 2 版锁文件；如果将仓库工具链回退到 Bun 1.4 以下，还必须一并撤销锁文件迁移。

> **智能体须知：**如何添加、修改和测试附加组件，请参阅 [AGENTS.md](AGENTS.md)。

---

## 安装附加组件

> **重要：**第一方 `qiushuiai-addons` 必须通过**由 GitHub 公开托管的 tarball URL** 安装。
> **不要**将示例、目录条目或运行时代码改成 npmjs.org 软件包说明，或改为通过身份验证读取 GitHub Packages。
> 运行时安装和移除必须无需软件包注册表身份验证即可完成。

### Web 界面（推荐）

打开**设置 → 附加组件**，选择一个附加组件，然后点击**安装**。重新加载 QiushuiAI，以启用新安装的运行时或 Web 入口。

### `pi install`

```bash
pi install https://benjamin-qhy.github.io/qiushuiai-addons/packages/qiushuiai-addon-sample-addon-0.1.12.tgz
```

### `bun add`

```bash
cd /workspace/.pi/extensions
bun add https://benjamin-qhy.github.io/qiushuiai-addons/packages/qiushuiai-addon-sample-addon-0.1.12.tgz
```

---

## 设置面板与配置

附加组件设置面板是从 `pi.web.entries` 加载的**浏览器模块**。

请按以下方式划分职责：

- **浏览器面板（`web/index.ts`）**
  - 使用 `globalThis.__qiushuiaiSettingsPaneRegistry` / `globalThis.__qiushuiai_web?.registerSettingsPane` 注册面板
  - 使用 `globalThis.__qiushuiaiPreactHtm` / `globalThis.__qiushuiaiPreact`
  - 通过 `GET` / `POST /agent/addons/api/<addon>/<action>` 读写非敏感配置；`config` 是常用的设置操作
  - 通过 `GET` / `POST /agent/keychain` 存储密钥
- **运行时入口（`index.ts` / `extension.ts`）**
  - 使用 `globalThis.__qiushuiai_registerAddonConfigApi(...)` 注册配置处理器
  - 将非敏感值保存在扩展 KV / 运行时存储中
  - 将令牌和密码保存在密钥链中

**不要**基于内部斜杠命令桥接机制构建设置面板。本仓库只使用 QiushuiAI `3.0.0` 的正式插件接口，不提供旧接口兼容层。

对于提供实质性 Web 界面的附加组件，最好在 `addons/<slug>/assets/` 下提交至少一张截图，并在附加组件的 README 中引用。
拍摄设置面板截图时，应将 microVM 用作干净的测试环境：优先采用基于 overlayfs 的临时附加组件视图，只拍摄目标面板，然后恢复测试环境。

另请参阅：
- [AGENTS.md](AGENTS.md)
- [`addons/sample-addon/README.md`](addons/sample-addon/README.md)

---

## 可用插件

当前仅保留以下 7 个插件，其余插件已从本仓库工作版本移除。

| 插件 | 技术标识 | 说明 |
|---|---|---|
| [导出时间线 PDF](addons/export-timeline-pdf/) | `export-timeline-pdf` | 将聊天时间线导出为 PDF，并保留头像和引用消息标记 |
| [看板编辑器](addons/kanban-editor/) | `kanban-editor` | 编辑工作区 .kanban.md 文件，并支持 Obsidian 风格的看板双向链接 |
| [可观测性](addons/observability/) | `observability` | 通过 OpenTelemetry 将错误和智能体轮次追踪到 Azure Application Insights 和本地 Graphite |
| [计划侧边栏](addons/plan-sidebar/) | `plan-sidebar` | 提供右侧会话计划栏、统一的计划更新动作和 Markdown 存储 |
| [插件示例](addons/sample-addon/) | `sample-addon` | 展示设置面板、钥匙串密钥、KV 配置和测试端点的插件开发模板 |
| [设置截图](addons/settings-dialog-screenshot/) | `settings-dialog-screenshot` | 用于截取 Pi Web 设置对话框紧凑画面的开发技能 |
| [工作区反馈日志](addons/vent/) | `vent` | 将可配置的工作区反馈日志能力集成到 QiushuiAI |

---

## 发布工作流

![事件顺序](assets/event-sequence.svg)

合并拉取请求后，可在 `main` 上触发相互独立的工作流：

1. **validate-metadata**——在拉取请求和 `main` 上检查目录元数据与 Earendil 兼容层
2. **sync-catalog**——附加组件或目录脚本发生变更后，重新生成 `catalog.json` 和根目录 `package.json` 的元数据
3. **build + deploy**——附加组件、目录、资源或构建发生变更后，重新构建网站和公开的 `.tgz` 文件
受支持的第一方运行时安装路径仅为 **GitHub Pages tarball URL**，不发布或依赖 GitHub Packages。

---

## 参与贡献

如何添加新的附加组件、运行元数据检查和进行本地测试，请参阅 [AGENTS.md](AGENTS.md)。
