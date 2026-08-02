# 需求工作单契约

每个新脚本先在工作区私密区生成一份 `work-order.json`，再创建项目。工作单只保存需求摘要、目标平台、范围、风险和验收场景，不保存真实网页、账号、Cookie、设备序列号或登录态。

私密工作单位置约定为：

```text
private/work-orders/<project-id>/work-order.json
```

校验入口：

```text
pnpm run forge -- validate-work-order ../private/work-orders/<project-id>/work-order.json --json
```

工作单中的 `platforms.requiredVerification` 必须同步到项目的 `new --verify` 参数。它只声明“必须验证什么”，不把未运行的目标写成支持；`platforms.deferred` 明确记录延后目标。

`risk.accountActions` 为 `form-submit` 或 `state-change` 时，Agent 必须在工作单中写出具体验收场景和禁止动作；付款、凭据变更、批量外发和不可逆删除不由默认流程自动执行。
