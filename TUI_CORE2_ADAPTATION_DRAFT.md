# Dayloom TUI → Core2 完整交互适配实现冻结

> Status: Implementation Freeze / 可直接实施  
> Date: 2026-08-14  
> Target package: `@dayloom/tui`  
> Backend target: `@dayloom/core2`  
> Core2 accepted baseline: `bc74d3fcf3205695ef3386cfeef539beeb996a59`  
> Additional prerequisite: 本文 §5 冻结的 Core2 `running` interrupt-cancel amendment 必须先落地并同步回 `CORE2_FUNCTIONAL_COMPLETION_DRAFT.md`

本文档取代此前所有 Play-only 或功能残缺的 TUI → Core2 适配方案。

本次目标不是“让 TUI 能调用 Core2”，而是：

> **在不复活旧 Runtime、不复制业务状态机、不让 Core2 知道 TUI 的前提下，用 Core2 application semantics 完整、交互一致地驱动恢复后的 Dayloom TUI。**

实现者不得再决定 lifecycle、action mapping、message ownership、page transition、loading、failure presentation、selection、cancel 时序、CLI bootstrap、PTY seam、example wiring 或 CI build ordering 应该如何工作。若真实依赖与本文 contract 冲突，必须先修改 Freeze，再修改实现。

---

## 1. Freeze 解释

本 Freeze 分两个严格顺序的 Gate：

```text
Gate 0
Core2 consumer-neutral running interrupt cancel
→ Core2 freeze / tests / CI green

Gate 1
TUI backend replacement
@dayloom/core → @dayloom/core2
→ unit / PTY / examples / CI green
```

不得跳过 Gate 0 后在 TUI 中模拟 cancel。

除 §5 的窄 interrupt-cancel amendment 外，本适配**不修改**：

```text
Archive Protocol
Core2 World Profile
Core2 persisted phases
Core2 publication theorem
Promptpile / React / compression ownership
Init / Planning / Play / Revise submission contracts
Settle / Abandon semantics
```

---

## 2. 双域规范来源

这里不使用一个简单的“谁优先于谁”列表，而按 ownership 分域。

### 2.1 Application truth

唯一规范来源：

```text
@dayloom/core2 public root contract
CORE2_FUNCTIONAL_COMPLETION_DRAFT.md
```

它决定：

```text
World truth
Session truth
capabilities / legality
CoreResult
CoreEvent
publication result
cancel result
```

### 2.2 Interaction truth

唯一规范来源：

```text
恢复后的 packages/tui
packages/tui/DESIGN.md
doc/guide/TUI.md
packages/tui/test/*
```

它决定用户可观察的：

```text
Hub / Session 两页模型
status / help
HubSelect
Textarea
shortcuts
streaming message
loading
slash commands
input history
scroll
focus
resize
failure transcript
```

### 2.3 历史参考

`@dayloom/core` 仅用于解释旧行为，不得决定新 API 或 shape。

禁止恢复：

```text
RuntimeSnapshot
RuntimeEvent
RuntimeCommand
CommandAvailability
MessageStore
World transient phases
legacy SessionStatus
createDayloomRuntime()
SessionFactory
```

当 interaction truth 需要一个 Core2 当前没有、但显然属于 consumer-neutral application semantic 的能力时，必须先补 Core2 contract。§5 的 running interrupt cancel 是本次唯一这样的能力。

---

## 3. 最终 ownership theorem

```text
Core2
  owns application legality
  owns World / Session lifecycle
  owns Promptpile Conversation
  owns React execution
  owns publication
  owns cancellation of active agent work
  owns terminal business result

TUI driver
  owns projection
  owns product action vocabulary
  owns one current presentation transcript
  owns local status/help mode
  owns selection
  owns pending visual feedback
  owns recent-result presentation

ViewModel / Components
  own focus
  own input/history
  own scroll/stick-to-bottom
  own viewport/layout
```

禁止：

```text
TUI 自己实现 World state machine
TUI 自己实现 Session business state machine
TUI 自己推断 publication 是否成功
TUI queue Core2 business mutation
TUI kill Core2 child
TUI dispose + recreate Core 模拟 Session cancel
Core2 import TUI type
Fake DayloomRuntime compatibility facade
RuntimeBackend / OldCoreBackend / Core2Backend
packages/tui2
```

最终依赖方向唯一为：

```text
@dayloom/core2
      ↓
TUI-owned projection driver
      ↓
ViewModel
      ↓
existing BindTTY components
```

---

## 4. 必须完整保留的用户能力

### 4.1 Hub business capability

```text
init
daily
revise
play
settle
abandon-day
```

### 4.2 Session capability

```text
自然语言多轮输入
AI Final streaming
显式 /submit
ready 时 /exit / /cancel
AI streaming/running 时高优先级 /exit / /cancel
partial output 保留
failure feedback
failure transcript 查看后显式返回 Hub
输入历史
滚动
焦点
resize
```

`submitting` 时当前恢复 TUI 本来就禁用输入，因此**不要求** submit publication 中 interrupt cancel。

### 4.3 主生命周期

```text
empty World
→ Init Session
→ idle
→ Daily / Planning Session
→ planned
→ Play Session
→ awaiting-settle
→ Settle
→ idle
→ Daily next day
```

旁路：

```text
idle → Revise Session → idle
planned → abandon-day → idle
awaiting-settle → abandon-day → idle
```

任何以上入口因 migration 消失，都视为适配失败。

---

## 5. Gate 0 — Core2 running interrupt-cancel amendment

这是 TUI migration 前唯一允许新增的 Core2 application semantic。

### 5.1 原因

恢复 TUI 的既有交互是：

```text
waiting-input
→ 普通文本 + /submit + /exit

streaming/loading
→ 普通文本不可发送
→ Textarea 仍可输入高优先级 /exit / /cancel

submitting
→ Textarea disabled
```

当前 Core2 `cancel` 只在 `ready && !mutationInFlight` 时可用，因此不能无损表达 streaming 中取消。

TUI 不得通过 kill child / queue / recreate Core 模拟，因此 Core2 必须提供真正的 consumer-neutral interrupt semantic。

### 5.2 Public state contract

