> 历史记录：2026-09-21 起本仓库仅保留 README 所列 7 个插件。下文其他插件不属于当前维护范围。

# QiushuiAI 插件生态 v3 指导开发方案

- 状态：`qiushuiai-addons` 本地实施完成；`qiushuiai` 主项目待用户确认后开始
- 日期：2026-09-20
- 涉及仓库：`qiushuiai-addons`、`qiushuiai`
- 目标版本：QiushuiAI `3.0.0`、插件目录 `v3`

## 1. 目标与边界

本次工作将现有插件生态完整迁移为 QiushuiAI 正式发布版本，覆盖网站品牌、插件包名、安装地址、清单字段、运行时扩展接口、环境变量、浏览器存储键、中文内容和发布流程。

不保留旧 Piclaw 插件、配置、环境变量、存储键或运行时接口的兼容层，不迁移旧数据。

保留以下真实技术名称：

- Pi Coding Agent
- `pi.extensions`、`pi.skills`
- `@earendil-works/pi-*`
- 第三方产品和技术品牌
- Git 历史与本地只读 upstream 地址
- 历史研究、历史 ADR、测试基线和真实上游证据中的原始名称

历史资料不得进入用户面向的正式网站和产品界面。

本次不进行桌面端、移动端或其他视口的视觉验收，只进行自动化、目录、包结构和隔离环境功能验收。

## 2. 开发前阻塞条件

`qiushuiai-addons` 当前可以从干净基线创建专用工作树。

`qiushuiai` 当前位于 `codex/project-capability-configuration`，并有大量未提交修改，其中以下文件与本次工作重叠：

- `runtime/src/channels/web/handlers/addons.ts`
- `runtime/src/addons/installed-addon-registry.ts`
- `runtime/src/addons/runtime-contributions.ts`
- `runtime/src/addons/installed-task-addons.ts`
- `runtime/src/agents/capabilities.ts`
- `client/src/features/settings/AdditionalSettingsPanels.tsx`

开始实施前必须：

1. 完成或妥善保存当前项目能力配置工作。
2. 确定该工作的最终提交或合并基线。
3. 从最终基线创建新的品牌迁移工作树。
4. 不在当前脏工作区直接实施品牌迁移。

建议分支：

```text
qiushuiai-addons: codex/qiushuiai-addon-identity-v3
qiushuiai:        codex/qiushuiai-addon-catalog-v3
```

## 3. 跨仓库接口：Catalog v3

Catalog v3 是两个仓库之间唯一稳定的接口：

- `qiushuiai-addons` 是目录生产端。
- `qiushuiai` 是目录消费端。
- 包名、版本、中文信息、兼容版本和安装地址全部通过 Catalog v3 传递。
- 两个仓库不得各自散落地拼接包名前缀和安装地址。

### 3.1 插件清单格式

```json
{
  "name": "@qiushuiai/qiushuiai-addon-goal",
  "version": "0.1.49",
  "description": "提供持久化目标管理和自动续行能力",
  "qiushuiai": {
    "displayName": "目标管理",
    "type": "extension",
    "compatibleVersions": ">=3.0.0",
    "categories": ["goal", "automation", "productivity"],
    "displayTags": ["目标", "自动化", "效率"],
    "featured": true
  },
  "pi": {
    "extensions": ["index.ts"]
  }
}
```

字段职责：

- `categories`：稳定的机器分类，不依赖翻译。
- `displayTags`：网站和主程序显示的中文标签。
- `featured`：核心推荐标识，替代通过本地化标签判断程序行为。
- `pi`：保留真实的底层技术协议字段。

### 3.2 Catalog v3 条目格式

```json
{
  "slug": "goal",
  "name": "@qiushuiai/qiushuiai-addon-goal",
  "displayName": "目标管理",
  "version": "0.1.49",
  "type": "extension",
  "description": "提供持久化目标管理和自动续行能力",
  "categories": ["goal", "automation", "productivity"],
  "displayTags": ["目标", "自动化", "效率"],
  "featured": true,
  "compatibleVersions": ">=3.0.0",
  "install": {
    "kind": "tarball",
    "spec": "https://benjamin-qhy.github.io/qiushuiai-addons/packages/qiushuiai-addon-goal-0.1.49.tgz"
  }
}
```

Catalog 顶层：

```json
{
  "version": 3,
  "source": "github:benjamin-qhy/qiushuiai-addons",
  "addons": []
}
```

### 3.3 接口不变量

- 包名必须匹配：

  ```regex
  ^@qiushuiai/qiushuiai-addon-[a-z0-9][a-z0-9._-]{0,63}$
  ```

- slug 保持简短，不添加品牌前缀。
- `compatibleVersions` 不低于 `>=3.0.0`。
- 第一方安装类型只能是公开 `tarball`。
- 下载地址只能来自新的 GitHub Pages。
- `displayName`、`description`、`displayTags` 必须是中文用户文案。
- `categories`、slug、命令、参数和接口名称保持技术格式。

## 4. PR 1：迁移 qiushuiai-addons

### 4.1 先定义契约测试

