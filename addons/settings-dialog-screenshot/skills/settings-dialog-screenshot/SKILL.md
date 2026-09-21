---
name: settings-dialog-screenshot
description: 截取 QiushuiAI 本机真实插件设置弹窗，输出紧凑 PNG，用于文档、问题反馈和设置验收。
distribution: public
---

# 设置弹窗截图

必须截取正在运行的 QiushuiAI 页面，不能重绘界面或使用模拟数据。

1. 确认用户要截图的本机 QiushuiAI Web 地址及插件标识。不要猜测端口。
2. 定位本技能向上两级的 `scripts/capture-settings.ts`，使用脚本绝对路径执行。传入 `--url` 的真实地址、`--addon` 的已安装插件标识、`--out` 的项目内 PNG 路径。
3. 脚本使用本机已安装的 Chrome/Chromium、独立临时浏览器会话，打开真实插件设置并只截取可见弹窗，隐藏密码框。不使用用户浏览器资料，不修改插件设置。
4. 检查实际 PNG，然后通过宿主附件工具交付。截图必须有设置标题和可读字段；未打开弹窗、登录受阻或脚本失败都应如实报告。

支持 `sample-addon`、`observability`、`vent` 等具有设置表单的已安装插件。默认目标是 `sample-addon`。

如果当前应用自带的 `browser` 工具可用，也可按相同步骤观察页面、打开设置并截取 dialog 元素。PC Web 环境没有桌面浏览器桥时使用本插件脚本，不把缺少桥接当成截图成功。

系统需要 Chrome 或 Chromium；特殊安装路径通过 `QIUSHUIAI_CHROME_PATH` 提供。页面要求登录且独立浏览器会话无法进入时，停止并说明实际登录限制，禁止绕过鉴权。