`CoreState` shape 不增加 TUI-specific 字段。

`capabilities.cancel` 冻结为：

```text
ready Session
→ true

running Session
→ true

submitting Session
→ false

no Session / disposed
→ false

同一 running Session 已有 interrupt cancel pending
→ false
```

`send` / `submit` legality 不变：

```text
ready → send=true / submit=true
running → send=false / submit=false
submitting → send=false / submit=false
```

### 5.3 Error code

Core2 增加：

```ts
'CANCELLED'
```

含义唯一为：

> 当前 in-flight Session operation 因一个成功登记的 `cancel()` intent 被主动终止。

不得把 intentional cancellation 映射成 `AGENT_FAILED` 或 `CONVERSATION_FAILED`。

### 5.4 `cancel()` exact behavior

#### ready

保持当前业务语义：

```text
ready Session
→ terminalize Session
→ World unchanged
→ await one complete workspace cleanup attempt
→ cleanup success: {ok:true}
→ cleanup failure: {ok:false, INTERNAL_ERROR}
   但 public Session 仍必须为 null
```

#### running

唯一允许绕过普通 `BUSY` mutation rejection 的 public path 是：

```text
cancel() against the same active running Session
```

顺序冻结：

```text
capture sessionId
→ register exactly one interrupt-cancel intent for that sessionId
→ state.changed: cancel capability becomes false
→ stop emitting new output.delta for that session
→ kill exact currently active child if present
→ any later child started by that same in-flight send is killed immediately
→ await the existing send operation to settle
→ await provider drain / child close already owned by Core2 compression/runtime
→ terminalize the same Session
→ await one workspace cleanup attempt
→ World unchanged
→ cancel() settles
```

被 interrupt 的 `send()` 必须返回：

```ts
{ ok: false, error: { code: 'CANCELLED', ... } }
```

并且在 cancellation path 中 **send 不得再次独立 terminalize 同一 Session**；running cancel 是该 terminal intent 的 owner。

`cancel()` 最终结果：

```text
cleanup success
→ {ok:true}

cleanup failure
→ {ok:false, INTERNAL_ERROR}
→ Session 仍然必须为 null
→ residue 仍是 private runtime data，由 dispose() 最终 cleanup
```

已经在 cancel intent 登记前发布的 `output.delta` 不回滚。

cancel intent 登记后不得再公开该 Session 的新 `output.delta`。

### 5.5 Race / idempotence

同一 running Session 的第二次 `cancel()`：

```text
若第一次 interrupt cancel 尚未 settle
→ join 同一个 pending cancellation
→ 返回相同 terminal outcome
```

不创建 cancellation queue。

若 running operation 在 cancel 调用真正登记前已经自然结束：

```text
final Session ready
→ cancel 按 ready contract 执行

final Session terminal
→ cancel 返回 NOT_AVAILABLE
```

### 5.6 Dispose interaction

`dispose()` 必须继续满足强收尾 theorem，并额外等待 pending interrupt cancellation：

```text
dispose settle
→ no child
→ no compression provider
→ no current operation
→ no interrupt-cancel continuation
→ no Session workspace access
→ runtimeRoot removed
```

### 5.7 明确不是 concurrency framework

新增能力只允许：

```text
one send execution
+
one terminal cancel intent for the same Session
```

仍然禁止：

```text
two React executions
parallel World mutations
queue
scheduler
actor
cancellation manager
operation registry
```

推荐实现只允许少量 concrete state：

```text
cancelRequestedSessionId: string | null
interruptCancelPromise: Promise<CoreResult> | null
```

以及现有 child/currentOperation hooks 上的窄检查。

### 5.8 Gate 0 acceptance

必须先新增并通过：

```text
core2-running-session-exposes-cancel-capability
core2-running-cancel-kills-active-child
core2-running-cancel-kills-child-started-after-intent
core2-running-cancel-stops-future-output-delta
core2-interrupted-send-returns-cancelled
core2-running-cancel-leaves-world-unchanged
core2-running-cancel-terminalizes-session
core2-running-cancel-awaits-provider-drain
core2-running-cancel-cleanup-failure-does-not-resurrect-session
core2-repeated-running-cancel-joins-one-terminal-intent
core2-submitting-cancel-remains-unavailable
core2-dispose-awaits-pending-interrupt-cancel
```

Gate 0 完成时必须同步：

```text
CORE2_FUNCTIONAL_COMPLETION_DRAFT.md
packages/core2 tests
Core2 dedicated CI
```

Gate 0 未 green 前不得开始删除 TUI 的 `@dayloom/core` dependency。

---

## 6. Package 决策

继续直接修改：

```text
packages/tui
examples/dayloom-tui
相关 TUI CI / docs
```

目标依赖：

```text
@dayloom/tui
├── @dayloom/core2
├── bindtty
└── @bindtty/*
```

删除：

```text
@dayloom/tui → @dayloom/core
```

Node baseline：

```json
{
  "engines": { "node": ">=20" }
}
```

默认不重写 `Header / MessageList / LoadingBar / HubSelect / TextInputArea / Footer`。

---

## 7. Core2 → TUI product action mapping

TUI 保留产品词汇；Core2 保持 application semantic。

| TUI action | Core2 call | 页面形式 |
|---|---|---|
| `init` | `startSession('init')` | Hub → Session |
| `daily` | `startSession('planning')` | Hub → Session |
| `revise` | `startSession('revise')` | Hub → Session |
| `play` | `startSession('play')` | Hub → Session |
| `settle` | `settle()` | Hub 短流程 |
| `abandon-day` | `abandonDay()` | Hub 短流程 |
| 普通文本 | `send(text)` | Session |
| `/submit` | `submit()` | Session terminal |
| `/exit` / `/cancel` | `cancel()` | ready/running Session terminal |

`daily` 只存在于 TUI vocabulary；Core2 不新增 `daily()` compatibility API。

---

## 8. Hub action legality

唯一 legality source：

```text
CoreState.capabilities
```

映射：

```text
startSessions includes init     → init
startSessions includes planning → daily
startSessions includes revise   → revise
startSessions includes play     → play
settle                           → settle
abandonDay                       → abandon-day
```

