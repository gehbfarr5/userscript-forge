# Userscript Forge

Userscript Forge 是面向 Codex、Claude 等 Agent 的用户脚本开发、测试和发布控制面。

当前状态摘要见 `docs/current-status.md`。Stage B2 桌面门禁、GitHub canary v0.1.3 和 Greasy Fork canary v0.1.3 已完成；当前 Android 样板的 instrumented Fenix 模拟器门禁与 OnePlus 15 原版 Firefox 最终验收仍未完成，发布总门禁保持 fail-closed。

## 统一入口

先按 `.node-version` 使用 Node 24.18.0；`doctor` 在 Node 26 等不受支持的版本上会明确失败，不能用更高版本绕过运行时门禁。

```text
pnpm run doctor
pnpm run validate
pnpm run forge -- status --json
pnpm run forge -- validate-work-order ../private/work-orders/<project-id>/work-order.json --json
pnpm run forge -- validate-project ../projects/userscript-environment-check
pnpm run forge -- validate-evidence ../private/evidence/<project>/<run>/result.json
pnpm run forge -- record-capability <capability-id> ../private/evidence/<project>/<run>/result.json --dry-run --json
pnpm run forge -- new my-script --name "My Script" --description "..." --repository https://github.com/<owner>/my-script --match "https://example.com/*" --verify oneplus-15-firefox-manager --dry-run --json
pnpm run forge -- new my-bundle --mode bundle --name "My Bundle" --description "..." --repository https://github.com/<owner>/my-bundle --match "https://example.com/*"
pnpm run forge -- build ../projects/my-bundle --json
pnpm run forge -- candidate ../projects/my-script --json
pnpm run forge -- mobile-handoff ../projects/userscript-environment-check --candidate ../private/evidence/<project>/candidate/<run>.json --target emulator --port 8765 --json
pnpm run forge -- mobile-handoff ../projects/userscript-environment-check --candidate ../private/evidence/<project>/candidate/<run>.json --target oneplus --base-url http://<phone-reachable-host>:8765 --port 8765 --json
pnpm run forge -- release-check ../projects/my-script --candidate ../private/evidence/<project>/candidate/<run>.json --require manager,emulator,oneplus --manager ../private/evidence/<project>/<manager-run>.json --emulator ../private/evidence/<project>/<emulator-run>.json --oneplus ../private/evidence/<project>/<oneplus-run>.json --json
pnpm run forge -- publish-github ../projects/my-script --release-evidence ../private/evidence/<project>/release-check/<pre-publication-run>.json --dry-run --json
pnpm run forge -- greasyfork-handoff ../projects/userscript-environment-check --candidate ../private/evidence/<project>/candidate/<run>.json --release-evidence ../private/evidence/<project>/release-check/<pre-publication-run>.json --script-id new --json
pnpm run forge -- greasyfork-handoff ../projects/userscript-environment-check --candidate ../private/evidence/<project>/candidate/<run>.json --release-evidence ../private/evidence/<project>/release-check/<pre-publication-run>.json --script-id <ID> --json
pnpm run forge -- release-check ../projects/my-script --candidate ../private/evidence/<project>/candidate/<run>.json --require manager,emulator,oneplus,github,greasyfork --manager ../private/evidence/<project>/<manager-run>.json --emulator ../private/evidence/<project>/<emulator-run>.json --oneplus ../private/evidence/<project>/<oneplus-run>.json --github ../private/evidence/<project>/<github-run>.json --greasyfork ../private/evidence/<project>/<greasyfork-run>.json --json
```

中央 CLI、Schema 和策略是流程的权威来源。Agent 专属文件只负责告诉 Agent 如何调用中央命令，不重复定义质量门禁。

`validate-evidence` 只接受工作区私密区中的结构化结果；`PASS` 结果必须让所有检查项都是 `PASS`。管理器或设备探针遇到环境限制时必须保留 `BLOCKED`，并允许通过 `record-capability` 登记为当前阻塞；不能用直接脚本测试冒充真实注入。发布前的 `release-check` 仍只接受完整的 `PASS`。

`new` 是独立项目的统一生成入口。`direct` 生成可读单文件脚本；`bundle` 生成 TypeScript 源码、固定 `esbuild@0.28.1` 构建适配器和可追踪的 `dist/*.user.js` 输出。用可重复的 `--verify <capability-id>` 声明该脚本真正必须支持的平台；例如同时需要 Android 模拟器和一加 15 时分别声明 `android-emulator-firefox-manager` 与 `oneplus-15-firefox-manager`。bundle 候选必须先运行 `build`，再通过项目校验和静态候选锁定。

每个新需求先形成私密 `work-order.json`，再调用 `new` 创建独立项目。`validate-work-order` 只读取 `private/work-orders/` 下的工作单，检查需求摘要、目标平台、范围、风险、验收场景和 GitHub/Greasy Fork 发布意图；工作单中的 `platforms.requiredVerification` 必须逐项传给 `new --verify`。工作单不进入公开仓库，也不保存网页样本、账号、Cookie、设备序列号或登录态。

