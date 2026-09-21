# QiushuiAI 插件架构

## Catalog v3

`catalog.json` 是 QiushuiAI 主程序消费的正式插件目录。它由 `scripts/sync-catalog.ts` 根据每个插件的 `package.json` 自动生成，不应手工维护；`owner` 和 `contributors` 是例外，同步时会保留。

目录条目示例：

```json
{
  "slug": "proxmox",
  "name": "@qiushuiai/qiushuiai-addon-proxmox",
  "displayName": "Proxmox 管理",
  "version": "0.1.11",
  "compatibleVersions": ">=3.0.0",
  "install": {
    "kind": "tarball",
    "spec": "https://benjamin-qhy.github.io/qiushuiai-addons/packages/qiushuiai-addon-proxmox-0.1.11.tgz"
  }
}
```

- `categories`：稳定的机器分类。
- `displayName`、`description`、`displayTags`：中文用户文案。
- `featured`：是否为核心推荐插件。
- `install.spec`：无需登录即可下载的 GitHub Pages tarball。

## 安装流程

1. QiushuiAI 获取 GitHub Pages 上的 Catalog v3。
2. 用户在“设置 → 插件”中选择插件。
3. 主程序下载 `install.spec` 指向的公开 tarball。
4. 安装记录保留同一个公开 URL，供升级和卸载使用。
5. 重新加载后，运行时读取 `pi.extensions`，浏览器端读取 `pi.web.entries`。

第一方插件的安装和卸载全程无需认证，不使用 npmjs.org 或需要令牌的 GitHub Packages。

## 设置面板配置流程

浏览器端 `web/index.ts`：

- 通过 QiushuiAI 提供的设置面板注册器注册。
- 使用 `globalThis.__qiushuiaiPreactHtm` 或 `globalThis.__qiushuiaiPreact` 渲染。
- 通过 `GET/POST /agent/addons/api/<addon>/config` 读写非密钥配置。
- 密钥只通过 `/agent/keychain` 处理。

运行时端 `index.ts` 或 `extension.ts`：

- 通过 `globalThis.__qiushuiai_registerAddonConfigApi(...)` 注册配置处理器。
- 非密钥设置存入扩展 KV 或运行时存储。
- 运行时从密钥链解析密钥。

v3 不提供旧版斜杠命令配置桥接。

## 仓库结构

```text
qiushuiai-addons/
├── addons/               # 独立插件包
├── assets/               # 站点资源和架构图
├── lib/compat/           # 仅供仓库内开发的兼容层
├── scripts/              # 目录、审计和测试脚本
├── build.ts              # 中文静态站点和 tarball 构建器
├── catalog.json          # 自动生成的 Catalog v3
└── package.json          # @qiushuiai/qiushuiai-addons
```

## CI/CD

- `validate-metadata`：校验目录、品牌、兼容性和独立导入。
- `sync-catalog`：重新生成 `catalog.json` 和根包元数据。
- `build`：构建中文站点、48 个公开 tarball，并部署 GitHub Pages。
- `triage-issues`：按 slug 和分类处理问题。

```bash
bun run check:catalog
bun run sync:catalog
bun run audit:brand
```
