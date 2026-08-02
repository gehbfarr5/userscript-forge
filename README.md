# Userscript Forge

Userscript Forge 是面向 Codex、Claude 等 Agent 的用户脚本开发、测试和发布控制面。

当前状态：Stage B2 桌面门禁已完成，GitHub canary v0.1.2 发布资产已核对。中央仓库、基础设施检查脚本、本机直接浏览器验证和 Tampermonkey 真实注入已连接公开 GitHub；Greasy Fork 账号已登录但首次发布因账号安全登录方式未配置而 BLOCKED，模拟器和真机尚未接入。

## 统一入口

先按 `.node-version` 使用 Node 24.18.0；`doctor` 在 Node 26 等不受支持的版本上会明确失败，不能用更高版本绕过运行时门禁。

```text
pnpm run doctor
pnpm run validate
pnpm run forge -- status --json
pnpm run forge -- validate-project ../projects/userscript-environment-check
pnpm run forge -- validate-evidence ../private/evidence/<project>/<run>/result.json
pnpm run forge -- new my-script --name "My Script" --description "..." --repository https://github.com/<owner>/my-script --match "https://example.com/*" --dry-run --json
pnpm run forge -- new my-bundle --mode bundle --name "My Bundle" --description "..." --repository https://github.com/<owner>/my-bundle --match "https://example.com/*"
pnpm run forge -- build ../projects/my-bundle --json
pnpm run forge -- candidate ../projects/my-script --json
pnpm run forge -- release-check ../projects/my-script --candidate ../private/evidence/<project>/candidate/<run>.json --require manager,github,greasyfork --manager ../private/evidence/<project>/<manager-run>.json --github ../private/evidence/<project>/<github-run>.json --greasyfork ../private/evidence/<project>/<greasyfork-run>.json --json
```

中央 CLI、Schema 和策略是流程的权威来源。Agent 专属文件只负责告诉 Agent 如何调用中央命令，不重复定义质量门禁。

`validate-evidence` 只接受工作区私密区中的结构化结果；`PASS` 结果必须让所有检查项都是 `PASS`。管理器或设备探针遇到环境限制时必须保留 `BLOCKED`，不能用直接脚本测试冒充真实注入。

`new` 是独立项目的统一生成入口。`direct` 生成可读单文件脚本；`bundle` 生成 TypeScript 源码、固定 `esbuild@0.28.1` 构建适配器和可追踪的 `dist/*.user.js` 输出。bundle 候选必须先运行 `build`，再通过项目校验和静态候选锁定。

`candidate` 只锁定“干净 Git 提交 + 静态门禁 + 候选 SHA-256”，并把结果写入私密 evidence；它明确不会把管理器、设备或发布状态提升为已验证。

`release-check` 是发布前的 fail-closed 总门禁。它不会发布或修改外部平台，只接受私密 evidence，并要求每个 `--require` 平台记录都是 `PASS`，且项目、源码提交和候选 SHA-256 完全一致。缺少、过期或 `BLOCKED` 的证据都会阻止后续发布。

`status` 读取脱敏能力登记及其 evidenceRunId，不再固定读取某一次历史 canary；因此历史重试不会覆盖当前验证结果。移动探针的 `probes/mobile/serve.py` 和 `open-firefox-url.sh` 只负责准备候选文件、导航到 Firefox 和做目标类型保护，实际安装/更新按钮及注入结果仍由仓外 Appium/Computer Use 编排器断言。

## 公私边界

这个仓库可以公开；登录页面、完整 HTML、Cookie 邻近材料、HAR、截图、录屏、设备标识和本机路径不得进入仓库。发布工具将使用公开文件白名单，并在后续阶段加入密钥与隐私扫描。