新增测试并先确认其在旧实现下失败：

- 必须恰好包含 48 个插件。
- 48 个包名全部符合新规则。
- 不允许出现 `@rcarmo/*`。
- 不允许出现 `piclaw-addon-*`。
- 每个插件都有中文名称、简介和标签。
- 每个插件都声明 `qiushuiai.compatibleVersions`。
- 目录版本必须是 3。
- 所有安装 URL 必须是公开的新 Pages 地址。
- `featured` 插件集合必须与当前核心推荐集合一致。
- slug、包名后缀和安装包文件名必须相互对应。

建议新增深模块：

```text
scripts/lib/qiushuiai-addon-identity.ts
```

它只提供少量接口：

```ts
parseAddonPackageName(name)
tarballFileName(manifest)
catalogEntryFromManifest(manifest, slug)
validateCatalog(catalog)
```

目录生成器、网站生成器和测试统一调用该模块。

### 4.2 批量迁移插件清单

对每个 `addons/*/package.json` 执行：

- `@rcarmo/piclaw-addon-*` 改为 `@qiushuiai/qiushuiai-addon-*`。
- `piclaw` 元数据字段改为 `qiushuiai`。
- 增加 `displayName`。
- 简介改为中文。
- 增加 `categories`。
- 增加 `displayTags`。
- 核心推荐插件增加 `featured: true`。
- `compatibleVersions` 调整为 `>=3.0.0`。
- 仓库、主页和问题地址切换到 `benjamin-qhy/qiushuiai-addons`。
- 各插件提升一个补丁版本。
- 根包改为 `@qiushuiai/qiushuiai-addons@3.0.0`。

不要手工维护生成后的 `catalog.json`。必须先修改生成逻辑，再执行同步。

### 4.3 迁移插件接口与配置

范围包括：

- `globalThis.__piclaw_*` 改为 `globalThis.__qiushuiai_*`。
- `PICLAW_*` 改为 `QIUSHUIAI_*`。
- `piclaw_*` 本地存储键改为 `qiushuiai_*`。
- 测试临时目录和所有权标记改名。
- 日志前缀改名。
- 设置面板注册器改名。
- 配置处理器改名。
- 示例代码和当前开发文档改名。

禁止添加旧名称兼容分支。

### 4.4 完成 48 个插件中文化

每个插件至少包括：

- 中文 README
- 中文展示名
- 中文简介
- 中文设置面板标题
- 中文按钮和状态提示
- 中文用户错误提示
- 中文网站详情

保持原文：

- 工具名
- 参数名
- 接口路径
- JSON 字段
- 文件扩展名
- 第三方品牌
- 可直接执行的命令

翻译不得机械替换代码块和 URL。

### 4.5 改造网站

- 标题改为“QiushuiAI 插件中心”。
- 页面语言改为 `zh-CN`。
- 卡片主标题使用中文名。
- slug 作为较小的技术标识。
- 标签使用 `displayTags`。
- 核心推荐使用 `featured`。
- 搜索同时索引中文和英文技术标识。
- SEO、分享卡片和无障碍文案全部中文化。
- 复制、下载、返回和安装提示全部中文化。
- 使用主程序正式图标替换当前图标。
- 页脚改成 QiushuiAI 当前信息。

不做桌面端和移动端视觉验收，只做生成结果和交互逻辑自动检查。

### 4.6 调整发布流程

- 公开安装包只发布到 GitHub Pages。
- 移除 GitHub Packages 发布工作流。
- tarball 文件名改为 `qiushuiai-addon-*.tgz`。
- 构建流程不得依赖注册表认证。
- Pages 发布前验证 48 个包全部生成。
- 不把本地生成的 `docs/` 作为人工维护源；网站以生成器和插件清单为准。

## 5. PR 1 本地门禁

依次执行：

```bash
bun install
bun install --frozen-lockfile
bun run sync:catalog
bun run check:catalog
bun test build.test.ts
bun run typecheck:earendil-compat
bun run test:earendil-compat
bun test standalone-import.test.ts
bun test
bun pm pack --dry-run
bun run build.ts
```

新增品牌审计：

```bash
bun run audit:brand
```

在产品控制范围内检查以下旧标识：

```text
piclaw
PiClaw
piclaw-addon
@rcarmo
rcarmo.github.io/piclaw-addons
__piclaw_
PICLAW_
piclaw_
```

历史研究、历史 ADR 和真实上游证据通过精确文件白名单排除，禁止使用整个 `docs/` 目录的粗粒度排除。

## 6. PR 1 合并后的线上检查点

继续主程序 PR 前必须验证：

1. 新 `catalog.json` 可匿名访问。
2. 目录版本为 3。
3. 目录恰好包含 48 个插件。
4. 48 个 tarball 均可匿名下载。
5. 每个 tarball 解压后的 `package.json` 名称正确。
6. 网站首页显示 48 个中文插件。
7. 插件详情来自中文 README。
8. 页面和安装包不依赖登录或 GitHub Packages。
9. 网站源代码和生成页面通过品牌审计。

任一项失败，都不能继续切换主程序默认目录。