TUI 不得仅用 `world.phase` 判断 action 是否可执行。

稳定顺序：

```text
init
daily
revise
play
settle
abandon-day
status
help
quit
```

快捷键：

```text
i → init
d → daily
r → revise
p → play
t → settle
s → status
? → help
q → quit
```

`abandon-day` 无单字符快捷键。

---

## 9. Exact TUI presentation types

禁止继续继承 legacy Core type。

```ts
export type TuiBusinessActionId =
  | 'init'
  | 'daily'
  | 'revise'
  | 'play'
  | 'settle'
  | 'abandon-day';

export type TuiLocalActionId = 'status' | 'help' | 'quit';
export type HubMode = 'status' | 'help';

interface TuiActionBase {
  label: string;
  summary: string;
  shortcut: string | null;
  recommended: boolean;
}

export type TuiHubAction =
  | (TuiActionBase & {
      id: TuiBusinessActionId;
      kind: 'business';
    })
  | (TuiActionBase & {
      id: TuiLocalActionId;
      kind: 'local';
    });

export interface TuiBusyState {
  actionId: TuiBusinessActionId;
  label: string;
}

export type TuiWorldView =
  | {
      status: 'uninitialized';
      worldRoot: string;
    }
  | {
      status: 'invalid';
      worldRoot: string;
      error: string;
    }
  | {
      status: 'published';
      worldRoot: string;
      worldId: string;
      title: string;
      revision: number;
      commitId: string;
      phase: 'idle' | 'planned' | 'awaiting-settle';
      day: string | null;
      lastSettledDay: string | null;
    };

export type TuiSessionPresentationStatus =
  | 'ready'
  | 'running'
  | 'submitting'
  | 'cancelling'
  | 'failed';

export interface TuiPresentationError {
  code: string;
  message: string;
}

export interface TuiSessionPresentation {
  id: string;
  kind: 'init' | 'planning' | 'play' | 'revise';
  status: TuiSessionPresentationStatus;
  error: TuiPresentationError | null;
}

export type TuiPage =
  | {
      kind: 'hub';
      mode: HubMode;
      busy: TuiBusyState | null;
    }
  | {
      kind: 'session';
      sessionId: string;
      sessionKind: 'init' | 'planning' | 'play' | 'revise';
    };

export interface TuiSessionControls {
  input: boolean;
  submit: boolean;
  cancel: boolean;
  dismiss: boolean;
}

export interface TuiMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'error' | 'warn';
  text: string;
  status: 'streaming' | 'complete' | 'error';
}

export interface TuiRecentResult {
  kind: 'completed' | 'cancelled' | 'failed';
  label: string;
  detail: string | null;
}

export interface TuiDriverState {
  page: TuiPage;
  world: TuiWorldView;
  session: TuiSessionPresentation | null;
  sessionControls: TuiSessionControls;
  hubActions: readonly TuiHubAction[];
  selectedHubActionId: string | null;
  recent: TuiRecentResult | null;
  messages: readonly TuiMessage[];
}
```

Hub action DTO 不保存 Core method/function，不创建 command object。

---

## 10. Exact driver-private request state

允许的 concrete presentation request state 只有：

```ts
interface PendingHubRequest {
  actionId: TuiBusinessActionId;
  frozenActions: readonly TuiHubAction[];
  frozenSelectedId: string | null;
}

interface ActiveSendRequest {
  sessionId: string;
  assistantMessageId: string | null;
  cancelRequested: boolean;
}

interface PendingSessionCancel {
  sessionId: string;
}
```

Driver 内允许拥有：

```text
core
latestCoreState
resolvedWorldRoot
hubMode
selectedHubActionId
pendingHubRequest
activeSendRequest
pendingSessionCancel
recent
presentedSession
one current transcript
local message id counter
disposed / disposePromise
```

禁止：

```text
world phase authority
command availability authority
second Session lifecycle
publication result authority
operation queue
backend abstraction
request manager
```

这些 request structs 都是单个用户请求的 presentation bookkeeping，不是业务 FSM。

---

## 11. World projection

```text
Core world uninitialized
→ TuiWorldView.uninitialized

Core world invalid
→ TuiWorldView.invalid

Core world published
→ TuiWorldView.published
```

`worldRoot` 始终来自：

```ts
path.resolve(options.worldRoot)
```

invalid World：

```text
Hub 正常进入
显示 error
无 business actions
status 推荐
local status/help/quit 可用
```

Malformed World 不是 startup fatal error。

---

## 12. Recommended action / selection / Hub pending

推荐只决定默认 selection，不决定 legality：

```text
init available   → init
daily available  → daily
play available   → play
settle available → settle
otherwise        → status
```

idle 同时有 `daily + revise` 时推荐 `daily`。

selection：

```text
old selected id 仍存在
→ 保留

否则
→ recommended
→ 若无 recommended，actions[0]
```

Hub business request 开始前：

```text
capture PendingHubRequest
→ page.busy = action label
→ 保留 frozenActions / frozenSelectedId
→ HubSelect hidden
→ emit
→ invoke Core
```

Core operation 期间即使 capabilities 暂时全 false，也继续显示 frozen action topology；这只防闪烁，不参与 legality。

Core Promise settle 后：

```text
latestCoreState = core.getState()
→ clear pendingHubRequest
→ 重新从 final capabilities 投影
```

---

## 13. Page / transcript ownership theorem

TUI 始终只有：

```text
Hub
Session
```

不增加业务页面。

同一时刻严格只有：

```text
0 or 1 presentedSession
0 or 1 transcript
```

### 13.1 新 Session

只有对应 `startSession()` **Promise success** 后才创建 presentation boundary：

```text
read final core.getState()
→ 必须存在预期 kind 的 Core Session
→ discard any previous presentation transcript
→ create presentedSession
→ create empty transcript
→ append one local opening system message
→ Hub → Session
```

`state.changed` 在 `startSession()` Promise settle 前出现 session id 时，只更新 `latestCoreState`，**不得提前切页**。

### 13.2 成功 terminal

```text
submit success
cancel success
cancel failure but final Core session == null
→ discard transcript
→ clear presentedSession
→ hubMode=status
→ Hub
```

