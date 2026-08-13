# Dayloom TUI → Core2 适配实现冻结草案

> Status: Implementation Freeze / 可直接实施  
> Date: 2026-08-13  
> Target package: `@dayloom/tui`  
> Backend target: `@dayloom/core2`

---

## 1. 冻结目标

本次工作不是创建第二套 TUI，也不是为 Core2 增加 TUI compatibility API。

目标只有一个：

```text
保留现有 packages/tui
        ↓
保留现有主要交互逻辑 / layout / components
        ↓
删除对 @dayloom/core runtime shape 的依赖
        ↓
让 TUI 直接消费 @dayloom/core2 application API
```

最终产品交互保持：

```text
Hub
→ 显示当前 World 状态与可用操作
→ 选择 Play
→ 进入 Session
→ 用户输入自然语言
→ AI Final 实时流式显示
→ 多轮继续
→ /submit 或 /exit / /cancel
→ Session 结束
→ 回到 Hub
→ 显示新的 World 状态 / terminal result
```

本次适配只要求**用户可观察交互语义一致**。

不要求：

```text
旧 RuntimeSnapshot shape 一致
旧 RuntimeEvent 一致
旧 RuntimeCommand 一致
旧 MessageStore 一致
旧 command availability 数据结构一致
旧错误码一致
旧内部 driver 实现一致
```

冻结原则：

```text
Core2 提供 application facts。
TUI 将 application facts 投影成 presentation state。
Core2 不知道 TUI 的存在。
```

实施过程中如果需要改变本文冻结的 dependency direction、state authority、message ownership、terminal-result semantics 或 public bootstrap contract，先更新本文，不在代码中临场发明兼容层。

---

## 2. Package 决策冻结

直接修改：

```text
packages/tui
```

不创建：

```text
packages/tui2
```

原因：当前 presentation 仍然是同一套：

```text
BindTTY app / components
Hub 页面
Session 页面
键盘导航
输入历史
滚动逻辑
theme
status/help 展示
诊断日志
slash command UX
```

真正变化的是 backend：

```text
@dayloom/core
        ↓
@dayloom/core2
```

因此这是 backend replacement，不是新的 presentation implementation。

仓库已有 `packages/tui-old` 作为旧 presentation/reference；不再制造第三套 TUI。

---

## 3. Ownership / dependency boundary 冻结

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

禁止新增反向依赖：

```text
@dayloom/core2 → @dayloom/tui
@dayloom/core2 → TuiRuntimeDriver
@dayloom/core2 → TuiDriverState
@dayloom/core2 → TuiMessage
```

禁止创建 legacy Runtime compatibility facade：

```text
Core2
→ Fake DayloomRuntime
→ Fake RuntimeSnapshot
→ Fake RuntimeEvent
→ existing driver
```

禁止创建不存在真实需求的双 backend：

```text
RuntimeBackend
OldCoreBackend
Core2Backend
```

正确方向唯一为：

```text
Core2 CoreState / CoreEvent / CoreResult
                ↓
       TUI-owned projection
                ↓
          TuiDriverState
                ↓
          existing ViewModel
                ↓
          existing components
```

---

## 4. 非目标

本次适配不负责：

```text
新增 Core2 Session kind
为 Core2 实现 init / daily / revise / settle
恢复旧 Core 全部 command 集合
修改 Archive Protocol
修改 Promptpile / React runtime
实现 Compress
修改 TUI 视觉设计
重做键盘系统
重做 input/history/scroll
设计 generic backend provider
同时支持 old core + core2 runtime switch
```

当前产品方向已经选择 Core2；TUI 只消费 Core2 当前真实能力。

---

## 5. 当前旧 Core 耦合面

### 5.1 `runtime-driver/create-runtime-driver.ts`

删除对以下旧 Core runtime 构件的使用：

```text
MessageStore
createArchiveV2Repository
createArchiveV2SessionWorldReadModel
createDayloomRuntime
createNaturalLanguageSessionFactory
createPromptpileConversationClient
DayloomRuntime
RuntimeCommand
RuntimeEvent
RuntimeMessage
RuntimeSnapshot
SessionFactory
```

Driver 改为直接创建：

```ts
createDayloomCore({
  worldRoot,
  llmConfigPath,
})
```

### 5.2 `types.ts`

删除对 legacy Runtime type 的继承/别名。

### 5.3 `hub/actions.ts`

