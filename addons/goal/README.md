# 目标管理

提供持久化线程目标、加固的自主续行循环和清晰的完成或停止摘要

## 功能定位

这是 QiushuiAI 的扩展插件，技术标识为 `goal`。

- 软件包：`@qiushuiai/qiushuiai-addon-goal`
- 当前版本：`0.1.49`
- 兼容版本：QiushuiAI `>=3.0.0`
- 展示标签：`自动化`、`目标驱动`、`自动续行`、`效率`、`会话`、`核心推荐`
- 推荐级别：核心推荐

## 安装

在 QiushuiAI 中打开**设置 → 插件**，搜索“目标管理”并安装。也可以直接使用无需登录的公开安装包：

```text
https://benjamin-qhy.github.io/qiushuiai-addons/packages/qiushuiai-addon-goal-0.1.49.tgz
```

安装或更新后，请按 QiushuiAI 的提示重新加载相关运行时入口。

## 提供的能力

- 入口：`index.ts`
- 入口：`runtime.ts`
- 入口：`web/index.ts`

目标生命周期通过 `get_goal`、`create_goal` 和 `update_goal` 等工具管理。状态包括正常进行、`blocked`（等待外部条件）和 `budget_limited`（达到预算上限）等明确结果。

## 配置与安全

请优先通过插件设置面板完成配置。普通配置由插件配置接口保存；令牌、密码等敏感信息应存入 QiushuiAI 密钥链。不要把真实凭据写进工作区文件、日志或版本库。

## 技术资料

完整的原始技术说明、配置示例和故障排查资料保存在 [英文技术资料](https://github.com/benjamin-qhy/qiushuiai-addons/blob/main/addons/goal/README.en.md)。代码中的工具名、参数名、接口路径和第三方品牌保留原始技术名称。
