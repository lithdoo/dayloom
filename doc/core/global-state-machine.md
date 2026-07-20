# Core2 Global State Machine

> 状态：方向已定，core2 v1 实现中  
> 范围：core2 的 world/business 状态、指令、状态转移、引用有效性  
> 原则：全局状态机只负责业务阶段与指令合法性，不处理 UI 文本，不直接运行 AI 对话。

后续新增接口草案时，所有公开字段、方法和 union member 都必须带注释。

## 1. 边界

全局状态机描述 world 当前处于哪个业务阶段。

它不描述 Session 内部正在等待输入、streaming、loading、failed 等交互状态；这些属于 SessionManager / RuntimeSession。

状态机接收两类指令：

- world 指令：`init`、`daily`、`play`、`settle`、`revise`、`abandon-day`
- Session 控制指令：`submit`、`cancel`

`next` 不属于 core2 指令。CLI 可以自行提供 `next`，但必须转换成具体 world 指令后再提交给 Runtime。

## 2. World Phase

```ts
export type WorldPhase =
  /** world 尚未初始化。 */
  | 'uninitialized'
  /** 初始化 Session 进行中，等待输入、AI 回复或 submit/cancel。 */
  | 'initializing'
  /** world 已初始化，当前没有 active Session，处于稳定边界。 */
  | 'idle'
  /** daily/planning Session 进行中，正在生成或确认当日计划。 */
  | 'planning'
  /** 当日计划已提交，尚未进入行动推进。 */
  | 'planned'
  /** play Session 进行中，正在推进当日行动。 */
  | 'playing'
  /** 当日行动已提交，等待执行结算。 */
  | 'awaiting-settle'
  /** revise Session 进行中，正在修订 world。 */
  | 'revising'
  /** 存档异常或无法识别，第一版禁用所有 mutation。 */
  | 'invalid';
```

| 状态 | 含义 | 主要可接收动作 |
|------|------|----------------|
| `uninitialized` | world 尚未初始化 | `init` |
| `initializing` | 正在初始化 world，有 init Session | 输入、`submit`、`cancel` |
| `idle` | world 已初始化，处于干净边界 | `daily`、`revise` |
| `planning` | 正在生成/确认当日计划，有 planning Session | 输入、`submit`、`cancel` |
| `planned` | 已生成当日计划，尚未开始行动推进 | `play`、`abandon-day` |
| `playing` | 正在行动阶段，有 play Session | 输入、`submit`、`cancel` |
| `awaiting-settle` | 当日行动已完成，等待结算落盘 | `settle`、`abandon-day` |
| `revising` | 正在修订 world，等待提交或取消 | 输入、`submit`、`cancel` |
| `invalid` | 存档异常或无法识别 | 第一版禁用 mutation |

`initializing`、`planning`、`playing`、`revising` 是有 Session 的 world phase，但不等于 Session status。

## 3. State Graph

主线：

```text
uninitialized -- init --> initializing -- submit --> idle
initializing -- cancel --> uninitialized

idle -- daily --> planning -- submit --> planned
planning -- cancel --> idle

planned -- play --> playing -- submit --> awaiting-settle -- settle --> next day idle
playing -- cancel --> planned
```

修订：

```text
idle -- revise --> revising -- submit --> idle
revising -- cancel --> idle
```

放弃当日：

```text
planned -- abandon-day --> previous day idle
awaiting-settle -- abandon-day --> previous day idle
```

`playing` 不自动进入 `awaiting-settle`。play Session 可以产出“当日行动已完成”的 submit result，但只有 Runtime 执行 `submit` 时才能切换 world phase。

## 4. Command Table

