# 生命周期契约（Stage B2）

每个脚本项目都必须经过同一条主路径：

```text
intake → normalize → implement → check → test → candidate
→ browser-verify → device-verify → publish → publication-verify
→ awaiting-user-acceptance
```

当前执行进度以 `docs/current-status.md` 为准；本文件只定义不随单次运行变化的生命周期和门禁规则。

## 状态原则

- `PASS` 必须由中央命令和结构化结果产生。
- 必需目标不可用时为 `BLOCKED`，不能降级成 `PASS`。
- 候选版本锁定后禁止重建；测试、安装和发布绑定同一候选哈希。
- `candidate` 的 PASS 只表示静态候选已绑定干净提交与 SHA-256，不等于真实管理器、设备或双平台发布通过。
- `release-check` 必须先以 `pre-publication` 阶段在外部发布前运行；它要求所有声明为必需的管理器和设备 evidence 都是 `PASS`，并且绑定同一源码提交和候选 SHA-256。GitHub 与 Greasy Fork 不能成为这个阶段的前置证据，否则会造成首发循环。
- `release-check` 还必须按 evidence kind 锁定 probe 类型：管理器只能接受明确的 `stage-b-manager` 版本 probe；模拟器和一加 15 必须分别使用 `--emulator` 与 `--oneplus`，不能用泛化的 `--device` 互相替代；GitHub 只能接受 `github-publish` 或已核对的 `github-publish-adapter`，Greasy Fork 只能接受 `greasyfork-first-import` 或 `greasyfork-version-sync`；`mobile-handoff`、通用 Appium backend 或 direct probe 不能替代这些门禁。
- 项目 `targets.requiredVerification` 中映射到管理器、Android 模拟器和一加 15 的声明，会自动成为发布前 `release-check` 的必需 kind；调用者不能通过省略该 kind 让门禁变宽。显式公开平台声明只在发布事务汇总阶段生效。
- GitHub 与 Greasy Fork 发布适配器都必须消费同一候选的发布前 PASS。两个站点写入并即时核对后，再运行 `publication-transaction-audit`；只要调用者提供任一公开端 evidence，项目配置中的 GitHub 仓库和 `greasyForkRequired` 就会强制要求对应公开平台 evidence 齐全。这是当次发布的收口，不是后续巡检。
- `status` 只能把能力登记中的当前 evidenceRunId 当作当前状态；旧的 `BLOCKED` 或旧版本 `PASS` 必须保留为历史，不能覆盖新结果。
- 外部探针写出新 evidence 后，必须先通过中央 `record-capability` 的 Schema、probe、目标契约和隐私字段校验，再更新能力登记；登记后的公开变更仍需 Git 提交和推送，私密 evidence 永不进入公开仓库。
- 移动 UI 运行态由仓外编排器执行；中央仓库的移动辅助工具只准备候选服务、校验显式设备目标和打开 URL，不能凭导航成功或人工描述产生 `PASS`。
- Android 用户脚本管理器证据按 target 分开：模拟器使用 `android-emulator-manager` / `android-emulator-firefox-manager`，一加 15 使用 `oneplus-15-firefox-manager`；两者都必须绑定同一候选 `sourceCommit` 与 `artifact.sha256`，不能用通用 Appium backend 证据替代。
- Android 采用双门禁：instrumented Fenix 只在模拟器中证明真实 Tampermonkey、DOM 和存储技术链路；OnePlus 15 必须使用原版 Firefox 做最终生产体验验收。任何 OnePlus `PASS` 还必须包含 `user-final-acceptance` PASS，以及 `environment.acceptance.mode=user-final-acceptance`、显式确认和时间戳。`finalize-oneplus-acceptance` 只有在模拟器 PASS、同候选设备观察前三项 PASS 且用户明确确认后才能生成该结果。
- 公开版本不通过删除或降级回滚，修复必须递增版本。
- `BLOCKED` 表示探针确实运行到能力边界但环境不允许完成；它不能被压低为 `PASS`，也不能被静默跳过。`validate-evidence` 与 `record-capability` 必须允许它作为当前阻塞登记，而 `release-check` 仍只接受完整的 `PASS`。
- `publish-github` 是唯一的 GitHub Release 写入适配器；Greasy Fork 写入必须经过浏览器编排器和独立公开端核对，不能复用 GitHub 的 PASS。