中央仓库和 `new` 生成的每个独立项目都带最小 GitHub Actions CI：Node 24、项目测试、脚本语法检查；真实创建项目时生成精确的 `pnpm-lock.yaml`，bundle 项目还会用 frozen install 构建并检查可读的 `dist/*.user.js`。CI 是辅助信号，不能替代真实脚本管理器、设备或公开平台 evidence。

`candidate` 只锁定“干净 Git 提交 + 静态门禁 + 候选 SHA-256”，并把结果写入私密 evidence；它明确不会把管理器、设备或发布状态提升为已验证。

`mobile-handoff` 是只读的移动用户脚本交接命令：它校验当前候选、版本和 SHA-256，按显式 `--target emulator|oneplus` 输出 Firefox 的安装页、冒烟页、必需检查 ID 和证据目录。模拟器使用 `10.0.2.2`，一加 15 必须显式提供手机可访问的 `--base-url`；命令不会启动 ADB、模拟器、Appium、Firefox 或脚本管理器，运行态必须由仓外编排器执行。

`finalize-oneplus-acceptance` 是双门禁的最终收口命令。它要求同一候选的模拟器技术 PASS、OnePlus 原版 Firefox 设备观察，以及用户已经完成项目声明的 `acceptanceChecks`；然后生成含 `user-final-acceptance` 的新 OnePlus PASS。没有显式 `--confirmed`、候选不一致、设备观察前三项未通过或缺少模拟器 PASS 时一律拒绝。

真实脚本可以在 `userscript.project.json` 的 `targets.mobileVerification` 中声明自己的安装路径、公开 smoke URL、可观察文本标记和必需检查 ID。中央 handoff 会从当前项目 artifact 派生安装地址、证据目录和 smoke 交接，不再要求复制 canary 的项目路径；未声明该配置的旧 canary 项目继续使用中央默认 fixture。

`greasyfork-handoff` 是只读的 Greasy Fork 浏览器发布交接命令：它要求同候选的发布前 `release-check PASS`，再校验当前候选、版本和 SHA-256，输出首次创建页、版本更新页、公开脚本页、公开代码页和必需检查 ID。首次导入时可省略 `--script-id`，也可显式使用 `--script-id new`；这两种 create-only 形式只输出创建页，拿到 Greasy Fork 返回的数字脚本 ID 后再用 `--script-id <ID>` 生成更新和公开页面地址。它不会登录、上传或提交表单；浏览器编排器完成后必须写回独立公开端证据。

Greasy Fork 要求面向成人内容站点的脚本明确标记。新项目默认 `greasyForkAdultContent=false`；只有需求确实涉及成人内容时使用 `new --greasy-fork-adult`。发布交接会把该声明传给浏览器编排器，并把正确勾选成人内容列为必需证据，不能靠站点名称猜测或静默省略。

`release-check` 有两个无循环阶段。发布前阶段只要求声明的桌面管理器、模拟器和一加 15 evidence；它的 PASS 才能交给 GitHub/Greasy Fork 发布适配器。两个站点完成并立即核对后，再以同一命令加入 `github,greasyfork` evidence 做本次发布事务汇总；只要进入该汇总阶段，项目配置的 GitHub 与 `greasyForkRequired` 就会强制要求两个公开端证据齐全。两阶段都绑定同一项目、提交和候选 SHA-256。管理器、模拟器、一加 15 和两个发布 probe 不能互相替代；缺少、过期、类型错误或 `BLOCKED` 都会失败。这是当次发布核对，不是发布后的定时巡检。

`publish-github` 是 GitHub Release 适配器：它只接受当前项目、提交、候选 SHA-256 全部匹配的 `release-check PASS`，并在发布后重新读取 GitHub Release，核对 tag、目标提交、资产状态和远端 SHA-256。`--dry-run` 不执行写入；已有完全匹配的 Release 可幂等通过。Greasy Fork 仍由已登录浏览器编排器处理，不假设存在写入 API。

`status` 读取脱敏能力登记及其 evidenceRunId，不再固定读取某一次历史 canary；因此历史重试不会覆盖当前验证结果。移动探针的 `probes/mobile/serve.py` 和 `open-firefox-url.sh` 只负责准备候选文件、导航到 Firefox 和做目标类型保护，实际安装/更新按钮及注入结果仍由仓外 Appium/Computer Use 编排器断言。

`record-capability` 是 live 外部编排完成后的登记入口：它只接受私密区中通过 Schema、目标 probe 和隐私字段校验的 evidence，把脱敏状态、probe 和 `runId` 写入公开 `registry/capabilities.json`；默认要求中央仓库干净，建议先用 `--dry-run`，写入后由 Agent 提交并推送中央仓库。私密 evidence 不会被复制到公开仓库。

旧的一加 Firefox Skill 只作为迁移参考；迁移边界和退役条件见 `docs/contracts/legacy-oneplus-skill.md`，不会成为新项目的唯一标准。

## 公私边界

这个仓库可以公开；登录页面、完整 HTML、Cookie 邻近材料、HAR、截图、录屏、设备标识和本机路径不得进入仓库。发布工具将使用公开文件白名单，并在后续阶段加入密钥与隐私扫描。
