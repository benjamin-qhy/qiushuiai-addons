# 可观测性

通过 OpenTelemetry 将错误和智能体轮次追踪到 Azure Application Insights 和本地 Graphite

## 功能定位

这是 QiushuiAI 的扩展插件，技术标识为 `observability`。

- 软件包：`@qiushuiai/qiushuiai-addon-observability`
- 当前版本：`0.1.18`
- 兼容版本：QiushuiAI `>=3.0.0`
- 展示标签：`可观测性`、`链路追踪`、`遥测`、`开放遥测`、`应用洞察`、`Graphite 指标`、`指标`、`实时指标`、`核心推荐`
- 推荐级别：核心推荐

## 安装

在 QiushuiAI 中打开**设置 → 插件**，搜索“可观测性”并安装。也可以直接使用无需登录的公开安装包：

```text
https://benjamin-qhy.github.io/qiushuiai-addons/packages/qiushuiai-addon-observability-0.1.18.tgz
```

安装或更新后，请按 QiushuiAI 的提示重新加载相关运行时入口。

## 提供的能力

- 入口：`index.ts`
- 入口：`web/index.ts`
- 技能：`usage-telemetry-chart`

## 配置与安全

请优先通过插件设置面板完成配置。普通配置由插件配置接口保存；令牌、密码等敏感信息应存入 QiushuiAI 密钥链。不要把真实凭据写进工作区文件、日志或版本库。

## 技术资料

完整的原始技术说明、配置示例和故障排查资料保存在 [英文技术资料](https://github.com/benjamin-qhy/qiushuiai-addons/blob/main/addons/observability/README.en.md)。代码中的工具名、参数名、接口路径和第三方品牌保留原始技术名称。
