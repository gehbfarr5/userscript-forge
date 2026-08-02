# 旧 OnePlus Firefox Skill 迁移边界

这份文档只定义迁移边界，不把旧 Skill 变成 Userscript Forge 的第二套规范。当前旧 Skill 仍保留给历史项目参考；中央仓库的 CLI、Schema、能力登记和 `probes/mobile/` 才是新项目的唯一权威路径。

## 可复用的思想

| 旧资产/做法 | 新路径 | 处理 |
|---|---|---|
| 本地 HTTP 服务和 `Cache-Control: no-store` | `probes/mobile/serve.py` | 采用通用实现，不复制旧目录路径 |
| `.user.js` URL 安装/更新 | `probes/mobile/open-firefox-url.sh` + 外部 UI 编排 | 只允许显式目标；导航不等于安装成功 |
| Direct 页面与 TM-only 页面分离 | `probes/mobile/README.md` 的 manager evidence 契约 | 保留并绑定候选 SHA-256 |
| 版本递增和 cache-busting | 中央 `candidate`/`release-check` + 项目版本规则 | 由中央门禁锁定，不靠 Skill 文字提醒 |

## 禁止迁移的内容

- 设备 serial、局域网地址、Firefox profile、扩展 UUID、Cookie、IndexedDB/WAL 或登录态。
- 旧 Skill 中假设“所有脚本全站匹配”或默认支持所有平台的规则。
- 直接修改 Firefox/Tampermonkey 内部存储作为安装主路径。
- 用 `<script src="...user.js">` 页面测试冒充 Tampermonkey 注入 PASS。

## 退役条件

旧 Skill 只有在下面条件全部满足后，才可以改成指向中央 CLI 的薄入口或归档：

1. Android Emulator Firefox/Tampermonkey canary 产生绑定候选的 `PASS` evidence。
2. 同一候选在 OnePlus 15 Firefox/Tampermonkey 产生 `PASS` evidence。
3. GitHub 与 Greasy Fork 完成两个版本的真实发布/核对闭环。
4. 至少一个真实脚本样板完成两轮开发—验证—发布。

在这些条件满足前，不删除旧 Skill，不覆盖其历史证据，也不把它写入新项目的必需依赖。
