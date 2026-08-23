# Dayloom Core2：React 过程流适配改造草案

> 状态：Draft / 契约冻结后可直接分阶段实施
> 日期：2026-08-23
> 所有者：`dayloom/packages/core2`
> 上游规范：`promptpile/packages/promptpile-react/PROCESS_PILE_STREAMING_PLAN.md`
> 下游规范：`dayloom/packages/tui/REACT_TRANSPARENT_WORK_STREAMING_PLAN.md`

## 1. 目标

本改造只有一个核心目的：在用户与 AI 对话期间，通过 Core2 向应用层提供 Thought、Observe、Check 的实时过程接口，同时保持现有 Final、Conversation、Archive 和 World 权威边界不变。

```text
Promptpile React Process Pile v1
→ Core2 transport + validator
→ CoreEvent v1
→ TUI 按需展示
```

Core2 是协议适配器和 authority firewall，不是 React 文件系统管理器。

## 2. 职责边界

Core2 负责：

- 启动、取消和 drain Promptpile React 子进程；
- 从一个独立 pipe 读取 Process Pile v1 JSONL；
- 校验 framing、schema、identity、sequence、phase FSM 和联合终态；
- 将 Thought、Observe、Check、Final 投影为稳定 CoreEvent；
- 隔离不同 Dayloom Session 和 operation；
- 保证过程事件不进入 Conversation、Archive 或 World DTO。

Core2 不负责：

- 创建、读取、扫描或删除 React 临时工作目录；
- 传递 `--work-root` 或 `--work-lifecycle caller`；
- 访问、验证、缓存或持久化 `work_path` 指向的文件系统内容；
- 读取 handoff、Receipt 或其他 React 内部文件；
- 根据 Thought、Observe、Check 决定 World mutation；
- 决定 TUI 的布局、折叠、清除或着色。

React 使用默认 `work_lifecycle=cleanup`，自行闭环其临时目录。

## 3. 不变量

### 3.1 单一机器事实流

改造后：

```text
Process Pile = 唯一 React 机器事件源
stdout       = drain only
stderr       = capped diagnostic only
child exit   = transport witness
```

禁止把 Agent Event v1 stdout 与 Process Pile 合并排序。两个物理流不存在可验证的全局顺序。

### 3.2 权威边界

```text
临时过程信息
= work.started / work.delta / work.completed / work.failed
+ Thought / Observe / Check text

权威信息
= accepted user turn
+ verified Final
+ submission/publication result
+ Archive/World commit
```

- 过程正文只发送给当前 live observer；
- 不写入 Conversation、Archive、World、submission receipt 或导出 transcript；
- Final delta 可以实时展示，但只有联合终态成功后才完成；
- Core2 不缓存完整过程正文，只保留 FSM 所需的有限状态。

### 3.3 身份

一个 Dayloom Session 可以包含多次 operation：

```text
Session
├─ send operation 1
├─ send operation 2
└─ submit operation
```

每次 `send()` 或 `submit()` 创建唯一 `operationId`。所有过程和 Final 事件都同时携带 `sessionId + operationId`，迟到事件不能进入后续 operation。

React 的 `process_id` 用于流身份校验，`work_id` 在适配器内部校验后丢弃。`work_path` 作为不可信、临时、非持久化的 opaque presentation metadata 转发给 TUI；Core2 不访问该路径。

## 4. 公共 API

Core2 只公开一个无版本选择器的 `CoreEvent` v1 契约。旧 Agent Event 接口和运行时降级分支均删除；这是一次明确的破坏性更新。

### 4.1 CoreEvent v1

