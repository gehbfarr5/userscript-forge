# 生命周期契约（Stage A）

每个脚本项目都必须经过同一条主路径：

```text
intake → normalize → implement → check → test → candidate
→ browser-verify → device-verify → publish → publication-verify
→ awaiting-user-acceptance
```

当前 Stage A 只实现结构检查。浏览器、设备、GitHub 和 Greasy Fork 适配器在后续阶段接入。

## 状态原则

- `PASS` 必须由中央命令和结构化结果产生。
- 必需目标不可用时为 `BLOCKED`，不能降级成 `PASS`。
- 候选版本锁定后禁止重建；测试、安装和发布绑定同一候选哈希。
- 公开版本不通过删除或降级回滚，修复必须递增版本。

