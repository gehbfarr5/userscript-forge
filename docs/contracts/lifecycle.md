# 生命周期契约（Stage B2）

每个脚本项目都必须经过同一条主路径：

```text
intake → normalize → implement → check → test → candidate
→ browser-verify → device-verify → publish → publication-verify
→ awaiting-user-acceptance
```

当前已完成结构检查、静态检查、直接浏览器页面测试、Mac Chrome + Tampermonkey 5.5.0 的 v0.1.3 canary 注入、GitHub v0.1.3 资产核对，以及通过已登录浏览器完成 Greasy Fork v0.1.2 首次导入和 v0.1.3 第二版本公开同步；Android、OnePlus 15、iPhone 用户脚本门禁和真实样板仍需逐项实测后才能标记为支持。

## 状态原则

- `PASS` 必须由中央命令和结构化结果产生。
- 必需目标不可用时为 `BLOCKED`，不能降级成 `PASS`。
- 候选版本锁定后禁止重建；测试、安装和发布绑定同一候选哈希。
- `candidate` 的 PASS 只表示静态候选已绑定干净提交与 SHA-256，不等于真实管理器、设备或双平台发布通过。
- `release-check` 必须在外部发布前运行；它要求所有声明为必需的管理器、设备和发布平台 evidence 都是 `PASS`，并且绑定同一源码提交和候选 SHA-256。
- `release-check` 还必须按 evidence kind 锁定 probe 类型：管理器只能接受明确的 `stage-b-manager` 版本 probe，设备只能接受 Android Firefox 用户脚本管理器的两个明确 target probe，GitHub 只能接受 `github-publish` 或已核对的 `github-publish-adapter`，Greasy Fork 只能接受 `greasyfork-first-import` 或 `greasyfork-version-sync`；`mobile-handoff`、通用 Appium backend 或 direct probe 不能替代这些门禁。
- `status` 只能把能力登记中的当前 evidenceRunId 当作当前状态；旧的 `BLOCKED` 或旧版本 `PASS` 必须保留为历史，不能覆盖新结果。
- 移动 UI 运行态由仓外编排器执行；中央仓库的移动辅助工具只准备候选服务、校验显式设备目标和打开 URL，不能凭导航成功或人工描述产生 `PASS`。
- Android 用户脚本管理器证据按 target 分开：模拟器使用 `android-emulator-manager` / `android-emulator-firefox-manager`，一加 15 使用 `oneplus-15-firefox-manager`；两者都必须绑定同一候选 `sourceCommit` 与 `artifact.sha256`，不能用通用 Appium backend 证据替代。
- 公开版本不通过删除或降级回滚，修复必须递增版本。
- `BLOCKED` 表示探针确实运行到能力边界但环境不允许完成；它不能被压低为 `PASS`，也不能被静默跳过。
- `publish-github` 是唯一的 GitHub Release 写入适配器；Greasy Fork 写入必须经过浏览器编排器和独立公开端核对，不能复用 GitHub 的 PASS。