```ts
export type ReactWorkPhase = 'thought' | 'observe' | 'check';

export type CoreEvent =
  | { type: 'state.changed'; state: CoreState }
  | { type: 'work.started'; sessionId: string; operationId: string; workPath: string }
  | { type: 'work.delta'; sessionId: string; operationId: string; phase: ReactWorkPhase; stepIndex: number; text: string }
  | { type: 'work.completed'; sessionId: string; operationId: string; workPath: string }
  | { type: 'work.failed'; sessionId: string; operationId: string; status: 'failed' | 'cancelled'; message: string; workPath: string | null }
  | { type: 'output.started'; sessionId: string; operationId: string; messageId: string }
  | { type: 'output.delta'; sessionId: string; operationId: string; messageId: string; text: string }
  | { type: 'output.completed'; sessionId: string; operationId: string; messageId: string }
  | { type: 'output.failed'; sessionId: string; operationId: string; messageId: string; message: string };
```

`messageId` 由 Core2 在合法 `phase.started(final)` 时生成，在该 Final 生命周期内保持不变。

## 5. Transport

Core2 启动：

```text
promptpile-react
  --process-pile-fd 3
  --process-pile-format json
  ...现有 config/context/output 参数
```

不传 `--work-root`，不传 `--work-lifecycle caller`。

Node runner 使用显式 stdio pipe：

```ts
spawn(process.execPath, [reactBin, ...args], {
  stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
  windowsHide: true,
});

// child.stdio[3] 是 Process Pile reader
```

runner 边界必须支持 `AbortSignal`、FD3 chunk、stdout/stderr drain 和 child callback。stderr 只保留固定上限，Process Pile callback 失败触发同一个 abort 路径；dispose 前必须等待 child close 和所有 pipe EOF。

## 6. Validator 与 reducer

验证顺序：

```text
JSONL framing
→ Process Pile v1 schema
→ process identity
→ continuous sequence
→ phase FSM
→ terminal consistency
```

必须验证：

- 首事件恰好是一个 `process.started`，sequence 为 0；
- `process_id` 全程不变，sequence 连续递增；
- Thought/Observe/Check 满足 `started → delta* → completed`；
- step index、Check continue 和 max steps 一致；
- terminal Check 后 `work.ready` happens-before Final；
- Final skipped 时不得出现 Final phase；
- Final delta 聚合值等于 terminal Final content；
- terminal 唯一且之后无事件。

适配器只验证上游事实，不重新执行 React 决策。

## 7. 事件投影与完成边界

```text
process.started                         → work.started(workPath)
phase.delta(thought|observe|check)     → work.delta
work.ready                              → work.completed(workPath)
phase.started(final)                    → output.started
phase.delta(final)                      → output.delta
phase.completed(final)                  → 只封闭内部 Final accumulator
process.completed + EOF + exit 0 + 一致 → output.completed + success
process.failed / 本地 transport failure → Final 前 work.failed；Final 开始后 output.failed
```

`output.completed` 不能在 `phase.completed(final)` 时提前发送。Final skipped 不产生完成的 assistant message。已经开始 Final 后发生失败时发送一次 `output.failed`，绝不发送 `output.completed`。

## 8. 联合终态与错误映射

Core2 同时观察 protocol terminal、Process Pile EOF、child exit 和 cancel intent：

```text
合法 process.completed + EOF + exit 0 → success
合法 process.failed + EOF             → AGENT_FAILED / CANCELLED
EOF 前无 terminal                     → PROCESS_PILE_TRUNCATED
terminal 后还有事件                   → PROCESS_PILE_INVALID
completed 但 child nonzero             → PROCESS_EXIT_MISMATCH
schema/FSM/sequence 错误                → PROCESS_PILE_INVALID
```

公开 CoreResult 映射：

- React `cancelled` 或本地 cancel 胜出 → `CANCELLED`；
- 其他合法 `process.failed` → `AGENT_FAILED`；
- framing/schema/FSM/truncated/exit mismatch → `AGENT_FAILED`；
- runner 无法启动或 Core2 内部不变量失败 → `INTERNAL_ERROR`。

原始协议事件、provider metadata 和路径不进入公共 error DTO。

## 9. Cancel 与 dispose

每次 operation 有原子 generation 状态：

