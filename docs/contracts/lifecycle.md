# 生命周期契约（Stage B2）

每个脚本项目都必须经过同一条主路径：

```text
intake → normalize → implement → check → test → candidate
→ browser-verify → device-verify → publish → publication-verify
→ awaiting-user-acceptance
```

当前已完成结构检查、静态检查和直接浏览器页面测试；真实脚本管理器探针已运行但为 `BLOCKED`。设备、GitHub 写入和 Greasy Fork 适配器仍需逐项实测后才能标记为支持。

## 状态原则

- `PASS` 必须由中央命令和结构化结果产生。
- 必需目标不可用时为 `BLOCKED`，不能降级成 `PASS`。
- 候选版本锁定后禁止重建；测试、安装和发布绑定同一候选哈希。
- 公开版本不通过删除或降级回滚，修复必须递增版本。
- `BLOCKED` 表示探针确实运行到能力边界但环境不允许完成；它不能被压低为 `PASS`，也不能被静默跳过。