删除 `WorldCommand[]` / `CommandAvailability[]` / old `WorldPhase` projection，改为 Core2 capability projection。

### 5.4 `view-model.ts`

删除对 `snapshot` / `commands` / `RuntimeMessage` 的读取，只消费 TUI-local driver state。

### 5.5 `message-history.ts`

删除 `RuntimeMessage` conversion。若仍保留此文件，只承担 TUI-local message helper；也可以直接并入 driver，避免为了旧结构保留无意义层。

---

## 6. TUI state authority 冻结

TUI 不复制 Core2 lifecycle state machine。

Driver 内部唯一 authority 集合：

```text
latestCoreState
hubMode
selectedHubActionId
recent
当前 Session 的 presentation messages
当前 streaming assistant message id（如需要）
```

以下全部是**派生值**，不得作为第二套 lifecycle authority 独立维护：

```text
page
Hub Play availability
session controls
loadingLabel
inputEnabled
inputControlEnabled
```

特别禁止重新引入独立：

```text
loading
TuiBusyState
legacy RuntimeSnapshot
legacy command availability cache
```

---

## 7. TUI-local presentation types 冻结

```ts
export type HubMode = 'status' | 'help';

export type TuiSessionStatus =
  | 'ready'
  | 'running'
  | 'submitting';

export interface TuiWorldState {
  worldRoot: string;
  worldId: string;
  title: string;
  revision: number;
  commitId: string;
  phase: 'idle' | 'planned' | 'awaiting-settle';
  day: string | null;
  lastSettledDay: string | null;
}

export interface TuiSessionState {
  id: string;
  kind: 'play';
  status: TuiSessionStatus;
}

export type TuiPage =
  | { kind: 'hub'; mode: HubMode }
  | { kind: 'session'; sessionId: string; sessionKind: 'play' };

export interface TuiSessionControls {
  input: boolean;
  submit: boolean;
  cancel: boolean;
}

export interface TuiMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  status?: 'streaming' | 'complete' | 'error';
}

export interface TuiRecentResult {
  kind: 'completed' | 'cancelled' | 'failed';
  label: string;
  detail: string | null;
}

export interface TuiDriverState {
  page: TuiPage;
  world: TuiWorldState;
  session: TuiSessionState | null;
  sessionControls: TuiSessionControls;
  hubActions: TuiHubAction[];
  selectedHubActionId: string | null;
  recent: TuiRecentResult | null;
  messages: TuiMessage[];
}
```

这些是 TUI presentation contract，不是 Core2 API 镜像。

### 7.1 Projection source

```text
CoreState.world
→ TuiWorldState

CoreState.session
→ TuiSessionState

CoreState.capabilities.startSessions
→ Hub Play action

CoreState.capabilities.send
→ sessionControls.input

CoreState.capabilities.submit
→ sessionControls.submit

CoreState.capabilities.cancel
→ sessionControls.cancel
```

`sessionControls` 每次由最新 `CoreState.capabilities` 重新投影，不独立变更。

这样即使 Core2 在 mutation begin 时出现：

```text
session.status == ready
但 capability.send == false
```

TUI 也不会错误地继续开放输入。

---

## 8. Page projection 冻结

`page.kind` 不是独立状态机。

唯一规则：

```text
latestCoreState.session == null
→ page = { kind: 'hub', mode: hubMode }

latestCoreState.session != null
→ page = {
    kind: 'session',
    sessionId,
    sessionKind: 'play'
  }
```

Driver 不保存一个可以与 Core session 相矛盾的 `page` authority。

当观察到：

```text
previous Core session != null
current Core session == null
```

TUI-local：

```text
hubMode = 'status'
```

之后 `page` 自然派生为 Hub(status)。

适用于：

```text
submit success
cancel success
send terminal failure
submit terminal failure
```

---

## 9. `TuiRuntimeDriver` 冻结

现有 interface 保留为 TUI internal presentation seam：

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

它不是：

```text
Core2 adapter contract
generic backend contract
```

Core2 永远不实现或 import 此 interface。

---

## 10. Driver 创建 / test seam 冻结

生产创建：

```ts
export interface CreateRuntimeDriverOptions {
  worldRoot: string;
  llmConfigPath: string;
  diagnostic?: DiagnosticLogger;
}
```

生产路径：

```ts
createDayloomCore({
  worldRoot,
  llmConfigPath,
})
```

删除旧注入：

```text
runtime?: DayloomRuntime
sessionFactory?: SessionFactory
```