## 7. PR 2：迁移 qiushuiai 主程序

### 7.1 增加 Catalog v3 消费模块

建议新增深模块：

```text
runtime/src/addons/qiushuiai-addon-catalog.ts
```

小接口示例：

```ts
parseCatalog(payload)
validateCatalogEntry(entry)
deriveAddonId(packageName)
resolveInstalledAddon(packageName)
```

该模块负责隐藏：

- v3 目录解析
- 包名规则
- slug 推导
- 兼容版本判断
- tarball 来源校验
- 错误格式化

安装器、能力管理、运行时贡献和设置界面只依赖该接口。

主要接入位置：

- `runtime/src/channels/web/handlers/addons.ts`
- `runtime/src/addons/installed-addon-registry.ts`
- `runtime/src/addons/external-routes.ts`
- `runtime/src/addons/installed-task-addons.ts`

### 7.2 切换正式插件身份

- 默认目录改为新的 Catalog v3。
- 只接受 `@qiushuiai/qiushuiai-addon-*`。
- 删除旧包名正则分支。
- 更新固定的代码校验插件策略。
- 更新安装目录解析。
- 更新任务插件 ID 推导。
- 更新能力快照中的包名。
- 更新 Web 静态资源路由的包名验证。
- 更新所有相关测试夹具。

### 7.3 完成产品标识清理

- `__piclaw_*` 改为 `__qiushuiai_*`。
- `PICLAW_*` 改为 `QIUSHUIAI_*`。
- `piclaw_*` 浏览器存储键改为 `qiushuiai_*`。
- 默认目录 URL 更新。
- 当前 README 和产品文档更新。
- 主程序和客户端版本升级为 `3.0.0`。
- 不读取、不复制、不迁移旧键值。
- 不保留旧环境变量别名。

现有品牌迁移 ADR 继续有效；另外新增“QiushuiAI 插件身份与 Catalog v3”ADR，编号使用实施时下一个可用编号。

## 8. PR 2 测试门禁

优先运行：

```bash
bun test runtime/test/channels/web/addon-install-registry.test.ts
bun test runtime/test/addons/external-routes.test.ts
bun test runtime/test/agent-pool/installed-addons.test.ts
bun test runtime/test/agents/capabilities.test.ts
bun run typecheck
bun run build:web
make ci-fast
```

隔离实例功能验收：

- 获取默认目录。
- 安装普通扩展插件。
- 安装带 Web/运行时入口的插件。
- 安装纯技能插件。
- 安装带依赖的插件。
- 启用、停用、重新启用。
- 卸载并确认注册信息清理。
- 拒绝旧 `piclaw-addon-*` 包。
- 拒绝伪造域名或错误包名的目录条目。
- 确认全程无需注册表认证。

不进行桌面端或移动端视觉验收。

## 9. 提交与发布顺序

### PR 1：qiushuiai-addons

建议提交分组：

1. `test: define qiushuiai addon catalog v3 contract`
2. `refactor: migrate addon package identity to qiushuiai`
3. `docs: localize addon metadata and documentation`
4. `feat: publish qiushuiai addon catalog and website`

合并后等待 Pages 发布，并完成 48 包远程验证。

### PR 2：qiushuiai

建议提交分组：

1. `test: define qiushuiai addon catalog consumer contract`
2. `refactor: adopt qiushuiai addon package identity`
3. `refactor: remove legacy brand interfaces`
4. `docs: document catalog v3 and release contract`
5. `release: prepare qiushuiai 3.0.0`

只有 PR 1 线上验证通过后，PR 2 才能合并。

最后再创建并推送 QiushuiAI `3.0.0` 标签。创建标签和正式发布必须单独获得授权，不能由“合并 PR”自动推断。

## 10. 完成定义

只有同时满足以下条件才算完成：

- 两个 PR 均已合并。
- 48 个新包均已公开发布并验证。
- 主程序默认使用 Catalog v3。
- 主程序不接受旧插件包名。
- 产品控制范围不存在旧品牌标识。
- 48 个插件均有完整中文信息。
- 所有指定测试通过。
- 隔离环境安装、启用、停用和卸载成功。
- QiushuiAI `3.0.0` 发布产物引用新的插件生态。
- 没有修改或清理用户当前的运行数据。

## 11. 当前实施进度

截至 2026-09-20，`qiushuiai-addons` 的本地开发已完成：

- Catalog v3 已固定为 48 个插件。
- 包名已统一为 `@qiushuiai/qiushuiai-addon-*`，插件版本均已提升。
- 中文目录、中文 README、中文展示名和设置入口已完成。
- 运行时全局接口、环境变量、存储键和测试隔离标识已切换为 QiushuiAI。
- 公开安装路径只使用 GitHub Pages tarball，GitHub Packages 发布流程已移除。
- 本地构建已生成 48 个 tarball，其内部包名和版本与 Catalog v3 一致。
- 品牌审计、类型检查、兼容性测试、独立导入和全量自动化测试已通过。

尚未执行的是合并后线上 Pages 检查，以及等待用户确认后开始的 `qiushuiai` 主项目改造。
