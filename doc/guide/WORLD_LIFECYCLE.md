# World 生命周期

> **类型**：guide  
> **状态**：implemented  
> **最后核对**：2026-07

## 1. 初始化 World

新目录首次打开时处于 `uninitialized`。在 Hub 选择“初始化 World”，进入 init Session：

1. 与 AI 讨论前提、规则、风格和用户角色。
2. 信息足够后输入 `/submit`。
3. Core 验证 init submission，发布 manifest、canon revision、commit 和 current pointer。
4. World 进入 `idle`。

如果不想保存，输入 `/exit` 或 `/cancel`，World 保持未初始化。

## 2. 制定当日计划

`idle` 时选择“制定当日计划”：

```text
idle ─daily→ planning ─submit→ planned
                         └─cancel→ idle
```

planning Session 产出当日 intent 和 plan beats。只有 `/submit` 后才会创建已发布 Day revision。

## 3. 推进当日行动

`planned` 时选择“进入行动”：

```text
planned ─play→ playing ─submit→ awaiting-settle
                         └─cancel→ planned
```

play Session 记录用户行为、assistant 结果、事件和 transcript。提交后 Day 进入待结算状态。

## 4. 结算并进入下一天

`awaiting-settle` 时选择“结算当日”。settle 是 Hub 中的短流程，不打开 Session 页：

1. 生成 settlement revision。
2. 将当日标记为 settled。
3. 更新 last settled day。
4. 推进到下一 Day 的 `idle`。

## 5. 修订 World

`idle` 时可进入 revise Session。提交会创建完整的新 canon revision，不原地覆盖旧设定；取消则回到原 `idle` commit。

## 6. 放弃当日

`planned` 或 `awaiting-settle` 时可选择 `abandon-day`。Core 发布 abandoned day revision，并将 current day 回到前一个业务边界。放弃 `day_0001` 时 current day 可能为 `null`。

## 7. 失败和恢复

- AI 失败不会自动提交；可保留部分文本并 cancel。
- submission 校验失败时保持 Session，可继续对话后重试。
- archive 发布失败时保持上一个 current pointer。
- 进程在 active Session 边界中断时，下次 Runtime 启动先执行恢复。

详细的 phase/command 矩阵见 [Command 参考](/reference/COMMANDS)。

