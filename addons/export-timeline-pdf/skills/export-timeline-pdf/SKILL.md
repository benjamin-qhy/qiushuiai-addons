---
name: export-timeline-pdf
description: 将当前 QiushuiAI 对话的真实消息导出为 PDF，支持时间范围、消息条数和深浅主题。
distribution: public
---

# 导出对话 PDF

从当前 QiushuiAI 实例读取真实聊天记录，生成 PDF 和供核对的 HTML。不要自行编写或模拟聊天内容。

1. 从当前会话上下文取得准确的 chat JID。不要使用 `web:default` 代替当前会话；无法确定时先查询会话信息。
2. 找到本技能目录向上两级的 `scripts/export-timeline-pdf.ts`，使用该脚本的绝对路径。工作目录保持在当前项目，让输出落到项目的 `exports/`。
3. 运行脚本并传入 `--chat` 的真实值；需要截取范围时使用 `--last`、`--from`、`--to`、`--from-row`、`--to-row`。可传 `--theme light` 或 `--theme dark`，以及 `--out` 指定项目内输出文件。
4. 端口默认读取 `QIUSHUIAI_WEB_PORT`；未配置时通过 `--port` 指定实际运行实例，禁止扫描其他端口猜测。
5. 检查生成的 PDF 文件和正文，确认包含实际消息。最后通过宿主的文件附件工具交付 PDF。仅生成 HTML 不算完成 PDF 导出。

## 运行条件

- 本机正在运行 QiushuiAI。
- 内部导出密钥由宿主环境提供：`QIUSHUIAI_EXPORT_AUTH_KEY`、`QIUSHUIAI_INTERNAL_SECRET` 或 `QIUSHUIAI_WEB_INTERNAL_SECRET`。不要在对话或日志中显示密钥；缺少时明确报告尚未配置。
- 已安装 Chrome/Chromium 或 `wkhtmltopdf`。Chrome 可通过 `QIUSHUIAI_CHROME_PATH` 指定。脚本使用独立临时浏览器配置，不读取用户浏览器资料。
- `--html-only` 仅用于诊断，不表示 PDF 已生成。

脚本调用只读的本机 `/internal/export/timeline` 接口，不直接读取宿主存储，不修改会话或登录状态。认证信息只发送给内部接口，不传递给 PDF 渲染器。