### 13.3 Terminal failure transcript

Core2 的普通 send/submit failure 会 terminalize Core Session。

若 request failure 后：

```text
final core.getState().session == null
```

则允许：

```text
presentedSession.status = failed
presentedSession.error = CoreResult.error
Core Session 已不存在
transcript 继续保留
normal input disabled
仅 local /exit / /cancel dismiss
```

failed view dismiss：

```text
不调用 core.cancel()
不改变 recent=failed
→ discard transcript
→ clear presentedSession
→ Hub(status)
```

### 13.4 Transcript 最终释放

以下任何路径必须 discard 当前 transcript：

```text
submit success
cancel terminal
failed-view dismiss
new Session installation
driver dispose
```

TUI 不保存历史 Session transcript database。

---

## 14. Local Session opening guidance

Core2 `startSession()` 不负责 presentation greeting。

每种 Session 安装后追加一条 **system / complete** 本地消息：

```text
init
→ 你想从什么样的世界开始？

planning
→ 今天想怎么展开？可以先说你希望发生什么。

play
→ 行动会话已开始。你想先做什么？

revise
→ 你想修订哪些 World 设定？
```

它们：

```text
不调用 core.send()
不进入 Promptpile Conversation
不进入 semantic summary
不参与 submit
```

使用 `system` role 是有意的：不得伪装成真实 AI completion。

---

## 15. CoreEvent 与 Promise 的时序 authority

CoreEvent 只负责**事实同步**；发起 API 的 Promise / CoreResult 负责**presentation boundary transition**。

### 15.1 `state.changed`

永远执行：

```text
latestCoreState = event.state
```

如果当前已有同 id `presentedSession` 且没有 local cancelling override：

```text
Core ready       → presentation ready
Core running     → presentation running
Core submitting  → presentation submitting
```

如果 event 中 Session 变 null：

```text
不要立即切 Hub
等待拥有该 request 的 Promise settle 后 reconcile
```

如果 event 中出现一个 TUI 尚未安装的 session id：

```text
只保存 latestCoreState
不自动建立 transcript / page
```

### 15.2 每个 Core call settle 后

统一执行：

```text
finalState = core.getState()
latestCoreState = finalState
→ 根据该 call 的 CoreResult + finalState 做一次 reducer
```

不得仅根据 error code 猜 final Session/World。

### 15.3 stale async completion guard

每个 Session async completion 都必须携带发起时 `sessionId`。

如果 settle 时：

```text
presentedSession == null
或 presentedSession.id != request.sessionId
```

则不得修改 transcript/page/recent，只可 diagnostic。

这样旧 Promise 永远不能污染后续新 Session。

---

## 16. User input / streaming transcript

### 16.1 普通用户消息

仅当：

```text
sessionControls.input == true
```

才允许：

```text
trim
→ non-empty
→ append user / complete locally
→ install ActiveSendRequest
→ core.send(trimmed)
```

Core2 不发 user-message event。

### 16.2 `output.delta`

只接受：

```text
activeSendRequest != null
&& event.sessionId == activeSendRequest.sessionId
&& presentedSession.id == same sessionId
&& activeSendRequest.cancelRequested == false
```

首个 delta：

```text
create assistant / streaming
→ save assistantMessageId
```

后续 delta：

```text
append to same assistant message
```

每 chunk 创建一条 message 是实现错误。

stale/mismatched delta：ignore + diagnostic。

### 16.3 send success

```text
read final CoreState
→ same Session ready
→ streaming assistant → complete
→ clear ActiveSendRequest
→ presentation ready
```

### 16.4 ordinary send failure

如果不是 user interrupt cancel：

```text
preserve user message
preserve partial assistant
partial assistant: streaming → error
append error-role complete message
read final CoreState
```

若 final same Session 仍 active：

```text
保持 Session page
status 投影 final CoreState
```

若 final Session null：

```text
enter failed presentation
recent = failed / 会话失败
```

### 16.5 running cancel race

用户在 running 时提交 `/exit` 或 `/cancel`：

```text
activeSendRequest.cancelRequested = true
pendingSessionCancel = { sessionId }
presentedSession.status = cancelling
emit
→ core.cancel()
```

被 interrupt 的 `send()` 返回 `CANCELLED` 时：

```text
若 activeSendRequest.cancelRequested == true
→ 不进入 failed presentation
→ 不覆盖 recent
→ 不清 page
→ 只清理 send-side request bookkeeping
```

最终页面由 `cancel()` reducer 决定。

这条规则保证 concurrent send/cancel Promise 顺序不同也不会出现：

```text
用户已取消
→ late send failure 又把页面复活成 failed
```

---

## 17. Transcript resource policy

TUI-local transcript 保持 bounded：

```text
MAX_MESSAGES = 500
MAX_TEXT_CHARS = 250_000
```

淘汰规则冻结：

```text
append/update 后若超限
→ 从最旧的 complete/error whole message 开始淘汰
→ 不拆 message
→ 当前 streaming message 永远不淘汰/截断
→ 最新一条 message 即使自身超过 text cap 也完整保留
```

因此 cap 是 bounded-history policy，不允许截断当前用户正在看的最新响应。

---

## 18. Session controls / Textarea

### ready

直接投影 Core2：

```text
input  = capabilities.send
submit = capabilities.submit
cancel = capabilities.cancel
dismiss = false
```

Textarea enabled。

### running

Gate 0 后：

```text
input=false
submit=false
cancel=true
dismiss=false
```

Textarea **保持 enabled**，但只接受高优先级 cancel slash。

普通文本或 `/submit` 在 running 时：

```text
不调用 Core2
append local warn:
AI 正在回复，请等待，或输入 /exit 取消当前会话。
```

### cancelling

```text
input=false
submit=false
cancel=false
dismiss=false
```

Textarea disabled，loading=`正在取消会话...`。

### submitting

```text
input=false
submit=false
cancel=false
dismiss=false
```

Textarea disabled。

### failed presentation

```text
input=false
submit=false
cancel=false
dismiss=true
```

Textarea enabled，仅用于 local `/exit` / `/cancel`。

ViewModel：

