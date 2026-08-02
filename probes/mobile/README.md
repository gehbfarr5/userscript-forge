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