| 指令 | 类型 | 可用状态 | 成功目标状态 | 失败行为 |
|------|------|----------|--------------|----------|
| `init` | world | `uninitialized` | `initializing` | 保持原状态 |
| `daily` | world | `idle` | `planning` | 保持原状态 |
| `play` | world | `planned` | `playing` | 保持原状态 |
| `revise` | world | `idle` | `revising` | 保持原状态 |
| `settle` | world | `awaiting-settle` | 下一天 `idle` | 保持原状态 |
| `abandon-day` | world | `planned`、`awaiting-settle` 且无 active Session | 前一天 `idle` | 保持原状态 |
| `submit` | session | `initializing`、`planning`、`playing`、`revising` 且 Session `ready-to-submit` | 见状态图 | 保持原状态 |
| `cancel` | session | active Session 存在且未 `submitting/completed/cancelled` | 见状态图 | 保持原状态 |

`submit` 的可用性不能只看 world phase，必须同时要求 active Session status 为 `ready-to-submit`。

## 5. Invalid

`invalid` 第一版行为：

- Runtime 可以启动并返回 `world.phase = invalid`
- `invalidReason` 必须可展示
- 所有 mutation command disabled
- `sendInput()` 返回 `INPUT_NOT_EXPECTED` 或 `WORLD_INVALID`
- `executeCommand()` 返回 `WORLD_INVALID`
- `dispose()` 仍可执行
- 不提供 repair/recover/import/migrate

恢复/修复能力后续单独设计。

`settle` 成功后 phase 变为 `idle`，同时 `day` 从当前 day 推进到下一天，例如 `day_0001 -> day_0002`。

`abandon-day` 成功后 phase 变为 `idle`，同时 `day` 切回前一天；如果当前是 `day_0001`，没有前一天，则 `day = null`。

## 6. Core2 v1 文件有效性模型

core2 不追求强文件回滚。

业务正确性由以下内容决定：

- `current.json` 指针
- Runtime 内存中的 `WorldSnapshot`
- day 目录中的 `meta.json`
- `abandoned.json` 标记

文件存在不代表有效。只有被当前有效引用指向的文件才参与业务读取。

规则：

- Runtime 启动时从 `manifest.json` 与 `current.json` 读取最小 `WorldSnapshot`。
- 两个文件都不存在时，Runtime 认为 world 是 `uninitialized`。
- 只有一个文件存在、JSON 无法解析或 phase 无法识别时，Runtime 进入 `invalid`。
- 第一版不承诺 publish marker、orphan marker 或 gc。
- 未被 `current.json` 指向的中间文件不参与业务读取，不影响状态机判断。
- 删除中间产物是 best-effort cleanup。
- cleanup 失败只记录 warning，不阻塞状态切换。
- 后续可以提供 `gc` 工具清理未引用文件。

## 7. Cancel / Abandon-Day

`cancel`：

- 主语义是取消当前 Session，不提交产物。
- 业务指针回到进入 Session 前的边界。
- session/workspace 中间产物第一版只做 best-effort cleanup；如需 cancelled marker 后续单独设计。
- 物理删除是 best-effort cleanup。

`abandon-day`：

- 主语义是让当前 day 不再被业务指针引用。
- `current.json` 指针切回前一天 `idle`；`day_0001` 被放弃时切到 `day = null`。
- 被放弃 day 写入 `abandoned.json`。
- 物理删除 day/workspace 文件是 best-effort cleanup。

需要进一步细化：

- 更完整的 state log 格式
- state log 追加规则
- gc 规则

## 8. 现有 Play 差异

现有 `play/event-loop` 在事件耗尽或用户结束当天时会调用 `finishPlay()`。

现有 `finishPlay()` 会直接把 `play.state.json`、`current.yaml`、day `meta.yaml` 写成 `settling`。

这与 core2 目标冲突：

```text
playing -- submit --> awaiting-settle
```

core2 的 play Session 不应复用带 phase 副作用的 `finishPlay()` 作为内部逻辑。

## 9. 第一阶段验收

- 每个 world phase 的可用指令和不可用原因可测。
- `submit/cancel/abandon-day` 的逻辑状态跳转可测。
- `current.json` 读取、`settle` 推进 day、`abandon-day` 写 marker 可测。
- publish marker、gc、复杂 cleanup 行为不在阶段一实现。