```text
inputEnabled = sessionControls.input
inputControlEnabled = input || submit || cancel || dismiss
```

---

## 19. Slash command contract

slash token case-insensitive；参数不解析。

### ready active Session

```text
/submit       → core.submit()
/exit         → core.cancel()
/cancel       → core.cancel()
/status       → local system: 当前正在 Session 中，请先输入 /exit 回到 Hub 再查看状态。
/help         → local system: 当前正在 Session 中，请先输入 /exit 回到 Hub 再查看帮助。
/next         → local warn: tui 不提供 /next，请回到 Hub 选择具体流程。
/revise       → local warn: 请先回到 Hub，再选择修订流程。
unknown /...  → local warn: 未知指令：<token>
```

### running active Session

```text
/exit
/cancel
→ Core2 running interrupt cancel

其它任何输入（含普通文本、/submit、其它 slash）
→ local warn
→ 不调用 Core2
```

### submitting

Textarea disabled，不接收 Session input。

### failed presentation

```text
/exit
/cancel
→ local dismiss only

其它输入
→ local warn: 会话已结束，请输入 /exit 返回 Hub。
```

unknown slash 永远不进入 `core.send()`。

---

## 20. Result / recent reducer

每个 result reducer 第一行都是：

```text
finalState = core.getState()
```

### startSession

success：

```text
finalState 必须存在预期 kind Session
→ install presentation
→ recent unchanged
```

failure：

```text
stay Hub
→ recent failed / 操作失败
```

### send

success：见 §16.3。

failure：见 §16.4。

`CANCELLED + cancelRequested=true`：见 §16.5，不产生 failed recent。

### submit

success：

```text
final Session null
→ discard transcript
→ Hub(status)
→ recent completed / 会话已提交
```

failure：

```text
append error
若 final same Session active → stay Session
若 final Session null → failed presentation
recent failed / 会话提交失败
```

### cancel

success：

```text
final Session null
→ discard transcript
→ Hub(status)
→ recent cancelled / 会话已取消
```

failure + final Session null（例如 cleanup diagnostic）：

```text
用户 terminal intent 已成立
→ discard transcript
→ Hub(status)
→ recent failed
→ detail = Core error message
```

failure + final same Session active：

```text
clear cancelling override
→ restore status from finalState
→ append local error
→ stay Session
```

### settle

```text
success → recent completed / 结算完成
failure → recent failed / 操作失败
```

### abandonDay

```text
success → recent completed / 已放弃当前日
failure → recent failed / 操作失败
```

### WORLD_CONFLICT

Core2 已 one-shot refresh World，因此 reducer 必须使用 final `core.getState()`；不得保留 stale World。

---

## 21. Loading presentation

### Hub

```text
init        → 正在启动初始化会话...
daily       → 正在启动计划会话...
revise      → 正在启动修订会话...
play        → 正在启动行动会话...
settle      → 正在结算当日...
abandon-day → 正在放弃当日...
```

### Session

只从 presentation status 派生：

```text
ready       → null
running     → AI 正在回复...
cancelling  → 正在取消会话...
submitting  → 正在提交会话...
failed      → null
```

禁止第二套 Session loading FSM。

---

## 22. Hub status / help / terminology

`status` / `help` 是纯 TUI local mode。

Status 展示：

```text
World root
World status
published: title / revision / phase / day / lastSettledDay
invalid: error
recent
当前可用 business actions
```

Help 展示：

```text
Hub Enter / Up / Down
可见 shortcuts
普通 Session text
/submit
/exit / /cancel
/status / /help / /next / /revise
running 时 /exit 可中断 AI 回复
submitting 时输入禁用
```

World terminology：

```text
uninitialized   → 未初始化
invalid         → 异常
idle            → 空闲
planned         → 已计划
awaiting-settle → 待结算
```

禁止重新制造 World phase：

```text
initializing
planning
playing
revising
```

Session presentation label：

```text
init     → 初始化
planning → 计划
play     → 行动
revise   → 修订

ready       → 等待输入
running     → AI 回复中
cancelling  → 取消中
submitting  → 提交中
failed      → 会话失败
```

Action summary：

```text
init        → 创建基础设定，完成后可制定第一天计划
daily       → 和 AI 讨论并提交当前待规划日计划
play        → 推进当前已计划日的事件和行动
settle      → 结算当前日并回到空闲状态
revise      → 维护或修正已有 World canon
abandon-day → 放弃当前未结算日并回到空闲状态
```

---

## 23. ViewModel / Components 保留范围

默认保持：

```text
Hub / Session 两页
input history 最近 100 条
Ctrl+P / Ctrl+N
draft 恢复
Textarea minRows=1 / maxRows=4
page change scroll reset
stick-to-bottom
手动 scroll 后不强制 bottom
viewport / resize
HubSelect / Textarea autofocus
Ctrl+C 全局退出
```

`ViewModel` 只消费 `TuiDriverState`，不读取 raw CoreState。

```text
loadingLabel       → page.busy 或 session.status
inputEnabled       → sessionControls.input
inputControlEnabled→ input | submit | cancel | dismiss
```

components 不直接调用 Core2。

如果 components 出现 Core2 business-specific branch，优先视为 projection 设计错误。

---

## 24. Driver public seam

保留 TUI-owned presentation seam：

```ts
export interface TuiRuntimeDriver {
  getState(): TuiDriverState;
  subscribe(listener: (state: TuiDriverState) => void): () => void;
  runHubAction(actionId: string): Promise<'continue' | 'exit'>;
  submitSessionText(text: string): Promise<void>;
  setHubMode(mode: HubMode): void;
  selectHubAction(actionId: string): void;
  dispose(): Promise<void>;
}
```

生产 options：

```ts
export interface CreateRuntimeDriverOptions {
  worldRoot: string;
  llmConfigPath: string;
  diagnostic?: DiagnosticLogger;
}
```

生产创建唯一为：

```ts
createDayloomCore({
  worldRoot: path.resolve(options.worldRoot),
  llmConfigPath: path.resolve(options.llmConfigPath),
});
```

删除：

```text
runtime?: DayloomRuntime
sessionFactory?: SessionFactory
```

