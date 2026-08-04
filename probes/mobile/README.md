# 移动端能力探针交接

移动端探针不在公开仓库里启动设备。中央仓库只定义输入、输出和门禁；实际 Android/iOS 会话由本机移动自动化编排器在仓外执行，然后把脱敏的 `result.json` 放入私密 evidence。

Android 的顺序固定为：

1. 模拟器 Firefox/脚本管理器 canary。
2. 同一候选文件的页面行为验证。
3. 只有模拟器通过后，才允许进入 OnePlus 15 的最终集成门。

本目录提供两个无状态辅助工具：`serve.py` 只提供候选文件和脱敏测试页，`open-firefox-url.sh` 只在显式指定并通过目标类型校验后打开浏览器 URL。它们不读取或写入 Firefox profile、Cookie、扩展数据库或设备配置。`userscript-canary.manifest.json` 是移动用户脚本探针的机器可读契约，中央 `validate` 会校验它。

每次结果必须绑定 `sourceCommit` 和脚本 SHA-256，并通过中央命令校验：

```text
pnpm run forge -- validate-evidence ../private/evidence/<project>/<run>/result.json --json
```

沙箱会话不直接启动模拟器、ADB 或 live Appium；这类 I/O 由仓外编排器完成。iPhone Safari + Stay 暂保持 `NOT_RUN`，不因配置文件存在而视为支持。

## Android 模拟器 Firefox canary

仓外编排器的参考入口是 `~/Desktop/mobile-automation-infra/scripts/android-emulator-userscript-canary.mjs`。它会执行下面的 handoff，并在非 Codex-headless 环境中负责显式模拟器/Appium 生命周期；先运行 `--dry-run`，再使用当前 candidate evidence 运行真实门禁。

下一门禁使用公开的 `userscript-environment-check` 项目，不使用真实论坛页面或真实账号：

1. 编排器先按 `~/Desktop/mobile-automation-infra` 的 doctor/runbook 检查 `PLK110_API_36`，只选择 Android emulator + Appium。
2. 让宿主机的静态服务监听可被模拟器访问的地址，然后在 Firefox 内打开 `http://10.0.2.2:<port>/userscripts/userscript-environment-check.user.js`，完成管理器安装；Android Emulator 的 `10.0.2.2` 是宿主机回环地址映射，不能在模拟器内使用 `127.0.0.1` 代替。若当前移动端管理器无法通过这个本地 URL 安装，结果必须是 `BLOCKED`，不能改用直接 `<script>` 测试冒充注入。
3. 打开 `http://10.0.2.2:<port>/test-pages/install.html`，通过页面中的安装链接进入管理器安装页并明确点击安装；直接打开 `.user.js` 源码不算安装。
4. 打开 `http://10.0.2.2:<port>/test-pages/smoke.html`，结构化断言必须观察到 `Injection: PASS`、管理器名称和 `GM storage: AVAILABLE`。
4. 结果默认写入工作区外的 `private/evidence/userscript-environment-check/android-emulator-manager/<run-id>/result.json`（也可用 `--evidence-path` 显式指定私密路径），使用中央 `schemas/result.schema.json` 和 `validate-evidence` 校验；结果必须绑定 canary 提交和 SHA-256。每次运行独立留档，不覆盖历史结果。

真实脚本不应复制 canary 的项目路径。可在项目 `userscript.project.json` 的 `targets.mobileVerification` 中声明 `/test-pages/install.html`、公开目标 smoke URL、页面源中可观察的 `requiredText`、该项目实际需要的 `requiredChecks` 和 `automationAssertions`；`forge mobile-handoff` 会将当前项目候选绑定到这些值。`automationAssertions.domMarker` 是必需的安全选择器/属性/值比较，`layout` 与 `toggle` 按项目需要选填。中央环境只执行这个有限断言 DSL，不把某个样板的 DOM ID、宽度或业务逻辑硬编码成全局标准。没有整个 mobile 声明时，handoff 才使用本目录的 canary 默认 fixture。

建议检查 ID：`firefox-launched`、`manager-install-surface`、`script-installed`、`manager-injection`、`gm-storage`。结果必须按 `userscript-canary.manifest.json` 的 `requiredChecks` 完整覆盖；不要写入设备 serial、局域网地址、Firefox profile 或登录态到公开仓库。

