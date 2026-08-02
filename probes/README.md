# 能力探针

能力探针分别记录 Agent、浏览器、脚本管理器、模拟器、真机和发布平台的实测状态。

允许的状态：`PASS`、`CONDITIONAL_PASS`、`FAIL`、`BLOCKED`、`NOT_RUN`。

文档中声称支持不等于本机实测支持。原始探针日志放在工作区私密区，公开仓库只保存脱敏摘要。

## 当前实测摘要

- 基础设施 canary：本机直接浏览器测试 `PASS`。
- Tampermonkey 5.5 真实管理器探针：`PASS`。当前 Chrome 已确认启用“允许运行用户脚本”；本地 canary 能打开安装控制并在受控页面注入，GM 存储检查通过。
- 通用移动后端：Android Emulator Appium、OnePlus Appium/AndroMeld 交叉路径和 iOS Simulator Appium 已有 `PASS`；这些结果不等于 Firefox/Tampermonkey/Stay 注入通过。
- iPhone 真机 Appium 后端：`PASS`，通用 XCUITest 会话、UI 读取/输入、截图和清理已由仓外编排器完成；这不代表 Safari + Stay 用户脚本行为。
- iPhone Safari + Stay：继续保持 `NOT_RUN`，不因通用 Appium 后端通过而改变延后决定。
- GitHub canary v0.1.3 发布：`PASS`。v0.1.1、v0.1.2 和 v0.1.3 的 Release 目标提交、公开资产和 SHA-256 均与本地候选一致。
- Greasy Fork 浏览器编排发布：`PASS`。canary v0.1.2 已完成首次公开导入，v0.1.3 已完成版本递增，并核对公开脚本页与公开代码页；Webhook/API 自动写入仍未验证。
- Chrome 138+ 的 Tampermonkey 可能需要启用“Allow User Scripts”或开发者模式；本机设置已完成实测，参考 [Tampermonkey Q209](https://www.tampermonkey.net/faq.php?locale=en&q=Q209)。

管理器探针的 `PASS` 只覆盖当前 Mac Chrome + Tampermonkey 组合；它不会替代 Android、OnePlus 15、iPhone 或 Greasy Fork 门禁。