---

## 25. Test-only Core seam

为 unit / interaction PTY 允许一个**具体 DayloomCore seam**，但禁止 generic backend abstraction。

冻结：

```ts
createRuntimeDriverFromCoreForTest({
  worldRoot,
  core, // exact DayloomCore public interface
  diagnostic,
})
```

要求：

```text
放在 non-package-root internal module
不从 packages/tui/src/index.ts 导出
不进入 package exports
production main 永远不用它
```

它不是：

```text
RuntimeBackend
CoreProvider
BackendAdapter
```

它只用于把一个已存在的 `DayloomCore` public object 接到同一个 production projection driver。

---

## 26. PTY 验证分层

不再给 production CLI 增加 `PROMPTPILE_BIN`、fake-backend env 或 hidden runtime switch。

### 26.1 Production PTY smoke

启动真实：

```text
packages/tui/dist/main.js
→ createDayloomCore()
→ packaged Promptpile boundaries
```

使用一个合法但不会实际发起 LLM call 的 test caller TOML，只验证空 World Hub：

```text
startup
status/help
resize
quit
shutdown
```

不得通过环境变量替换 Core2 binary。

### 26.2 Interaction PTY

使用 test-only entrypoint，例如：

```text
packages/tui/test/support/pty-entry.mjs
```

它必须复用 production：

```text
mountApp
createViewModel
same runtime driver projection
same components
```

唯一不同是通过 §25 注入 deterministic `ScriptedDayloomCore`。

`ScriptedDayloomCore` 只实现 public `DayloomCore` contract 和预定 CoreState/CoreEvent/CoreResult，不模拟 Archive、Promptpile、React 或 publication internals。

环境变量若用于选择 scripted scenario，只存在于 test entrypoint；production `main.js` 不读取它。

### 26.3 Core2 headless truth

真实 Core2 lifecycle / publication / Promptpile / cancellation correctness 继续由 `@dayloom/core2` acceptance 证明。

最终证明关系：

```text
real Core2 headless application truth
+
real terminal interaction against scripted public Core contract
+
production CLI → real Core2 startup wiring smoke
=
TUI → Core2 integration acceptance
```

这比给 production 开测试后门更小、更可证明。

---

## 27. CLI / argv exact contract

CLI：

```text
dayloom-tui [worldRoot] --llm-config <path>
dayloom-tui --llm-config <path> [worldRoot]
```

只支持 separated option，不支持自行发明其它 syntax。

解析规则：

```text
0 or 1 positional worldRoot
0 or 1 --llm-config <path>
-h / --help
unknown option → error
第二个 positional → error
重复 --llm-config → error
--llm-config 缺 value → error
```

config precedence：

```text
CLI --llm-config non-empty
→ DAYLOOM_LLM_CONFIG non-empty
→ otherwise startup error + usage
```

`--help`：

```text
立即打印 usage
不要求 llm config
不创建 Core
```

路径：

```text
worldRoot absent → cwd
relative worldRoot → resolve against cwd
relative llmConfigPath → resolve against cwd
```

TUI 不解析 provider config，不注入 `[promptpile-react]`，不拥有 Promptpile topology。

`CoreInitializationError` 在 mount 前失败：

```text
stderr clear message
process exitCode=1
不进入 alternate screen
```

---

## 28. Official example closure

`examples/dayloom-tui/**` 属于本迁移的必改范围。

最终 official example 唯一路径：

```text
empty world directory
+
caller llm.toml
→ current @dayloom/core2
→ current @dayloom/tui
→ real Init
```

删除 example 中的 legacy/runtime override：

```text
PROMPTPILE_BIN
DAY_LOOM_DIR old-core assumptions
prebuilt planned World
fake init-world publication
world2 legacy naming
```

建议文件 contract：

```text
llm.example.toml   → checked-in caller config template
llm.toml           → ignored local copy
world/             → ignored local Archive root
open-world.sh/.bat → run current TUI
```

launcher：

```text
若 llm.toml 不存在
→ copy llm.example.toml → llm.toml

build/check current packages
→ node packages/tui/dist/main.js <world> --llm-config <llm.toml>
```

launcher 不创建 manifest/current/plan；空 World 必须真实进入 Init。

`.env.example` 只保留 provider secret 环境变量；不再声明 Promptpile binary override。

---

## 29. Build / CI ordering

clean checkout 下 TUI build 依赖 workspace generated types，因此顺序冻结：

```text
npm ci
→ build @dayloom/archive-protocol
→ build/test @dayloom/core2
→ build/test @dayloom/tui
```

TUI dedicated matrix 至少：

```text
Ubuntu  Node 20 / 22
Windows Node 20 / 22
```

每个 TUI job 在 `npm test -w @dayloom/tui` 前必须先：

```text
npm run build -w @dayloom/archive-protocol
npm run build -w @dayloom/core2
```

PTY 至少有一个 Ubuntu required job：

```text
node-pty 无法加载 → FAIL
不得 silent skip
```

其它矩阵可按平台能力运行或跳过 PTY，但 unit/build 不得跳。

必须有 production ESM/CJS wiring acceptance：

```text
tui-esm-loads-core2-public-root
```

证明 ESM `@dayloom/tui` 可以通过 package root 正常消费当前 CommonJS `@dayloom/core2`。

broader legacy `@dayloom/core` conformance 是否保留是独立事项，不得成为 TUI → Core2 acceptance 的 backend requirement。

---

## 30. Dispose / shutdown

顺序保持：

```text
request exit
→ dispose mounted BindTTY app
→ ViewModel unsubscribe
→ Driver unsubscribe Core2
→ core.dispose()
→ process exit
```

Driver dispose idempotent。

开始 dispose：

```text
disposed=true
→ stop TUI emits
→ listeners clear
→ discard transcript
→ async request completions no longer mutate presentation
→ core.dispose()
```

Core2 owns child kill / provider drain / interrupt cancel / runtimeRoot cleanup。

TUI 不重复 kill/cleanup。

---

## 31. Diagnostics

允许记录：

```text
CoreEvent type
world status/revision/phase
session id/kind/status
capability booleans
TUI page
pending action id
message length
CoreResult code
```

