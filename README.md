# Userscript Forge

Userscript Forge 是面向 Codex、Claude 等 Agent 的用户脚本开发、测试和发布控制面。

当前状态：Stage B2 探针已开始。中央仓库、基础设施检查脚本和本机直接浏览器验证已连接公开 GitHub；真实脚本管理器探针目前为 BLOCKED，Greasy Fork、模拟器和真机尚未接入。

## 统一入口

```text
pnpm run doctor
pnpm run validate
pnpm run forge -- status --json
pnpm run forge -- validate-project ../projects/userscript-environment-check
pnpm run forge -- validate-evidence ../private/evidence/<project>/<run>/result.json
pnpm run forge -- new my-script --name "My Script" --description "..." --repository https://github.com/<owner>/my-script --match "https://example.com/*" --dry-run --json
```

中央 CLI、Schema 和策略是流程的权威来源。Agent 专属文件只负责告诉 Agent 如何调用中央命令，不重复定义质量门禁。

`validate-evidence` 只接受工作区私密区中的结构化结果；`PASS` 结果必须让所有检查项都是 `PASS`。管理器或设备探针遇到环境限制时必须保留 `BLOCKED`，不能用直接脚本测试冒充真实注入。

`new` 是独立项目的统一生成入口。当前生成器只创建可审查的 `direct` 单文件脚本；`bundle` 仍需等待构建适配器接入，不能把占位源码当作候选发布物。

## 公私边界

这个仓库可以公开；登录页面、完整 HTML、Cookie 邻近材料、HAR、截图、录屏、设备标识和本机路径不得进入仓库。发布工具将使用公开文件白名单，并在后续阶段加入密钥与隐私扫描。
