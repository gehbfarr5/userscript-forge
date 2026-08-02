# 能力探针

能力探针分别记录 Agent、浏览器、脚本管理器、模拟器、真机和发布平台的实测状态。

允许的状态：`PASS`、`CONDITIONAL_PASS`、`FAIL`、`BLOCKED`、`NOT_RUN`。

文档中声称支持不等于本机实测支持。原始探针日志放在工作区私密区，公开仓库只保存脱敏摘要。

## 当前实测摘要

- 基础设施 canary：本机直接浏览器测试 `PASS`。
- Tampermonkey 5.5 真实管理器探针：`BLOCKED`。测试只使用本地 canary；`.user.js` 导航被识别为下载/安装路径，但当前自动化浏览器没有暴露可完成安装的控制面，因此没有宣称管理器注入成功。
- Chrome 138+ 的 Tampermonkey 还可能需要启用“Allow User Scripts”或开发者模式；这项设置必须在受控浏览器中实测后才能写入能力矩阵，参考 [Tampermonkey Q209](https://www.tampermonkey.net/faq.php?locale=en&q=Q209)。

管理器探针的 `BLOCKED` 不会阻塞直接脚本静态检查，但会阻止发布候选进入“真实管理器已验证”状态。