禁止记录：

```text
完整 user text
完整 model output
semantic summary
LLM secret
```

删除 legacy `summarizeRuntimeEvent()` 等 Runtime terminology。

---

## 32. Architecture guard

`packages/tui/**` production source 禁止：

```text
@dayloom/core
@dayloom/core-old
@dayloom/core2/src/
@dayloom/core2/dist/
```

只允许：

```text
@dayloom/core2
```

禁止新增命名/结构：

```text
RuntimeBackend
CoreBackend
BackendProvider
CommandRegistry
EventNormalizer
SessionManager
OperationQueue
```

Test support 可以实现 exact `DayloomCore` public interface，但不得被 production exports 引用。

---

## 33. 文件级实施边界

### Gate 0 必改

```text
CORE2_FUNCTIONAL_COMPLETION_DRAFT.md
packages/core2/src/state.ts
packages/core2/src/errors.ts
packages/core2/src/core.ts
packages/core2/test/*
```

具体文件若因当前实现组织略有不同，可以等价调整，但不得增加 framework。

### Gate 1 必改

```text
packages/tui/package.json
packages/tui/src/argv.ts
packages/tui/src/main.ts
packages/tui/src/types.ts
packages/tui/src/theme.ts
packages/tui/src/hub/actions.ts
packages/tui/src/hub/content.ts
packages/tui/src/message-history.ts
packages/tui/src/runtime-driver/create-runtime-driver.ts
packages/tui/src/runtime-driver/*test-only seam if needed
packages/tui/src/view-model.ts
packages/tui/src/diagnostics.ts
packages/tui/test/*
packages/tui/README.md
packages/tui/DESIGN.md
doc/guide/TUI.md
doc/packages/TUI.md
examples/dayloom-tui/**
TUI-related CI workflow
package-lock.json
```

### 默认不改

```text
packages/tui/src/components/header.tsx
packages/tui/src/components/message-list.tsx
packages/tui/src/components/loading-bar.tsx
packages/tui/src/components/hub-select.tsx
packages/tui/src/components/text-input.tsx
packages/tui/src/components/footer.tsx
packages/tui/src/app.tsx
```

如需业务 branch 才能适配，先重新检查 driver/view-model projection。

---

## 34. 实施顺序

```text
Step 0  Core2 running interrupt-cancel contract + tests
Step 1  sync Core2 freeze + Core2 CI green
Step 2  TUI architecture guard / dependency / Node baseline
Step 3  exact local presentation types
Step 4  Hub capability projection + pendingHubRequest
Step 5  Core2 production driver wiring
Step 6  Promise/Event temporal reducer
Step 7  transcript / streaming / failed presentation
Step 8  running cancel UI path
Step 9  ViewModel projection, preserve history/scroll/focus
Step 10 CLI + caller LLM config
Step 11 test-only DayloomCore seam + scripted PTY
Step 12 official example cleanup
Step 13 docs/theme/diagnostics
Step 14 unit + required PTY
Step 15 dedicated TUI CI matrix
Step 16 full acceptance gate
```

禁止“恢复 + 大规模 component refactor”同一阶段进行。

---

## 35. Unit acceptance

必须覆盖：

```text
tui-uninitialized-projects-init
tui-idle-projects-daily-and-revise
tui-planned-projects-play-and-abandon
tui-awaiting-settle-projects-settle-and-abandon
tui-invalid-projects-no-business-action

tui-daily-maps-to-startSession-planning
tui-all-six-business-actions-map-exactly-once
tui-business-action-dto-has-no-core-function

tui-selection-persists-while-visible
tui-pending-hub-request-freezes-action-topology
tui-pending-hub-request-reconciles-final-core-state

tui-start-session-does-not-switch-page-before-result
tui-start-session-success-installs-one-transcript
tui-opening-message-is-local-and-kind-specific

tui-user-text-appears-before-send-result
tui-output-delta-aggregates-one-assistant-message
tui-partial-output-survives-send-failure
tui-stale-delta-is-ignored
tui-old-request-cannot-mutate-new-session

tui-send-failure-terminal-keeps-failed-presentation
tui-submit-failure-terminal-keeps-failed-presentation
tui-nonterminal-failure-keeps-active-session-if-core-does
tui-failed-dismiss-does-not-call-core-cancel
tui-failed-dismiss-preserves-failed-recent
tui-terminal-path-discards-transcript

tui-ready-enables-normal-input-submit-cancel
tui-running-enables-only-high-priority-cancel
tui-running-normal-text-is-local-warning
tui-running-submit-is-local-warning
tui-running-exit-calls-core-cancel
tui-running-cancel-shows-cancelling
tui-interrupted-send-cancelled-result-does-not-create-failure-view
tui-cancel-result-owns-final-page-transition
tui-submitting-disables-textarea

tui-status-help-next-revise-remain-local
tui-unknown-slash-never-reaches-core-send

tui-world-conflict-renders-refreshed-world
tui-cancel-cleanup-error-does-not-resurrect-session

tui-transcript-evicts-oldest-whole-messages
tui-transcript-never-truncates-current-stream
tui-input-history-preserves-draft
tui-page-transition-resets-scroll
tui-manual-scroll-preserves-stick-choice
tui-autofocus-hub-session-hub

tui-dispose-idempotent
tui-dispose-discards-transcript
tui-dispose-prevents-late-async-presentation-write

tui-cli-option-order-is-stable
tui-cli-config-flag-beats-env
tui-cli-help-needs-no-llm-config
tui-esm-loads-core2-public-root
```

---

## 36. Required PTY acceptance

### 36.1 Production Core2 smoke

```text
real dist/main.js
+ empty World
+ valid caller TOML
→ 未初始化 Hub
→ Init recommended
→ ? help
→ s status
→ resize
→ q
→ clean exit
```

不触发 LLM。

### 36.2 Scripted interaction PTY

必须使用同一 production app/view-model/components/driver projection 验证：