```text
OPEN
├─ 接受 verified terminal → TERMINAL
└─ 接受 cancel intent     → CANCELLED
```

只有首先从 `OPEN` 完成转换的一方生效。

Cancel：

```text
accept cancel intent
→ invalidate event projection
→ AbortSignal / terminate child
→ drain stdout/stderr/process pile
→ emit at most one work.failed(cancelled)
→ settle operation
```

Dispose 会 cancel active operation、等待 child 与 pipe drain、取消订阅并标记 Core disposed。Core2 不删除 React 临时目录；React cleanup 生命周期自行完成清理。

## 10. Conversation、Archive 与 World 防火墙

```text
Conversation/Archive/World 输入
= accepted user turns
+ verified Final
+ publication metadata

Conversation/Archive/World 输入
≠ work/process event
≠ Thought/Observe/Check text
≠ process_id/work_id/work_path
```

- Archive DTO 和 serializer 不依赖 React adapter；
- `work.*` 只能发给 live observer；
- debug log 不属于 Archive V2；
- failure/cancel 不归档过程正文；
- 过程流开关不改变 World mutation 结果；
- 本改造不新增 Core2 文件写入，不改变现有 Final/Archive publication 事务。

## 11. 依赖与发布边界

- `promptpile-react` 固定为 `0.1.0-beta.5`；
- 从发布包加载 `schema/process-pile-v1.schema.json`；
- `PackagedBoundaries` 提供 React binary 和 Process Pile validator；
- 禁止 deep import Promptpile React 源码或 dist 内部模块；
- Core2 tarball smoke 使用实际安装的 Promptpile React 包。

## 12. 分阶段实施

### Phase 0：冻结契约

- 冻结 CoreEvent v1、operationId/messageId 规则；
- 锁定 beta.5、schema、fixtures；
- 冻结错误映射与联合终态。

### Phase 1：runner 与协议 reducer

- FD3 pipe、stdout/stderr drain、AbortSignal；
- JSONL/schema/sequence/FSM validator；
- terminal/EOF/exit 联合判定。

### Phase 2：CoreEvent v1

- operation generation；
- work/output 事件投影；
- 单一事件契约与无降级路径；
- late/duplicate event guards。

### Phase 3：authority firewall

- Conversation/Archive/World guards；
- failure/cancel 无过程归档测试；
- diagnostic 截断和敏感字段测试。

### Phase 4：真实集成

- packaged Promptpile React beta.5；
- Windows/Linux FD3；
- send/submit/failure/cancel/dispose；
- 连续多次 operation 不串流。

## 13. 必测矩阵

Protocol：malformed JSON、schema error、sequence gap/duplicate/reorder、非法 phase、Final before ready、Final skipped、content mismatch、missing/duplicate terminal、EOF/exit mismatch。

Identity：连续 send 使用不同 operationId；submit 不继承 send generation；late event 不进入下一 operation；messageId 只属于一个 Final。

Authority：work delta 不写 Conversation；Archive 无过程正文和 React ID/path；failure/cancel 不归档过程；过程事件不改变 World publication。

Lifecycle：cancel/dispose 幂等；cancel 后无新投影但完整 drain；stderr 有上限；Core2 不创建或删除 React work 目录。

## 14. 完成定义

1. Core2 只消费单一 Process Pile，不合并双流时序。
2. Thought、Observe、Check 通过稳定 `work.*` 接口实时输出。
3. 每次 send/submit 有独立 operationId，迟到事件不能串流。
4. Final 与过程流共享严格时序，只有联合终态成功才发 `output.completed`。
5. Core2 不创建、读取或清理 React 临时工作目录；仅透明转发运行期间有效的 workPath。
6. 过程正文和 React 内部 ID/path 不进入 Conversation、Archive 或 World。
7. Core2 只有一个 CoreEvent v1 公共契约，无旧协议、选择器或静默降级。
8. packaged React → Core2 E2E 在 Windows/Linux 通过。