如果测试需要 seam，只允许 module-private/internal test entry 注入一个已经创建好的 `DayloomCore` 或窄 factory function；不得把 backend abstraction 暴露成 package public API。

---

## 11. TUI CLI / LLM config 冻结

增加：

```text
dayloom-tui [worldRoot] --llm-config <path>
```

解析：

```text
--llm-config
→ else DAYLOOM_LLM_CONFIG
→ else startup error with clear usage
```

然后：

```ts
createRuntimeDriver({
  worldRoot,
  llmConfigPath,
  diagnostic,
})
```

TUI 不重新生成 provider TOML，也不复制旧配置入口：

```text
DAYLOOM_LLM_API_NAME
DAYLOOM_LLM_MODEL
DAYLOOM_LLM_BASE_URL
...
```

配置内容 authority 仍由 Core2 caller-config guard 负责。

---

## 12. Hub projection 冻结

### 12.1 Local actions

始终由 TUI 拥有：

```text
status
help
quit
```

### 12.2 Core application action

Core2 MVP 当前只有：

```text
play
```

唯一显示规则：

```text
if latestCoreState.capabilities.startSessions includes 'play'
→ show Play
else
→ do not show Play
```

执行：

```text
Play action
→ core.startSession('play')
```

禁止为了旧菜单伪造：

```text
init
daily
revise
settle
abandon-day
```

交互模式保持一致，不意味着业务 capability 数量与旧 Core 一致。

---

## 13. Core event consumption 冻结

Driver 只消费 Core2 两类 public event：

```text
state.changed
output.delta
```

### 13.1 `state.changed`

```text
replace latestCoreState
→ if Session transitioned non-null → null: hubMode = status
→ recompute all derived TuiDriverState
→ emit TUI state
```

不得从 `state.changed` 推断 operation success/failure，也不得生成 `recent`。

`recent` 的 authority 是调用对应 Core mutation 返回的 `CoreResult`。

### 13.2 `output.delta`

只对当前 active Session 投影：

```text
event.sessionId == latestCoreState.session?.id
→ consume

otherwise
→ ignore + optional diagnostic
```

TUI 不读取 Promptpile/React raw events。

---

## 14. Message ownership 冻结

```text
Promptpile Conversation
= AI interaction history authority

TUI messages
= 当前进程、当前 Session 的 presentation transcript
```

TUI 不读取 Promptpile artifact，不从 Conversation 重建 UI transcript，不持久化 TUI transcript 为 World truth。

最小模型：

```text
user message
assistant streaming message
local system/error message
```

不创建 generic message framework。

### 14.1 Session start

Play Session 成功创建后，为该 Session 开始新的 presentation transcript。

上一 Session transcript 不进入新 Session，也不承担持久历史职责。

### 14.2 User input

普通文本：

```text
trim
→ reject empty locally
→ require sessionControls.input == true
→ append local user message
→ core.send(text)
```

用户消息只是 UI projection；真正 AI Conversation artifact 仍由 Core2/Promptpile append。

### 14.3 Assistant streaming

普通 send run：

```text
first matching output.delta
→ create one assistant message(status=streaming)

next matching output.delta
→ append text to same streaming assistant message

core.send() success
→ mark that assistant message complete
→ clear streaming assistant pointer
```

由于 Core2 不支持并发，TUI 不创建 pending-turn map / turn scheduler。

如果一次成功 send 没有 delta，则不要求制造空 assistant bubble。

### 14.4 Non-terminal operation failure

如果 CoreResult failure 后 Core Session 仍存在：

```text
Session page remains
→ append local system/error message
```

适用于 legality/input 类错误或其它未终止 Session 的失败。

### 14.5 Terminal operation failure

如果 CoreResult failure 后 Core Session 已经为 null：

```text
page 已由 CoreState 派生回 Hub
→ recent = {
    kind: 'failed',
    label: operation-specific failure label,
    detail: error.message
  }
```

**Hub `recent.failed` 是 terminal failure 的唯一用户可见 error authority。**

不得在已经终止的 Session transcript 上再追加 error message，也不得为了展示错误人为保持 Session page。

如果 terminal send failure 前已经显示过 partial assistant delta：

```text
允许该 partial transcript 作为已结束 Session 的临时 presentation 数据存在，
但进入 Hub 后不再承担错误展示职责；下一 Session 开始时清空。
```

不增加 failed-session recovery UI。

---

## 15. Operation result projection 冻结

