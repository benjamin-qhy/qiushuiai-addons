# 任务委派

将任务委派给操作者批准的子 Pi 模型，并采用默认拒绝的安全策略

## 功能定位

这是 QiushuiAI 的扩展插件，技术标识为 `delegate`。

- 软件包：`@qiushuiai/qiushuiai-addon-delegate`
- 当前版本：`0.2.11`
- 兼容版本：QiushuiAI `>=3.0.0`
- 展示标签：`任务委派`、`多模型`、`成本优化`、`核心推荐`
- 推荐级别：核心推荐

## 安装

在 QiushuiAI 中打开**设置 → 插件**，搜索“任务委派”并安装。也可以直接使用无需登录的公开安装包：

```text
https://benjamin-qhy.github.io/qiushuiai-addons/packages/qiushuiai-addon-delegate-0.2.11.tgz
```

安装或更新后，请按 QiushuiAI 的提示重新加载相关运行时入口。

## 提供的能力

- 入口：`index.ts`
- 入口：`web/index.ts`
- 技能：`skills`
- 技能：`delegate`

## 配置与安全

请优先通过插件设置面板完成配置。普通配置由插件配置接口保存；令牌、密码等敏感信息应存入 QiushuiAI 密钥链。不要把真实凭据写进工作区文件、日志或版本库。

## 技术资料

完整的原始技术说明、配置示例和故障排查资料保存在 [英文技术资料](https://github.com/benjamin-qhy/qiushuiai-addons/blob/main/addons/delegate/README.en.md)。代码中的工具名、参数名、接口路径和第三方品牌保留原始技术名称。
