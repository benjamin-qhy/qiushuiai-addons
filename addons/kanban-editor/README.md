# 看板编辑器

编辑工作区 .kanban.md 文件，并支持 Obsidian 风格的看板双向链接

## 功能定位

这是 QiushuiAI 的扩展插件，技术标识为 `kanban-editor`。

- 软件包：`@qiushuiai/qiushuiai-addon-kanban-editor`
- 当前版本：`0.1.3`
- 兼容版本：QiushuiAI `>=3.0.0`
- 展示标签：`看板`、`编辑器`、`工作区`、`Markdown 编辑`、`双向链接`

## 安装

在 QiushuiAI 中打开**设置 → 插件**，搜索“看板编辑器”并安装。也可以直接使用无需登录的公开安装包：

```text
https://benjamin-qhy.github.io/qiushuiai-addons/packages/qiushuiai-addon-kanban-editor-0.1.3.tgz
```

安装或更新后，请按 QiushuiAI 的提示重新加载相关运行时入口。

## 提供的能力

- 入口：`index.ts`
- 入口：`web/index.ts`

在看板文本中写入 `[[ops-roadmap]]` 这类双向链接时，插件会在普通工作区标签页或编辑器中打开目标看板。

## 配置与安全

请优先通过插件设置面板完成配置。普通配置由插件配置接口保存；令牌、密码等敏感信息应存入 QiushuiAI 密钥链。不要把真实凭据写进工作区文件、日志或版本库。

## 技术资料

完整的原始技术说明、配置示例和故障排查资料保存在 [英文技术资料](https://github.com/benjamin-qhy/qiushuiai-addons/blob/main/addons/kanban-editor/README.en.md)。代码中的工具名、参数名、接口路径和第三方品牌保留原始技术名称。