### 15.1 Start Play

```text
core.startSession('play') success
→ Core state 决定进入 Session page
→ clear stale recent if desired only when operation succeeds

failure with no Session
→ remain Hub
→ recent.failed
```

### 15.2 Send

```text
core.send(text) success
→ complete streaming assistant message
→ remain Session ready

failure + Session remains
→ local Session error

failure + Session null
→ Hub + recent.failed
```

### 15.3 Submit

Core2 不公开 submission JSON `output.delta`，TUI 不需要过滤机器 JSON。

```text
core.submit() success
→ Core state contains refreshed World + no Session
→ Hub(status)
→ recent = completed / 会话已提交

core.submit() failure + Session null
→ Hub(status)
→ recent.failed / 提交失败
```

### 15.4 Cancel

```text
core.cancel() success
→ no Session
→ Hub(status)
→ recent = cancelled / 会话已取消
```

如果 cancel 返回 failure 且 Session 仍存在，则保留 Session 并显示 local error。

---

## 16. `recent` authority / event ordering 冻结

Core2 的 `state.changed` 与 mutation Promise completion 是不同时间线。

因此 TUI 必须允许：

```text
state.changed(session = null)
→ Hub 已经出现
→ mutation Promise 稍后返回 failure/success
→ recent 再更新
```

这是合法时序，不需要 event queue、terminal-session abstraction 或延迟 page transition。

冻结规则：

```text
CoreState
→ 决定 World / Session / page / controls

CoreResult
→ 决定对应用户动作的 recent outcome
```

二者不得互相冒充 authority。

---

## 17. Loading / input semantics 冻结

不保留 `loading` 字段。

`loadingLabel` 完全由 Session status 派生：

```text
session == null
→ null

ready
→ null

running
→ 'AI 正在回复...'

submitting
→ '正在提交会话...'
```

输入 legality 不从 status 猜测，而从 `sessionControls`：

```text
inputEnabled
= page.kind == session && sessionControls.input

inputControlEnabled
= page.kind == session
  && (sessionControls.input || sessionControls.submit || sessionControls.cancel)
```

因此 mutation-in-flight 时，即便有短暂 `status == ready`，只要 Core capability 已关闭，TUI 就不会继续接受输入。

UI hint 同样从 `sessionControls` + `session.status` 投影，不得承诺 Core2 当前不允许的 cancel/submit。

---

## 18. Slash command 冻结

Session 中继续识别：

```text
/submit
/exit
/cancel
/status
/help
/next
/revise
```

行为：

```text
/submit
→ if sessionControls.submit then core.submit()
→ else local warning

/exit / /cancel
→ if sessionControls.cancel then core.cancel()
→ else local warning

/status / /help
→ local提示：先退出 Session 回 Hub

/next
→ local warning，TUI 不提供该命令

/revise
→ local warning；未来只有 Core2 真正提供对应 capability 后才重新评估
```

slash command string 永不传入 Core2。

running/submitting 时 Core2 当前不允许 cancel，因此 TUI textarea/control 也不得暗示 `/exit` 可执行。

---

## 19. Hub content / status / help 冻结

`hub/content.ts` 不再接收：

```text
RuntimeSnapshot
CommandAvailability[]
```

只接收 TUI-local：

```text
TuiWorldState
TuiHubAction[]
TuiRecentResult
```

Status 至少显示：

```text
world title / id
revision
day
phase
lastSettledDay
current available actions
recent result
```

Help 只列出当前实际存在的 action 与本地导航说明。

不展示不存在的 Core2 commands。

---

## 20. Theme / labels 冻结

`theme.ts` 不再 import old Core unions。

本地 label 输入：

```text
TuiWorldState.phase
TuiSessionStatus
'play'
```

视觉 label 保留当前风格：

```text
planned         → 已规划
awaiting-settle → 待结算
play            → 游玩
ready           → 等待输入
running         → AI 正在回复
submitting      → 正在提交
```

Core2 不提供中文 label。

---

## 21. Diagnostics 冻结

Diagnostics 属于 TUI。

记录：

```text
driver-created
core-event
hub-action
hub-action-result
session-input-submit
session-input-result
local-message-added
driver-dispose-begin/end
```

核心字段：

```text
world revision / phase
session id / kind / status
CoreResult ok/error.code
CoreEvent type
derived page
```

不重构 legacy RuntimeEvent diagnostics shape。

---

## 22. `view-model.ts` 适配冻结