模拟器外部结果的 `probe` 必须为 `android-emulator-manager`，`environment.target` 必须为 `android-emulator-firefox-manager`；中央 `validate-evidence` 会拒绝缺少任一必需检查或任一检查不是 `PASS` 的结果。

## OnePlus 15 Firefox canary

模拟器用户脚本门禁通过后，使用同一候选文件执行一加 15 真机门禁。中央 handoff 必须显式声明真实目标和手机可访问的宿主机地址；不能把 `10.0.2.2` 或 `localhost` 用在真机上：

```text
pnpm run forge -- mobile-handoff ../projects/userscript-environment-check \
  --candidate ../private/evidence/userscript-environment-check/candidate/<candidate>.json \
  --target oneplus --base-url http://<phone-reachable-host>:8765 --json
```

仓外执行器仍使用显式 real-device serial，先检查设备身份、原版 Firefox、管理器安装表面和脚本已安装。模拟器上的 instrumented Fenix 负责提供真实 Tampermonkey/DOM 自动化证据；它不能冒充原版 Firefox。OnePlus 15 保留为原版 Firefox 的生产体验门禁，页面级注入由用户做最后一次可见验收。禁止 `--start-emulator`，禁止 emulator serial，禁止 `pm clear`、卸载或修改 Firefox/Tampermonkey 内部存储。

外部设备观察结果的 `probe` 必须为 `oneplus-15-firefox-manager`，`environment.target` 必须为 `oneplus-15-firefox-manager`，并默认写入 `private/evidence/<project>/oneplus-15-firefox-manager/<run-id>/result.json`。在用户确认前它保持 `BLOCKED`，但 `firefox-launched`、`manager-install-surface` 和 `script-installed` 必须有真实 PASS。用户完成项目声明的 `acceptanceChecks` 后，中央命令读取候选、模拟器 PASS 和该设备观察，生成新的最终 PASS：

```text
pnpm run forge -- finalize-oneplus-acceptance ../projects/<project> \
  --candidate ../private/evidence/<project>/candidate/<candidate>.json \
  --emulator ../private/evidence/<project>/android-emulator-manager/<run>/result.json \
  --device-observation ../private/evidence/<project>/oneplus-15-firefox-manager/<observation>/result.json \
  --confirmed --json
```

`--confirmed` 只能在用户明确完成最后验收后使用。生成结果必须含 `user-final-acceptance` PASS、原版 Firefox 标记、确认时间和双门禁 runId，并继续绑定同一候选；设备 serial、Session、Cookie 和账号材料不得写入。

示例（由仓外编排器执行，不在 Codex 沙箱中执行设备 I/O）：

```text
python3 forge/probes/mobile/serve.py --directory projects/userscript-environment-check --host 0.0.0.0 --port 8765
forge/probes/mobile/open-firefox-url.sh --serial emulator-5554 --target emulator --url http://10.0.2.2:8765/userscripts/userscript-environment-check.user.js?v=<version>
forge/probes/mobile/open-firefox-url.sh --serial <explicit-real-serial> --expected-serial <same-serial> --target real --url http://<host-ip>:8765/test-pages/smoke.html
```

`open-firefox-url.sh` 只负责导航，安装/更新按钮和注入结果必须由 Appium/Computer Use 的 UI 证据断言；导航成功不能单独产生 `PASS`。

live 运行写出 `PASS` 后，外部 Agent 应把结果交回中央能力矩阵，而不是手改状态：

```text
pnpm run forge -- record-capability android-emulator-firefox-manager \
  ../private/evidence/userscript-environment-check/android-emulator-manager/<run-id>/result.json --dry-run --json
pnpm run forge -- record-capability android-emulator-firefox-manager \
  ../private/evidence/userscript-environment-check/android-emulator-manager/<run-id>/result.json --json
```

一加 15 使用 `oneplus-15-firefox-manager` 作为 capability id；登记命令会拒绝错误 probe、缺失移动检查或包含设备/Session 字段的 evidence。登记只更新脱敏 `registry/capabilities.json`，随后仍需提交并推送中央仓库。
