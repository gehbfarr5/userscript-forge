# 移动端能力探针交接

移动端探针不在公开仓库里启动设备。中央仓库只定义输入、输出和门禁；实际 Android/iOS 会话由本机移动自动化编排器在仓外执行，然后把脱敏的 `result.json` 放入私密 evidence。

Android 的顺序固定为：

1. 模拟器 Firefox/脚本管理器 canary。
2. 同一候选文件的页面行为验证。
3. 只有模拟器通过后，才允许进入 OnePlus 15 的最终集成门。

本目录提供两个无状态辅助工具：`serve.py` 只提供候选文件和脱敏测试页，`open-firefox-url.sh` 只在显式指定并通过目标类型校验后打开浏览器 URL。它们不读取或写入 Firefox profile、Cookie、扩展数据库或设备配置。

每次结果必须绑定 `sourceCommit` 和脚本 SHA-256，并通过中央命令校验：

```text
pnpm run forge -- validate-evidence ../private/evidence/<project>/<run>/result.json --json
```

沙箱会话不直接启动模拟器、ADB 或 live Appium；这类 I/O 由仓外编排器完成。iPhone Safari + Stay 暂保持 `NOT_RUN`，不因配置文件存在而视为支持。

## Android 模拟器 Firefox canary

下一门禁使用公开的 `userscript-environment-check` 项目，不使用真实论坛页面或真实账号：

1. 编排器先按 `~/Desktop/mobile-automation-infra` 的 doctor/runbook 检查 `PLK110_API_36`，只选择 Android emulator + Appium。
2. 让宿主机的静态服务监听可被模拟器访问的地址，然后在 Firefox 内打开 `http://10.0.2.2:<port>/userscripts/userscript-environment-check.user.js`，完成管理器安装；Android Emulator 的 `10.0.2.2` 是宿主机回环地址映射，不能在模拟器内使用 `127.0.0.1` 代替。若当前移动端管理器无法通过这个本地 URL 安装，结果必须是 `BLOCKED`，不能改用直接 `<script>` 测试冒充注入。
3. 打开 `http://10.0.2.2:<port>/test-pages/smoke.html`，结构化断言必须观察到 `Injection: PASS`、管理器名称和 `GM storage: AVAILABLE`。
4. 结果写入工作区外的 `private/evidence/userscript-environment-check/android-emulator-manager/result.json`，使用中央 `schemas/result.schema.json` 和 `validate-evidence` 校验；结果必须绑定 canary 提交和 SHA-256。

建议检查 ID：`firefox-launched`、`manager-install-surface`、`script-installed`、`manager-injection`、`gm-storage`。不要写入设备 serial、局域网地址、Firefox profile 或登录态到公开仓库。

示例（由仓外编排器执行，不在 Codex 沙箱中执行设备 I/O）：

```text
python3 forge/probes/mobile/serve.py --directory projects/userscript-environment-check --host 0.0.0.0 --port 8765
forge/probes/mobile/open-firefox-url.sh --serial emulator-5554 --target emulator --url http://10.0.2.2:8765/userscripts/userscript-environment-check.user.js?v=<version>
forge/probes/mobile/open-firefox-url.sh --serial <explicit-real-serial> --expected-serial <same-serial> --target real --url http://<host-ip>:8765/test-pages/smoke.html
```

`open-firefox-url.sh` 只负责导航，安装/更新按钮和注入结果必须由 Appium/Computer Use 的 UI 证据断言；导航成功不能单独产生 `PASS`。