保留：

```text
signals
page switching
input history
scroll state
selection logic
textarea reset
mount/dispose behavior
```

替换：

```text
snapshot.world      → state.world
snapshot.session    → state.session
commands            → state.hubActions
RuntimeMessage      → TuiMessage
```

ViewModel 不直接 import Core2。

计算：

```text
loadingLabel
→ state.session?.status

inputEnabled
→ state.sessionControls.input

inputControlEnabled
→ any legal session control
```

不模拟 legacy status，也不保留独立 loading state。

---

## 23. Components 冻结

`app.tsx` 与 `components/*` 默认不改结构。

只允许因 TUI-local type/property rename 产生的机械调整。

如果 Core2 backend replacement 导致 component tree 大规模修改，应停止并检查 driver/view-model 是否泄漏 backend semantics。

目标：

```text
backend replacement
≈ driver + projection change
```

而不是：

```text
backend replacement
→ presentation rewrite
```

---

## 24. Package / architecture guard 冻结

`packages/tui/package.json`：

```diff
- "@dayloom/core": "*"
+ "@dayloom/core2": "*"
```

TUI source 最终不得 import：

```text
@dayloom/core
@dayloom/core-old
```

增加简单 architecture guard/test：

```text
packages/tui/src/**
→ reject @dayloom/core / @dayloom/core-old imports
```

无需跨 package architecture framework。

---

## 25. 实施顺序冻结

### Step 0 — dependency / argv

```text
switch package dependency to @dayloom/core2
add --llm-config / DAYLOOM_LLM_CONFIG resolution
wire main.ts → createRuntimeDriver
```

### Step 1 — local presentation types

```text
remove @dayloom/core imports from types.ts
introduce TuiWorldState / TuiSessionState / TuiSessionControls / TuiMessage
remove TuiBusyState / loading
remove RuntimeSnapshot / CommandAvailability / WorldCommand aliases
```

### Step 2 — Hub projection

```text
rewrite hub/actions.ts from Core2 capabilities
keep local status/help/quit
show Play only when Core2 exposes play capability
```

### Step 3 — runtime driver

```text
createDayloomCore
subscribe CoreEvent
hold latestCoreState only
derive page / controls / Hub actions
startSession/send/submit/cancel mapping
local transcript projection
CoreResult → recent
```

### Step 4 — view-model

```text
replace snapshot/commands reads with local driver state
derive loading from ready/running/submitting
use sessionControls for legality
keep navigation/history/scroll behavior
```

### Step 5 — content/theme/diagnostics

```text
remove remaining legacy Core types
update status/help content
update labels
update diagnostics projection
```

### Step 6 — tests / guards

```text
interaction-equivalent Play lifecycle
streaming temporal behavior
terminal result ordering
slash commands
Hub projection
dispose
legacy import guard
```

完成 Step 6 即完成现有 `packages/tui` 的 Core2 backend replacement。

---

## 26. Acceptance tests 冻结

至少覆盖：

```text
tui-no-longer-depends-on-dayloom-core
tui-source-rejects-legacy-core-imports

tui-argv-requires-or-resolves-llm-config
tui-driver-creates-core2-with-world-and-llm-config

tui-hub-shows-play-iff-core2-capability-allows-play
tui-hub-keeps-status-help-quit-local
tui-does-not-show-unsupported-legacy-world-commands

tui-page-is-derived-from-core2-session-and-hub-mode
tui-driver-has-no-independent-loading-authority
tui-session-controls-project-core2-capabilities

tui-start-play-enters-session-page
tui-start-play-failure-remains-hub-and-sets-recent-failed

tui-user-text-is-projected-locally-and-sent-to-core2
tui-output-delta-updates-one-streaming-assistant-message-before-send-resolves
tui-send-success-completes-assistant-message
tui-send-terminal-failure-returns-to-hub-with-recent-failed
tui-send-nonterminal-failure-stays-in-session-with-local-error

tui-submit-does-not-display-submission-json
tui-submit-success-returns-to-hub-with-completed-recent-result
tui-submit-terminal-failure-returns-to-hub-with-failed-recent-result
tui-cancel-success-returns-to-hub-with-cancelled-recent-result

tui-core-state-may-return-to-hub-before-result-without-losing-terminal-recent
tui-recent-is-driven-by-core-result-not-core-event

tui-input-enabled-only-when-core2-send-capability-is-true
tui-running-shows-ai-loading-label-derived-from-status
tui-submitting-shows-submit-loading-label-derived-from-status
tui-running-and-submitting-do-not-advertise-cancel

tui-submit-slash-command-calls-core2-submit-only-when-legal
tui-exit-and-cancel-slash-command-call-core2-cancel-only-when-legal
tui-status-help-next-revise-remain-local-presentation-behavior

tui-view-model-keeps-input-history-and-scroll-behavior
tui-dispose-unsubscribes-and-disposes-core2
```

