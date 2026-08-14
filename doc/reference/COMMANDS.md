# Commands and Global State Machine

> **类型**：reference  
> **状态**：implemented  
> **最后核对**：2026-07  
> **代码入口**：`packages/core/src/domain/`

## 1. 两层状态

Core 分别维护：

- `WorldPhase`：world 的业务阶段；
- `SessionStatus`：active Session 当前的交互活动。

状态机只决定业务阶段转移。某个 command 是否可执行，可以同时依赖 world phase、Session kind 和 Session status，但不能把两层状态合并成一个枚举。

## 2. World Phase

```ts
export type WorldPhase =
  /** world 尚未初始化。 */
  | 'uninitialized'
  /** init Session 进行中，仅存在于首次发布前的进程内状态。 */
  | 'initializing'
  /** world 已初始化，当前没有 active Session。 */
  | 'idle'
  /** planning Session 进行中。 */
  | 'planning'
  /** 当日计划已提交。 */
  | 'planned'
  /** play Session 进行中。 */
  | 'playing'
  /** 当日行动已提交，等待结算。 */
  | 'awaiting-settle'
  /** revise Session 进行中。 */
  | 'revising'
  /** 存档无法形成可信快照。 */
  | 'invalid';
```

| Phase | 类型 | Active Session | 可进入动作 |
|-------|------|----------------|------------|
| `uninitialized` | 稳定 | 无 | `init` |
| `initializing` | 会话 | `init` | 输入、`submit`、`cancel` |
| `idle` | 稳定 | 无 | `daily`、`revise` |
| `planning` | 会话 | `planning` | 输入、`submit`、`cancel` |
| `planned` | 稳定 | 无 | `play`、`abandon-day` |
| `playing` | 会话 | `play` | 输入、`submit`、`cancel` |
| `awaiting-settle` | 稳定 | 无 | `settle`、`abandon-day` |
| `revising` | 会话 | `revise` | 输入、`submit`、`cancel` |
| `invalid` | 异常稳定 | 无 | 无 mutation |

`initializing` 不写入正式 commit。其它会话 phase 通过 archive session-boundary commit 持久化，具体规则见 [Archive Format](/reference/ARCHIVE_FORMAT)。

## 3. 状态图

```text
uninitialized -- init --> initializing -- submit --> idle
initializing -- cancel --> uninitialized

idle -- daily --> planning -- submit --> planned
planning -- cancel --> idle

planned -- play --> playing -- submit --> awaiting-settle
playing -- cancel --> planned

awaiting-settle -- settle --> next-day idle

idle -- revise --> revising -- submit --> idle
revising -- cancel --> idle

planned -- abandon-day --> previous-day idle
awaiting-settle -- abandon-day --> previous-day idle
```

Session 内部事件耗尽、AI 回复完成或产物准备完成都不会自动推进 phase。

## 4. Command

```ts
export type WorldCommand =
  /** 开始初始化 Session。 */
  | 'init'
  /** 开始当日 planning Session。 */
  | 'daily'
  /** 开始 play Session。 */
  | 'play'
  /** 结算当前 day。 */
  | 'settle'
  /** 开始 revise Session。 */
  | 'revise'
  /** 放弃当前 day。 */
  | 'abandon-day';

export type SessionCommand =
  /** 提交 active Session 产物。 */
  | 'submit'
  /** 取消 active Session。 */
  | 'cancel';

export type RuntimeCommand = WorldCommand | SessionCommand;
```

Core 不包含任何应用级导航、帮助、退出或聚合指令。

## 5. Availability

```ts
export interface CommandAvailability {
  /** 指令名称。 */
  name: RuntimeCommand;

  /** 指令分类。 */
  type: 'world' | 'session';

  /** 当前是否可执行。 */
  enabled: boolean;

  /** 稳定机器原因码；可执行时为 null。 */
  reasonCode: CommandUnavailableReason | null;

  /** 诊断信息；可执行时为 null。 */
  reason: string | null;
}
```

```ts
export type CommandUnavailableReason =
  | 'WORLD_INVALID'
  | 'PHASE_MISMATCH'
  | 'SESSION_REQUIRED'
  | 'SESSION_ALREADY_ACTIVE'
  | 'SESSION_KIND_MISMATCH'
  | 'SESSION_STATUS_MISMATCH'
  | 'CURRENT_DAY_REQUIRED'
  | 'RUNTIME_CLOSED';
```

禁用原因不能只提供展示字符串，否则调用方无法稳定分支。

## 6. Command Table

