# 移动端能力探针交接

移动端探针不在公开仓库里启动设备。中央仓库只定义输入、输出和门禁；实际 Android/iOS 会话由本机移动自动化编排器在仓外执行，然后把脱敏的 `result.json` 放入私密 evidence。

Android 的顺序固定为：

1. 模拟器 Firefox/脚本管理器 canary。
2. 同一候选文件的页面行为验证。
3. 只有模拟器通过后，才允许进入 OnePlus 15 的最终集成门。

每次结果必须绑定 `sourceCommit` 和脚本 SHA-256，并通过中央命令校验：

```text
pnpm run forge -- validate-evidence ../private/evidence/<project>/<run>/result.json --json
```

沙箱会话不直接启动模拟器、ADB 或 live Appium；这类 I/O 由仓外编排器完成。iPhone Safari + Stay 暂保持 `NOT_RUN`，不因配置文件存在而视为支持。

## Android 模拟器 Firefox canary

下一门禁使用公开的 `userscript-environment-check` 项目，不使用真实论坛页面或真实账号：

1. 编排器先按 `~/Desktop/mobile-automation-infra` 的 doctor/runbook 检查 `PLK110_API_36`，只选择 Android emulator + Appium。
2. 在 Firefox 内打开 `http://127.0.0.1:<port>/userscripts/userscript-environment-check.user.js`，完成管理器安装；若当前移动端管理器无法通过本地 URL 安装，结果必须是 `BLOCKED`，不能改用直接 `<script>` 测试冒充注入。
3. 打开 `http://127.0.0.1:<port>/test-pages/smoke.html`，结构化断言必须观察到 `Injection: PASS`、管理器名称和 `GM storage: AVAILABLE`。
4. 结果写入工作区外的 `private/evidence/userscript-environment-check/android-emulator-manager/result.json`，使用中央 `schemas/result.schema.json` 和 `validate-evidence` 校验；结果必须绑定 canary 提交和 SHA-256。

建议检查 ID：`firefox-launched`、`manager-install-surface`、`script-installed`、`manager-injection`、`gm-storage`。不要写入设备 serial、局域网地址、Firefox profile 或登录态到公开仓库。