```text
Init → opening → text → streaming → ready
running → /exit → cancelling → Hub cancelled
Init submit → idle
Daily → planning transcript → submit → planned
Play → multi-turn → submit → awaiting-settle
Settle → Hub loading → idle
Revise → submit → idle
planned abandon → idle
awaiting-settle abandon → idle
partial AI failure → failed transcript → /exit dismiss
invalid submit → failed transcript → /cancel dismiss
history / draft
manual scroll / stick-to-bottom
Hub/Session autofocus
resize
Ctrl+C shutdown
```

PTY harness 不允许 import old Core。

---

## 37. Composed full-lifecycle acceptance

最终 TUI-visible scripted lifecycle：

```text
empty
→ Init
→ natural language
→ submit
→ idle
→ Daily
→ submit
→ planned day1
→ Play
→ multi-turn
→ submit
→ awaiting-settle day1
→ Settle
→ idle / lastSettledDay=day1
→ Revise
→ submit
→ idle
→ Daily
→ submit
→ planned day2
```

同时 real Core2 headless suite 必须证明同一 application lifecycle 和 Gate 0 running cancel。

因此 acceptance 不依赖外部 LLM availability。

---

## 38. Official example acceptance

至少验证：

```text
open-world.sh shell syntax green
open-world.bat basic contract checked
launcher 不引用 PROMPTPILE_BIN
launcher 不创建 fake planned World
launcher 传 --llm-config
llm.example.toml 是 caller config
world root 缺失/为空时由 Core2 表达 uninitialized
example README 与实际 command 一致
```

---

## 39. Definition of Done

全部满足才算完成：

1. Gate 0 Core2 interrupt-cancel amendment 已同步回 Core2 Freeze。
2. Core2 `cancel` 在 ready/running 可用，在 submitting 不可用。
3. interrupted `send` 返回 `CANCELLED`，不伪装 agent failure。
4. cancel intent 后不再公开新的 delta。
5. running cancel 不引入 queue/scheduler/manager。
6. Core2 Gate 0 acceptance 与 dedicated CI green。
7. `@dayloom/tui` 不再依赖 `@dayloom/core`。
8. TUI 只消费 `@dayloom/core2` public root。
9. Hub 完整提供 Init/Daily/Revise/Play/Settle/Abandon。
10. legality 只来自 Core capabilities。
11. `daily` 只在 TUI vocabulary 映射到 planning。
12. uninitialized/invalid/published 都有 Hub presentation。
13. TUI 不复制 World state machine。
14. TUI 不复制 Core Session business state machine。
15. 只有 Hub/Session 两页。
16. action order/shortcuts/recommended selection 保持。
17. pending Hub 不造成 topology/selection 闪烁。
18. 四种 Session 使用同一 UI。
19. 每次新 Session 只有一个当前 transcript。
20. opening guidance 是 local system message，不进入 Conversation。
21. user text 只调用一次 `core.send()`。
22. delta 聚合为单条 assistant message。
23. partial output 失败时保留。
24. terminal failure 只保留 presentation failed view，不伪造 Core Session。
25. failed view dismiss 不调用 Core2 cancel。
26. failed recent 不被伪装 cancelled。
27. ready 普通输入/submit/cancel 与 capability 一致。
28. running 保留高优先级 `/exit`/`/cancel`。
29. running 普通文本与 `/submit` 不进入 Core2。
30. running cancel 的 late send result 不可复活 failed page。
31. submitting 输入保持 disabled。
32. slash interception 行为保持。
33. settle/abandon 使用 Hub 短流程 loading。
34. 每个 CoreResult settle 后都以 final `core.getState()` reconcile。
35. WORLD_CONFLICT 显示 refreshed truth。
36. stale async completion 不可污染新 Session。
37. terminal/new/dispose 路径释放 transcript。
38. transcript policy 不截断当前 streaming message。
39. input history/draft/resize/scroll/stick-to-bottom 保持。
40. Hub/Session autofocus 保持。
41. Ctrl+C 走完整 shutdown/dispose。
42. production driver 没有 backend abstraction。
43. test seam 只接受 exact DayloomCore，不进入 production exports。
44. production CLI 不读取 fake backend / PROMPTPILE_BIN override。
45. CLI exact grammar 与 LLM config precedence 已测试。
46. official example 使用 empty World + caller TOML + real Init。
47. example 无 fake Archive publication。
48. clean CI build ordering 为 protocol → core2 → tui。
49. TUI Ubuntu/Windows Node20/22 build/unit green。
50. required Ubuntu PTY 不允许 silent skip。
51. production Core2 startup PTY smoke green。
52. scripted interaction PTY matrix green。
53. composed full lifecycle 到 day2 planned green。
54. architecture guard 阻止 old/deep imports。
55. diagnostics 不记录 secret/full conversation。
56. migration 除 Gate 0 外不修改 Core2 application/persistence semantics。
57. implementation 没有新增 queue/manager/backend framework。

---

## 40. 最终架构 theorem

```text
                           User
                             │
                   restored TUI interaction
                             │
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                      @dayloom/tui                            │
│                                                              │
│ Hub / Session                                                │
│ product vocabulary / shortcuts                              │
│ one presentation transcript                                  │
│ streaming projection / failed transcript                     │
│ pending visual feedback / selection / recent                 │
│ input / history / scroll / focus                             │
│                                                              │
│              no business lifecycle authority                 │
└────────────────────────────┬─────────────────────────────────┘
                             │
                     application semantics
                             │
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                      @dayloom/core2                          │
│                                                              │
│ World truth / capabilities                                   │
│ init / planning / play / revise Sessions                     │
│ send / submit / ready+running cancel                          │
│ settle / abandonDay                                          │
│ publication / Promptpile / React / compression               │
│                                                              │
│                 single application authority                 │
└────────────────────────────┬─────────────────────────────────┘
                             │
                             ▼
                      Published Archive V2
```

最终原则：

```text
完整产品能力不能通过删 TUI 来迁就 Core2。
Core2 没有但属于 application semantic 的能力，先在 Core2 优雅补齐。
TUI 不伪造 Core2 lifecycle。

application fact → Core2
presentation need → TUI
running interrupt → Core2 cancel
failed transcript → TUI presentation only
Hub loading → TUI presentation only
World / Session legality → Core2 only
```

**这就是可直接实施的 TUI → Core2 完整交互适配边界。**