| Command | 可用条件 | 目标 phase | 存档 operation |
|---------|----------|------------|----------------|
| `init` | `uninitialized`，无 Session | `initializing` | 创建 init workspace，不发布 archive |
| `daily` | `idle`，无 Session | `planning` | 发布 session-boundary commit |
| `play` | `planned`，无 Session | `playing` | 发布 session-boundary commit |
| `revise` | `idle`，无 Session | `revising` | 发布 session-boundary commit |
| `settle` | `awaiting-settle`，有 current day，无 Session | `idle` | 发布 settled day revision 和 commit |
| `abandon-day` | `planned` 或 `awaiting-settle`，有 current day，无 Session | `idle` | 发布 abandoned day revision 和 commit |
| `submit` | 会话 phase，Session kind/status 匹配 | 见 Submit 表 | 发布 Session 产物和稳定 commit |
| `cancel` | 会话 phase，active Session 可取消 | 来源稳定 phase | 发布恢复稳定 commit；init 不发布 |

## 7. Submit Table

| 当前 phase | Session kind | Result kind | 目标 phase |
|------------|--------------|-------------|------------|
| `initializing` | `init` | `init` | `idle` |
| `planning` | `planning` | `planning` | `planned` |
| `playing` | `play` | `play` | `awaiting-settle` |
| `revising` | `revise` | `revise` | `idle` |

Submit 必须同时满足：

- active Session 存在；
- phase 对应的 expected kind 与 Session kind 相同；
- Session status 为 `waiting-input` 或 `ready-to-submit`；
- submission result kind 与 expected kind 相同；
- 当前 archive revision 仍与 Session 的 base/boundary revision 一致。

任一条件失败都不得发布存档、清除 Session 或改变 phase。

## 8. Cancel Table

| 当前 phase | 目标 phase | 业务引用来源 |
|------------|------------|--------------|
| `initializing` | `uninitialized` | 无正式存档 |
| `planning` | `idle` | activeSession.baseCommitId |
| `playing` | `planned` | activeSession.baseCommitId |
| `revising` | `idle` | activeSession.baseCommitId |

`cancel` 取消会话，不等于删除所有中间文件。Operation workspace 变为 cancelled，正式业务引用回到 base commit 的内容，但通过新 commit 发布，revision 不倒退。

## 9. Abandon-Day

`abandon-day` 与 `cancel` 不同：

- cancel 结束当前 Session，恢复 Session 前的稳定业务引用；
- abandon-day 是稳定状态下的正式业务操作，将当前 day 标记为 abandoned；
- abandoned day 仍保留在 commit 的 `dayHeads` 中；
- world current day 回到前一天；
- 放弃 `day_0001` 时 current day 为 null。

## 10. Invalid

`invalid` 表示 ArchiveRepository 无法构造可信 `WorldSnapshot`。

- 所有 Runtime command disabled；
- `sendInput()` 返回 `WORLD_INVALID`；
- 只读 snapshot 和 archive inspection 仍可使用；
- `dispose()` 始终允许；
- 自动修复不属于基础状态机 command。

状态机不分析文件损坏原因，只接收已经归一化的 `invalid` snapshot。具体诊断码由 ArchiveRepository 提供。

## 11. 纯接口方向

```ts
export interface StateMachine {
  /** 计算全部 Core command 的当前可用性。 */
  getAvailableCommands(input: MachineInput): CommandAvailability[];

  /** 计算开始 world command 后的目标状态，不执行副作用。 */
  transitionWorld(command: WorldCommand, input: MachineInput): TransitionResult;

  /** 根据 Session submission 计算目标状态。 */
  transitionSubmit(submission: SessionSubmission, input: MachineInput): TransitionResult;

  /** 计算取消 Session 后的目标状态。 */
  transitionCancel(input: MachineInput): TransitionResult;
}

export interface MachineInput {
  /** 当前 world 快照。 */
  world: WorldSnapshot;

  /** 当前 Session 快照。 */
  session: SessionSnapshot;
}

export type TransitionResult =
  | { ok: true; nextWorld: WorldSnapshot; createSession?: SessionKind }
  | { ok: false; error: RuntimeError };
```

TransitionResult 只描述逻辑目标，不携带文件写入函数、Session 实例或 provider 对象。

## 12. 验收

- 每个 phase/command 组合均有 availability 测试；
- availability 和 transition 使用同一规则来源；
- submit 同时测试 phase、Session kind、status、result kind；
- cancel 精确回到来源稳定 phase；
- invalid 禁用全部 command；
- 状态机测试不创建文件、不启动 Session、不调用 AI；
- 同一输入产生确定且不可变的结果。