测试重点是**用户可观察交互语义与 authority 边界**，不是 legacy Runtime payload compatibility。

---

## 27. Definition of Done

同时满足：

1. `packages/tui` 直接依赖 `@dayloom/core2`，不依赖 `@dayloom/core`；
2. 不创建 `packages/tui2`；
3. 不创建 old/core2 双 backend abstraction；
4. Core2 不增加任何 TUI-specific API；
5. TUI presentation types 不继承 legacy Runtime types；
6. Driver 内唯一 Core lifecycle authority 是 latest `CoreState`；
7. `page` 由 Core Session + `hubMode` 派生，不独立维护；
8. 不存在独立 `loading` / `TuiBusyState` lifecycle truth；
9. Hub Play action 从 Core2 start-session capability 投影；
10. Session input/submit/cancel legality 从 Core2 capabilities 投影；
11. 不伪造 Core2 尚未支持的 legacy command；
12. Play 保持 Hub → Session → multi-turn → submit/cancel → Hub 的用户交互；
13. `output.delta` 在 UI 中实时显示；
14. submit machine JSON 永不展示；
15. transcript/message lifecycle 完全由 TUI presentation 层拥有；
16. Promptpile Conversation 仍由 Core2/Promptpile 拥有，TUI 不读取其 artifact；
17. terminal operation failure 通过 Hub `recent.failed` 呈现，不人为保留失败 Session；
18. non-terminal failure 才使用 Session-local error message；
19. `CoreState` 决定 lifecycle/page，`CoreResult` 决定对应用户动作的 recent outcome；
20. loading label 从 Core Session status 派生；
21. input legality 从 projected Core capabilities 决定，而不是仅凭 status 猜测；
22. components/layout/input history/scroll 行为尽可能保持不变；
23. CLI 显式解决 `llmConfigPath`，不复制 provider config policy；
24. tests 验证 interaction semantics 与 authority，不验证 legacy Runtime compatibility；
25. TUI source 不再 import legacy Core。

---

## 28. 边界判断规则

适配过程中，如果想给 Core2 增加字段，先问：

```text
如果 consumer 是 Web / GUI / test harness，
这个字段仍然是自然的 Dayloom application fact 吗？
```

如果答案是否定的，例如：

```text
page
selectedAction
shortcut
loadingLabel
messageId
hubMode
inputHint
recentResult
```

它必须留在 TUI。

如果缺失的是：

```text
当前 World 状态
Session 是否存在
Session 当前业务状态
某 operation 是否合法
operation result
user-visible Final delta
```

才属于 Core2 application boundary 的潜在问题。

本次适配默认当前 Core2 Freeze 已足够，不主动修改 Core2。

---

## 29. 最终结构 / 闭环

```text
                    @dayloom/core2
                           │
                 CoreState / CoreEvent
                           │
                           ▼
                TuiRuntimeDriver
                   │        │
            state facts   CoreResult
                   │        │
                   │        └──→ recent outcome
                   │
                   ├──→ derived page / controls / Hub actions
                   └──→ output.delta → presentation messages
                           │
                           ▼
                    TuiDriverState
                           │
                           ▼
                       ViewModel
                           │
                           ▼
                existing BindTTY components
```

最终 ownership：

```text
Core2 owns application semantics and legality.
Core2 CoreState owns World / Session lifecycle truth.
Core2 CoreResult owns mutation outcome truth.
TUI owns presentation projection and ephemeral transcript.
Consumers/components own rendering only.
```

最终原则：

```text
TUI adapts to Core2.
Core2 does not adapt to TUI.

No fake Runtime.
No dual backend.
No second page state machine.
No second loading state machine.
No duplicated Conversation authority.
```

本次工作的成功标准不是“让 Core2 看起来像旧 Runtime”，而是：

```text
在不复刻旧 Runtime API 的情况下，
现有 TUI 仍然自然完成同一套用户交互，
且每个 lifecycle / legality / result / presentation fact 只有一个 authority。
```
