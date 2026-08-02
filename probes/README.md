# 能力探针

能力探针分别记录 Agent、浏览器、脚本管理器、模拟器、真机和发布平台的实测状态。

允许的状态：`PASS`、`CONDITIONAL_PASS`、`FAIL`、`BLOCKED`、`NOT_RUN`。

文档中声称支持不等于本机实测支持。原始探针日志放在工作区私密区，公开仓库只保存脱敏摘要。

## 当前实测摘要

- 基础设施 canary：本机直接浏览器测试 `PASS`。
- Tampermonkey 5.5 真实管理器探针：`PASS`。当前 Chrome 已确认启用“允许运行用户脚本”；本地 canary 能打开安装控制并在受控页面注入，GM 存储检查通过。
- GitHub canary v0.1.2 发布：`PASS`。Release 目标提交和公开资产 SHA-256 与本地候选一致。
- Greasy Fork 首次发布：`BLOCKED`。账号已登录，但发布前要求已验证邮箱、2FA 或第三方登录中的任一安全登录方式；探针未修改账号安全设置。
- Chrome 138+ 的 Tampermonkey 可能需要启用“Allow User Scripts”或开发者模式；本机设置已完成实测，参考 [Tampermonkey Q209](https://www.tampermonkey.net/faq.php?locale=en&q=Q209)。

管理器探针的 `PASS` 只覆盖当前 Mac Chrome + Tampermonkey 组合；它不会替代 Android、OnePlus 15、iPhone 或 Greasy Fork 门禁。
