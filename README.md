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
pi install https://benjamin-qhy.github.io/qiushuiai-addons/packages/qiushuiai-addon-proxmox-0.1.11.tgz
```

### `bun add`

```bash
cd /workspace/.pi/extensions
bun add https://benjamin-qhy.github.io/qiushuiai-addons/packages/qiushuiai-addon-proxmox-0.1.11.tgz
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
拍摄设置面板截图时，应将 microVM 用作干净的测试环境：优先采用基于 overlayfs 的临时附加组件视图，只拍摄目标面板，然后恢复 `cheapskate`，以便 microVM 可继续用于测试。

另请参阅：
- [AGENTS.md](AGENTS.md)
- [`addons/sample-addon/README.md`](addons/sample-addon/README.md)

---

## 可用插件

| 插件 | 技术标识 | 说明 |
|---|---|---|
| [A2A 智能体互联](addons/a2a/) | `a2a` | 提供需主动启用的 A2A v1 智能体互联、认证 JSON-RPC、持久任务和受控端点 |
| [AST 代码检索](addons/ast-grep-tool/) | `ast-grep-tool` | 将 ast-grep 作为原生智能体工具，用于结构化代码搜索和重写 |
| [自主研究](addons/autoresearch/) | `autoresearch` | 通过 tmux 运行可启动、停止和查看状态的自主实验循环子智能体 |
| [零成本模型路由](addons/cheapskate/) | `cheapskate` | 基于目录将请求路由到零成本模型，支持单次请求故障转移和仅免费模型设置面板 |
| [代码校验](addons/code-validator/) | `code-validator` | 提供 Python、JavaScript、TypeScript 和 JSON 诊断，并支持通过 validators.json 扩展 |
| [Codex 转换](addons/codex-conversion/) | `codex-conversion` | 为 QiushuiAI 提供感知供应商的 Codex 与 Copilot 提示词和工具配置 |
| [任务委派](addons/delegate/) | `delegate` | 将任务委派给操作者批准的子 Pi 模型，并采用默认拒绝的安全策略 |
| [开发工具](addons/dev-tools/) | `dev-tools` | 提供工作区诊断和运行环境检查工具 |
| [图表工具](addons/diagram-tools/) | `diagram-tools` | 提供 JSON 图定义、SVG 渲染器和颜色选择器组件的架构图工作流 |
| [draw.io 编辑器](addons/drawio-editor/) | `drawio-editor` | 提供自托管的 draw.io 图表编辑器，并与工作区文件集成 |
| [可编辑表格](addons/editable-table/) | `editable-table` | 在 Web 界面中编辑 Markdown 表格，并将修改后的内容插回对话 |
| [邮件文件查看器](addons/eml-viewer/) | `eml-viewer` | 在 Web 时间线中预览电子邮件 .eml 附件 |
| [导出时间线 PDF](addons/export-timeline-pdf/) | `export-timeline-pdf` | 将聊天时间线导出为 PDF，并保留头像和引用消息标记 |
| [Ghostty 终端](addons/ghostty-terminal/) | `ghostty-terminal` | 为高性能浏览器提供基于 Ghostty Web 的现代终端面板 |
| [Git 查询工具](addons/git-query-tools/) | `git-query-tools` | 为 QiushuiAI 智能体提供 Git 历史和 JSON 查询工具 |
| [目标管理](addons/goal/) | `goal` | 提供持久化线程目标、加固的自主续行循环和清晰的完成或停止摘要 |
| [图像处理](addons/image-processing/) | `image-processing` | 通过 sharp 提供缩放、裁剪、转换、合成等图像处理能力 |
| [IMAP 邮件管理](addons/imap/) | `imap` | 提供邮件搜索、读取、移动、复制、标记、草稿和 STARTTLS 支持 |
| [看板组件](addons/kanban-board-widget/) | `kanban-board-widget` | 在 Web 时间线中显示可交互的看板仪表盘 |
| [看板编辑器](addons/kanban-editor/) | `kanban-editor` | 编辑工作区 .kanban.md 文件，并支持 Obsidian 风格的看板双向链接 |
| [夜间反思](addons/late-night-regrets/) | `late-night-regrets` | 夜间训练贝叶斯交互质量分类器，识别行为模式并生成自我改进反思 |
| [Linkr 远程控制](addons/linkr/) | `linkr` | 提供 Radxa Linkr KVM 截图、受限 HID 操作、固件入口任务及 BIOS、启动和系统安装技能 |
| [轻量终端](addons/lite-term/) | `lite-term` | 提供基于 xterm.js 的轻量终端面板，适合作为终端定制起点 |
| [Microsoft 365 工具](addons/m365/) | `m365` | 提供 Teams、Graph、Outlook、OneDrive、SharePoint、日历和待办事项实验工具 |
| [思维导图](addons/mindmap/) | `mindmap` | 为 .mindmap.yaml 文件提供基于 D3 的思维导图编辑面板 |
| [可观测性](addons/observability/) | `observability` | 通过 OpenTelemetry 将错误和智能体轮次追踪到 Azure Application Insights 和本地 Graphite |
| [Office 文档工具](addons/office-tools/) | `office-tools` | 为 QiushuiAI 提供 DOCX、XLSX、PPTX、ODT 和 Markdown 转 PDF 的读写能力 |
| [Office 文档查看器](addons/office-viewer/) | `office-viewer` | 在 QiushuiAI 中查看 DOCX、XLSX、PPTX、ODT、ODS 和 ODP 文档 |
| [计划侧边栏](addons/plan-sidebar/) | `plan-sidebar` | 提供右侧会话计划栏、统一的计划更新动作和 Markdown 存储 |
| [Portainer 管理](addons/portainer/) | `portainer` | 提供会话级 API 配置和端点、堆栈、容器、镜像、网络及存储卷编排工作流 |
| [Proxmox 管理](addons/proxmox/) | `proxmox` | 提供会话级 API 配置和虚拟机、LXC、存储、任务及指标编排工作流 |
| [远程节点](addons/remote-peer/) | `remote-peer` | 通过 Iroh 提供基于客户端 ID 的节点聊天、显式配对、可靠投递和文件传输 |
| [插件示例](addons/sample-addon/) | `sample-addon` | 展示设置面板、钥匙串密钥、KV 配置和测试端点的插件开发模板 |
| [会话仪表盘](addons/session-dashboard/) | `session-dashboard` | 提供可下拉的活动会话仪表盘、近期工作摘要和上下文状态 |
| [会话树](addons/session-tree/) | `session-tree` | 为 QiushuiAI 的 /tree 命令提供基于快照的可交互会话树 |
| [设置截图](addons/settings-dialog-screenshot/) | `settings-dialog-screenshot` | 用于截取 Pi Web 设置对话框紧凑画面的开发技能 |
| [技能模型参数](addons/skill-model-effort/) | `skill-model-effort` | 让 QiushuiAI 技能支持模型、推理强度和思考参数前置元数据 |
| [智能上下文压缩](addons/smart-compaction/) | `smart-compaction` | 为原生 Pi 用户提供独立的智能上下文压缩扩展 |
| [隐身浏览器](addons/stealth-browser/) | `stealth-browser` | 通过 mochi.js 提供拟人交互、指纹一致性和反检测浏览器自动化 |
| [Telegram 频道](addons/telegram/) | `telegram` | 通过 Bot API 长轮询连接 Telegram，收发消息并转交智能体处理 |
| [工作区反馈日志](addons/vent/) | `vent` | 将可配置的工作区反馈日志能力集成到 QiushuiAI |
| [语音流水线](addons/voice-pipeline/) | `voice-pipeline` | 为 ThinkSmart 和 ESP32-Audio 设备提供基于 Azure STT/TTS 的 ESPHome 语音助手流水线 |
| [网页与媒体查看器](addons/web-viewer/) | `web-viewer` | 为 QiushuiAI 提供 HTML、图像和视频查看面板及路由 |
| [WhatsApp 频道](addons/whatsapp/) | `whatsapp` | 通过 Baileys 连接 WhatsApp Web，收发消息并转交智能体处理 |
| [Windows 界面自动化](addons/win-ui/) | `win-ui` | 通过 Win32 UI Automation 和截图提供 Windows 桌面自动化工具 |
| [写作字体](addons/writer-fonts/) | `writer-fonts` | 在编辑器底栏切换文档字体，并内置多种中西文字体 |
| [快捷操作按钮](addons/yolo-vibe/) | `yolo-vibe` | 在输入框底部操作栏提供继续、审计和文档快捷按钮 |
| [实例互聊](addons/yolochat/) | `yolochat` | 让多个 Pi 实例通过 HTTP 相互发帖和回复的无防护通信技能 |

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
