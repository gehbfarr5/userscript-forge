# Greasy Fork 发布交接

`greasyfork.manifest.json` 描述当前唯一支持的 Greasy Fork 浏览器编排路径。中央 CLI 的 `greasyfork-handoff` 只校验候选提交、版本和 SHA-256，并生成创建页、版本更新页、公开脚本页和公开代码页；它不登录、不读取 Cookie、不提交表单，也不假设 Greasy Fork 存在写入 API。

首次导入时运行 handoff 可省略 `--script-id`，或使用显式的 `--script-id new`；输出只包含 `createUrl`。Greasy Fork 创建脚本并返回数字 ID 后，重新运行并传入 `--script-id <ID>`，输出才会包含 `updateUrl`、`scriptPageUrl` 和 `codePageUrl`。数字 ID 模式保持现有版本更新流程。

外部浏览器编排器必须：

1. 使用当前候选的完整可读脚本内容。
2. 按 manifest 的 `requiredChecks` 完成首次创建或版本更新。
3. 核对公开脚本页的版本、安装链接和公开代码页。
4. 将脱敏 `result.json` 写入 `private/evidence/<project>/publication/`，并绑定 `sourceCommit` 与 `artifact.sha256`。

凭据、Cookie、密码、OTP、Session ID 和账户安全密钥不得写入 evidence。`greasyfork-handoff` 的 PASS 只代表交接材料有效，不代表公开发布已完成；公开发布 PASS 必须来自独立浏览器结果。
