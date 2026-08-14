# TUI2 Design Direction

> 状态：已实现并通过 Core driver 与真实 PTY 流程验收  
> 范围：`@dayloom/tui` 使用 core 作为底座时，如何继承现有 TUI 交互体验  
> 原则：tui 的用户体验参考现有 tui；只有流程流转和可用指令以 core 为准。

> 现行使用文档见 [TUI 使用指南](../../doc/guide/TUI.md)，维护文档见 [TUI 包文档](../../doc/packages/TUI.md)。

## 1. 核心定位

tui 不是重新设计一套终端交互，也不是把 core 的底层 command 直接暴露给用户。

tui 的定位是：

```text
tui = 现有 tui 的交互体验 + core 的状态/流程底座
```

也就是说：

- 用户怎么进入页面、怎么输入、怎么看消息，整体参考现有 tui。
- 页面结构、输入模式、消息展示、loading、焦点、快捷操作，整体参考现有 tui。
- 底层不再使用旧 `SessionIO` 和旧 core 文本循环，改为使用 core runtime。
- 流程是否可进入、当前处于什么状态、哪些业务指令可用，以 core 为准。

## 2. 保持现有 TUI 的交互模式

tui 仍然是两个核心页面：

- Hub 页
- Session 页

### Hub 页

Hub 页是入口页，职责参考现有 tui：

- 展示当前 world 状态。
- 展示帮助内容。
- 展示可选流程。
- 让用户选择要进入的流程。
- 执行不需要对话页的短流程，例如结算。

Hub 页结构参考现有 tui：

```text
Header
MessageList
LoadingBar
HubSelect
Footer
```

Hub 页下方是选择框，不是文本输入框。

Hub 的消息区仍然分为状态和帮助两种内容：

- status：当前 world、day、phase、最近结果、可用动作。
- help：当前页面操作说明、会话页输入说明、不可用指令说明。

`status` 和 `help` 是 tui 本地 UI mode，不是 core command：

- 切到 `status` 只更新 Hub MessageList 内容，不调用 core。
- 切到 `help` 只更新 Hub MessageList 内容，不调用 core。
- HubSelect 中可以保留“状态”和“帮助”两个本地动作。
- 也可以保留快捷键，例如 `s` 切状态、`?` 切帮助。
- 本地动作和 core 业务动作在展示上同处 HubSelect，但执行路径不同。

HubSelect 的动作来源分两类：

- 本地动作：`status`、`help`、`quit`。
- core 动作：`init`、`daily`、`play`、`revise`、`settle`、`abandon-day`。

### Session 页

Session 页是对话页，职责参考现有 tui：

- 展示用户输入。
- 展示 AI / 系统 / 错误消息。
- 展示流式回复。
- 展示 loading。
- 提供一个文本输入框。
- 处理会话内 slash 指令。

Session 页结构参考现有 tui：

```text
Header
MessageList
LoadingBar
TextInput
Footer
```

Session 页的核心体验保持不变：

- 用户输入自然语言。
- 用户不需要理解 core 的内部 command。
- 用户通过 `/submit` 提交当前 Session 产物。
- 用户不手写 JSON。
- 不新增 F2 submit 之类新的提交模式。

## 3. 文本输入与 slash 指令

tui 的 Session 页仍然以文本输入为中心。

输入规则参考现有 tui：

- 普通文本：作为会话输入提交给底层。
- `/submit`：提交当前 Session 产物，交给 core Runtime 执行 `submit`。
- `/exit` 或等价取消指令：退出当前 Session，回 Hub。
- `/status`、`/help`、`/next`、`/revise` 等 Hub 指令：在 Session 页拦截，并提示用户先回 Hub。
- 未识别 slash 指令：展示提示，不直接传给底层业务。

这里的重点是：Session 页不变成 command 面板。

现阶段保留 `/status` 与 `/help` 的识别能力，但不在 Session 页直接展示 status/help：

- `/status`：追加一条提示消息，说明当前正在会话中，请先 `/exit` 回 Hub 再查看状态。
- `/help`：追加一条提示消息，说明当前正在会话中，请先 `/exit` 回 Hub 再查看帮助。
- 不切换到 Hub。
- 不打开 overlay。
- 不调用 core。
- 不打断 active Session 的输入上下文。

未来如果确实需要在 Session 中临时查看状态/帮助，可以单独设计只读 overlay；第一版不做。

`submit` 是明确的 Session 控制指令。tui 只负责把用户输入的 `/submit` 转换为 core Runtime command，不在 assistant 回复结束后自动 submit。

## 4. 底层驱动替换

现有 tui 的底层大致是：

```text
tui
  Hub / Session UI
  ViewModel
  SessionIO
  old core shell loop
```

tui 的底层改为：

```text
tui
  Hub / Session UI
  ViewModel
  core runtime driver
  core runtime
```

替换点：

- 旧 tui 通过 `SessionIO.write/readInput/confirm/withLoading` 和旧 core 交互。
- tui 通过 core 的 snapshot、commands、events 和 input/command API 交互。
- 旧 tui 从文本输出里整理消息。
- tui 从 core 语义事件里整理消息。
- 旧 tui 依赖旧 `next` 推断流程。
- tui 依赖 core 的 world phase 和 available commands。

## 5. core 负责的部分

core 是流程和状态底座，负责：

- world 当前 phase。
- 当前 day。
- 当前是否存在 active Session。
- 当前 Session 的状态。
- 哪些业务 command 可用。
- 接收自然语言输入。
- 发出语义事件。
- 发出流式 assistant message 事件。
- 执行 `init / daily / play / revise / settle / abandon-day / cancel` 等流程流转。

tui 不重新判断业务状态，只做 UI 投影。

## 6. tui 负责的部分

tui 是 UI driver，负责：

- 根据 core snapshot 渲染 Hub / Session。
- 根据 core available commands 渲染 Hub 可选流程。
- 在 Hub 中维护本地 `status/help` mode。
- 根据 core events 更新消息、loading、错误、页面。
- 将用户自然语言输入提交给 core。
- 将用户在 Hub 选择的流程转换成 core command。
- 在 Session 页拦截不该出现的 Hub 指令。
- 维护焦点、滚动、布局、Footer 提示。
- 保持现有 TUI 的使用习惯。

tui 不负责：

- 解析旧 CLI 输出。
- 伪造 core 没有的业务流程。
- 让用户直接操作 core 内部生命周期 command。
- 重新实现 world 状态机。

## 7. 流程差异

tui 与现有 tui 的差异主要来自 core 流程模型。

Hub 上的可选流程来自 core：

- `init`：进入初始化 Session。
- `daily`：进入当日计划 Session。
- `play`：进入行动 Session。
- `revise`：进入修订 Session。
- `settle`：在 Hub 中执行短 loading，不进入 Session。
- `abandon-day`：在 Hub 中执行，完成后刷新状态。

Session 结束后回 Hub。

Session 取消后回到 core 定义的上一业务边界。

settle 后进入下一天 idle。

abandon-day 后回到前一天 idle。

这些流程差异不改变 TUI 的基本使用方式，只改变 Hub 中展示哪些可选流程，以及流程完成后回到哪个状态。

## 8. 消息与流式输出

消息展示参考现有 tui 的视觉效果，但数据来源改变。

现有 tui 中，消息来自旧 core 写入的文本和 stream。

tui 中，消息来自 core runtime events：

- user message
- system message
- error message
- assistant message start
- assistant message delta
- assistant message end
- assistant message error

assistant 流式回复必须聚合成同一条消息，而不是每个 chunk 一行。

MessageList 仍然负责视觉换行、滚动、stick-to-bottom 和长文本显示。

## 9. 设计边界

第一版不改变这些交互习惯：

- 不让用户手写 JSON。
- 不新增手动 submit 快捷键。
- 提交统一使用文本指令 `/submit`。
- 不把 Session 页改成 command select。
- 不在 Session 页展示 status/help。
- 不在 Session 页为 status/help 做 overlay。
- 不提供 TUI 级 next。
- 不恢复旧 `SessionIO`。

第一版允许变化：

- Hub 的可选项从 core commands 来。
- 旧 `next` 入口改成明确流程项。
- settle 留在 Hub 做 loading。
- 开发骨架阶段允许用 fake Session 验证 UI，但正式默认路径必须使用 core 自然语言业务 Session，不能伪造业务完成。

## 10. 页面状态结构

tui 的页面状态继续参考现有 tui，但数据字段改成 core 投影。

```ts
/** 当前 TUI 页面。 */
export type TuiPage =
  /** Hub 入口页。 */
  | {
      kind: 'hub';
      mode: 'status' | 'help';
      busy: TuiBusyState | null;
    }
  /** Session 对话页。 */
  | {
      kind: 'session';
      sessionId: string;
      sessionKind: SessionKind;
    };

/** Hub 或 Session 上方 loading 区域的任务态。 */
export interface TuiBusyState {
  /** 机器可读任务名。 */
  operation: string;
  /** 可展示 loading 文案。 */
  label: string;
}
```

Hub 相关状态：

```ts
/** Hub 页状态内容。 */
export interface TuiHubStatus {
  /** world 根目录。 */
  worldRoot: string;
  /** 当前 world phase。 */
  phase: WorldPhase;
  /** 当前 day；没有时为 null。 */
  day: string | null;
  /** world 是否已初始化。 */
  initialized: boolean;
  /** invalid 原因；非 invalid 时为 null。 */
  invalidReason: string | null;
  /** 当前 Hub 可展示动作。 */
  actions: TuiHubAction[];
  /** 最近一次输入或流程结果。 */
  recent: TuiRecentResult | null;
}

/** 最近一次流程结果，用于 Hub status。 */
export interface TuiRecentResult {
  /** 结果类别。 */
  kind: 'completed' | 'cancelled' | 'failed';
  /** 简短标题。 */
  label: string;
  /** 详细错误或说明。 */
  detail: string | null;
}
```

Session 相关状态：

```ts
/** Session 页投影状态。 */
export interface TuiSessionView {
  /** active session id。 */
  sessionId: string;
  /** active session 类型。 */
  sessionKind: SessionKind;
  /** core session status。 */
  status: SessionStatus;
  /** 当前输入是否可用。 */
  inputEnabled: boolean;
  /** 输入框提示文本。 */
  inputPrompt: string;
  /** 当前 loading 文案。 */
  loading: TuiBusyState | null;
  /** 当前错误。 */
  error: RuntimeError | null;
  /** 当前 session 消息列表。 */
  messages: RuntimeMessage[];
}
```

这些类型只是 tui 的展示投影，不替代 core 的 `RuntimeSnapshot`。

## 11. Runtime Driver 设计

tui 应有一个 driver 层，隔离 UI signals 和 core runtime。

```text
components
  -> view-model signals
  -> tui runtime driver
  -> core runtime
```

driver 对外提供：

```ts
/** tui 操作 core 的驱动层。 */
export interface TuiRuntimeDriver {
  /** 读取当前展示状态。 */
  getState(): TuiDriverState;

  /** 订阅展示状态变化。 */
  subscribe(listener: (state: TuiDriverState) => void): () => void;

  /** Hub 页选择某个动作。 */
  runHubAction(actionId: string): Promise<void>;

  /** Session 页提交文本输入。 */
  submitSessionText(text: string): Promise<void>;

  /** 切换 Hub 的 status/help。 */
  setHubMode(mode: 'status' | 'help'): void;

  /** 释放 core runtime 和订阅。 */
  dispose(): Promise<void>;
}
```

driver 内部持有：

- `createDayloomRuntime()` 返回的 `DayloomRuntime`
- `MessageStore`
- 最新 `RuntimeSnapshot`
- 最新 `CommandAvailability[]`
- 当前 `TuiPage`
- 当前 Hub actions
- 当前最近结果
- 当前 operation id

组件层不直接调用 `runtime.executeCommand()` 或 `runtime.sendInput()`。组件只调用 view-model，view-model 再调用 driver。

## 12. 启动入口与参数

tui 第一版提供独立 bin：

```text
dayloom-tui [worldRoot]
```

参数规则：

- `worldRoot` 是可选位置参数。
- 未传 `worldRoot` 时，默认使用当前工作目录。
- 路径在启动时解析成绝对路径。
- 第一版不复用旧 tui 的 `--lang` 等参数；后续需要本地化时再补。
- 第一版不提供 `next`、`status`、`help` 这类 CLI 参数；这些只属于运行后的 TUI 内部交互。

启动流程：

```text
parse argv
  -> resolve worldRoot
  -> create core runtime driver
  -> create view-model
  -> mount bindtty app
  -> render Hub status
```

Runtime 创建策略：

- UI 骨架阶段可以使用 fake driver。
- driver 通过异步 `createDayloomRuntime()` 创建 Runtime。
- Runtime 的 `sessionFactory` 由 core 自然语言 Session 提供，并通过 Archive read model 读取上下文。
- 正式路径使用 core 自然语言 Session；core-native JSON Session 只保留给底层测试。

## 13. Hub Action 投影

Hub 仍是选择流程的地方，但动作来源从旧 `next` 改成 core command availability。

Hub action 分为本地 UI action 和 core world action：

```ts
/** Hub 中可以选择的动作。 */
export type TuiHubAction =
  /** 只改变 tui 页面 mode，不进入 core。 */
  | TuiLocalHubAction
  /** 执行 core world command。 */
  | TuiCoreHubAction;

/** Hub 本地动作。 */
export interface TuiLocalHubAction {
  /** 本地动作 id。 */
  id: 'status' | 'help' | 'quit';
  /** 动作类别。 */
  kind: 'local';
  /** 展示标签。 */
  label: string;
  /** 展示说明。 */
  summary: string;
  /** 快捷键，只属于 TUI。 */
  shortcut: string | null;
  /** 是否推荐默认选中。 */
  recommended: boolean;
}

/** Hub 中映射到 core world command 的动作。 */
export interface TuiCoreHubAction {
  /** 唯一 id，通常等于 command。 */
  id: string;
  /** 动作类别。 */
  kind: 'core-command';
  /** 对应 core command。 */
  command: WorldCommand;
  /** 展示标签。 */
  label: string;
  /** 展示说明。 */
  summary: string;
  /** 快捷键，只属于 TUI。 */
  shortcut: string | null;
  /** 是否推荐默认选中。 */
  recommended: boolean;
}
```

投影规则：

- 从 `runtime.getAvailableCommands()` 读取所有 command。
- Hub 只把 world command 投影成 core 动作。
- `status/help/quit` 始终是本地动作，不来自 core。
- 默认只把 enabled world command 放进 HubSelect。
- disabled command 不进入 HubSelect，但可以在 status/help 中展示原因。
- `submit/cancel` 不作为 Hub action。

HubSelect 排序规则：

1. 推荐 core 业务动作。
2. 其它 enabled core 业务动作。
3. 本地 `status`。
4. 本地 `help`。
5. 本地 `quit`。

补充规则：

- 同一组内保持固定顺序，避免刷新后选项跳动。
- 危险/破坏性动作如 `abandon-day` 放在同组末尾。
- 当前 Hub mode 对应的本地动作可以保留显示，但不设为推荐项。
- 当没有可用 core 业务动作时，默认选中 `status`。
- 当前选中项在刷新后仍存在则保持选中；不存在时选中推荐项；没有推荐项时选中第一项。

推荐项规则：

- `uninitialized`：推荐 `init`。
- `idle`：推荐 `daily`，`revise` 作为次要项。
- `planned`：推荐 `play`，`abandon-day` 作为危险/次要项。
- `awaiting-settle`：推荐 `settle`，`abandon-day` 作为危险/次要项。
- `invalid`：没有业务 action，只显示状态和退出。

Hub 按 world 状态按需显示可用动作：

| world phase | HubSelect 显示的 core 动作 | 本地动作 | 说明 |
|---|---|---|---|
| `uninitialized` | `init` | `status`、`help`、`quit` | 只能进入初始化流程。 |
| `idle` | `daily`、`revise` | `status`、`help`、`quit` | 已在稳定边界，可开始新一天或修订 world。 |
| `planned` | `play`、`abandon-day` | `status`、`help`、`quit` | 已有当日计划，可进入行动或放弃当日。 |
| `awaiting-settle` | `settle`、`abandon-day` | `status`、`help`、`quit` | 行动结束，结算留在 Hub loading 中执行。 |
| `initializing`、`planning`、`playing`、`revising` | 无 | 无 | 这些状态应处在 Session 页，不显示 HubSelect。 |
| `invalid` | 无 | `status`、`help`、`quit` | 只展示错误状态和帮助，不提供业务动作。 |

实际实现不硬编码这张表的业务可用性，而是以 `runtime.getAvailableCommands()` 为准。表格只规定 tui 对不同 phase 的展示策略。

执行规则：

- `status/help` 只切换 Hub mode。
- `quit` 只退出 TUI 应用。
- `init/daily/play/revise` 成功后进入 Session 页。
- `settle` 在 Hub 内展示 loading，完成后刷新 status。
- `abandon-day` 在 Hub 内执行，完成后刷新 status。
- command rejected/failed 留在 Hub，并展示错误。

## 14. Session 输入解析

Session 页的输入规则必须参考现有 tui。

处理顺序：

1. 用户在 TextInput 输入文本。
2. tui driver trim 输入。
3. 空输入按当前输入策略处理，第一版可忽略或提示，不进入 core。
4. `/` 开头的输入先按 tui slash 指令处理。
5. 普通文本调用 `runtime.sendInput({ text })`。

slash 指令第一版：

| 输入 | 行为 |
|---|---|
| `/submit` | 调用 core `submit`，提交当前 Session 产物。 |
| `/exit` | 调用 core `cancel`，回 Hub。 |
| `/cancel` | 同 `/exit`。 |
| `/status` | 拦截，提示先 `/exit` 回 Hub 再查看状态。 |
| `/help` | 拦截，提示先 `/exit` 回 Hub 再查看帮助。 |
| `/next` | 拦截，提示 tui 没有 next，请回 Hub 选择具体流程。 |
| `/revise` | 拦截，提示先回 Hub。 |
| 其它 `/...` | 展示未知指令提示。 |

普通文本提交成功后：

- 立即显示用户消息，或等待 core 的 `message-added` 事件显示。第一版建议以 core 事件为准，避免重复。
- 输入框清空。
- 进入等待/streaming/loading 状态。

`submit` 处理：

- assistant 普通回复结束后回到等待输入，不自动提交。
- 用户输入 `/submit` 后，driver 调用 `runtime.executeCommand({ command: 'submit' })`。
- submit 成功后由 runtime 事件驱动回 Hub。
- submit 失败时停留 Session 页并展示错误；如果 Session 进入 failed，只允许 cancel。
- 如果 core 暴露 `ready-to-submit` 这类内部状态，tui 只把它显示为“可提交/处理中”的 UI 状态，不把它当成自动提交触发器。

## 15. Event 投影

tui 不解析旧文本输出，只消费 core runtime events。

事件处理表：

| core event | tui 投影 |
|---|---|
| `world-changed` | 更新 snapshot、commands、Hub status。 |
| `session-created` | 切到 Session 页，记录 sessionId/sessionKind，清理旧输入状态。 |
| `session-status-changed` | 更新 Session status；不因 `ready-to-submit` 自动 submit。 |
| `session-ended` | 回 Hub status，记录最近结果。 |
| `message-added` | 写入 MessageStore 或 Hub recent/error。 |
| `assistant-message-start` | 在 MessageStore 中创建 assistant 消息。 |
| `assistant-message-delta` | 追加到同一条 assistant 消息。 |
| `assistant-message-end` | 标记 assistant 消息 complete。 |
| `assistant-message-error` | 标记 assistant 消息 error，并保留已收到文本。 |
| `input-started` / `input-succeeded` | 更新输入 operation 状态。 |
| `input-failed` | 展示错误，输入框恢复或等待 cancel。 |
| `input-requested` | 显示并聚焦 TextInput。 |
| `input-closed` | 禁用 TextInput。 |
| `loading-*` | 更新 LoadingBar。 |
| `command-started` | 更新 Hub/Session loading。 |
| `command-succeeded` | 清理 loading，刷新 commands。 |
| `command-rejected` | 展示不可用原因。 |
| `command-failed` | 展示错误。 |

MessageStore 使用规则：

- 只把带 sessionId 的 Session 消息放入 session message store。
- Hub status/help 不进入 session message store。
- assistant delta 必须聚合到同一条消息。
- 不允许在 assistant end 后再生成一条重复完整消息。

RuntimeEvent 到 MessageStore 的 adapter 规则：

```ts
/** 将 core RuntimeEvent 中的 session 消息事件投影到 MessageStore。 */
function applyRuntimeEventToMessageStore(store: MessageStore, event: RuntimeEvent): void {
  // 伪代码，真实实现应使用 switch 保持类型收窄。
}
```

具体映射：

| RuntimeEvent | MessageStore 输入 |
|---|---|
| `message-added` 且 `message.sessionId` 存在 | `store.applySessionEvent(sessionId, { type: 'message-added', message })` |
| `assistant-message-start` | `store.applySessionEvent(sessionId, { type: 'assistant-message-start', messageId })` |
| `assistant-message-delta` | `store.applySessionEvent(sessionId, { type: 'assistant-message-delta', messageId, delta })` |
| `assistant-message-end` | `store.applySessionEvent(sessionId, { type: 'assistant-message-end', messageId })` |
| `assistant-message-error` | `store.applySessionEvent(sessionId, { type: 'assistant-message-error', messageId, error })` |

不进入 MessageStore 的事件：

- Hub status/help 本地消息。
- 没有 sessionId 的全局错误或 Hub 提示。
- command/input lifecycle 事件本身。

这些事件由 driver 转成 Hub recent、loading 或 error display。

## 16. ViewModel 细化

ViewModel 保持现有 tui 的 signal 风格，但不再混入旧 core 查询。

建议拆分：

```text
runtime-driver/
  create-runtime-driver.ts
  event-reducer.ts
  action-projection.ts
  session-input.ts
  types.ts

view-model/
  create-view-model.ts
  projections.ts
  types.ts

components/
  header.tsx
  message-list.tsx
  loading-bar.tsx
  hub-select.tsx
  text-input.tsx
  footer.tsx

format/
  hub-status.ts
  hub-help.ts
  command-labels.ts
  errors.ts
```

保留现有 tui 的 UI 经验：

- Header 展示 world/session 概要。
- MessageList 负责滚动、stick-to-bottom、长文本换行。
- LoadingBar 展示 busy/loading。
- HubSelect 负责上下选择和快捷键。
- TextInput 负责文本输入。
- Footer 展示当前页面可用操作提示。

## 17. 文件结构计划

第一版落地结构：

```text
packages/tui/src/
  index.ts
  main.ts
  argv.ts
  app.tsx
  theme.ts
  runtime-driver/
    create-runtime-driver.ts
    event-reducer.ts
    action-projection.ts
    session-input.ts
    types.ts
  view-model/
    create-view-model.ts
    types.ts
  components/
    constants.ts
    header.tsx
    message-list.tsx
    loading-bar.tsx
    hub-select.tsx
    text-input.tsx
    footer.tsx
  format/
    hub-status.ts
    hub-help.ts
    command-labels.ts
    errors.ts
```

不迁移：

- `session-io.ts`
- 旧 core shell loop 适配
- 旧 next 推断逻辑

可参考但需重写：

- 现有 `components/*`
- 现有 `message-history.ts`
- 现有 `hub-select.tsx`
- 现有焦点和滚动处理

## 18. 分阶段落地计划

### 阶段 0：core submit 语义适配

状态：已完成。

目标：

- 先优化 core，使它适配“用户输入 `/submit` 才提交”的交互。
- `sendInput()` 完成一轮 assistant 回复后回到等待输入，不自动把 Session 视为需要提交。
- `ready-to-submit` 如果保留，只作为 core 内部状态，不作为 tui 自动提交触发器。
- `submit` command 可以在 active Session 的可提交稳定态执行，第一版至少支持 `waiting-input`。
- fake Session 和 handler Session 的行为保持一致。
- 更新 core tests，覆盖“普通输入后继续等待输入”和“显式 submit 后才结束 Session/切 world phase”。

验收：

- `runtime.sendInput({ text })` 后不会触发 world phase transition。
- assistant 流式结束后 Session 仍可继续接收普通输入。
- 用户执行 `/submit` 对应的 `runtime.executeCommand({ command: 'submit' })` 才会提交 Session。
- `streaming/loading/submitting/failed/completed/cancelled` 下 `submit` 不可用。
- `cancel/dispose` 仍能按 core 并发规则中断后台任务。
- `npm run test -w @dayloom/core` 通过。

### 阶段 1：静态 TUI 骨架

状态：已完成，并已在阶段 10 通过真实终端验收。

目标：

- 补 tui bindtty 依赖。
- 建立 app/main/argv 基础入口。
- 增加 `dayloom-tui [worldRoot]` bin。
- 渲染 Hub 静态 status/help。
- 将 status/help 作为 Hub 本地动作实现。
- 渲染 HubSelect、MessageList、Header、Footer。

验收：

- `npm run build -w @dayloom/tui` 通过。
- `npm run test -w @dayloom/tui` 通过。
- HubSelect 上下键、回车、快捷键可测。
- HubSelect 排序稳定可测。
- status/help 切换可测。
- status/help 切换不调用 core。

### 阶段 2：core driver 和 Hub actions

状态：已完成。

目标：

- 创建 core runtime driver。
- 从 snapshot/commands 投影 Hub status/actions。
- 实现 RuntimeEvent 到 MessageStore 的 adapter。
- Hub 选择 `init/daily/play/revise/settle/abandon-day` 时执行 core command。
- settle/abandon-day 在 Hub 中 loading 并刷新状态。

验收：

- 不同 world phase 下 Hub action 正确。
- Hub action 推荐项和排序正确。
- invalid world 只展示错误状态，不展示业务 action。
- command rejected/failed 能显示错误。

### 阶段 3：Session 页文本交互

状态：已完成；默认路径已在阶段 6 切换到自然语言业务 Session。

目标：

- `session-created` 后进入 Session 页。
- `input-requested` 后显示并聚焦 TextInput。
- 普通文本调用 `runtime.sendInput()`。
- slash 指令按现有 tui 体验拦截。
- `/submit` 调用 core `submit`。
- `/status` 与 `/help` 在 Session 页只提示回 Hub，不切页、不 overlay。
- `session-ended` 回 Hub status。

验收：

- 用户不需要手写 JSON。
- 用户通过 `/submit` 提交当前 Session。
- Session 页不出现 command select。
- `/status`、`/help`、`/next` 在 Session 页被拦截。
- `/status`、`/help` 不影响当前 active Session。
- `/exit` 或 `/cancel` 能回 Hub。

### 阶段 4：消息、流式和错误

状态：已完成，并已在阶段 8 和阶段 10 验证错误、滚动与终端渲染。

目标：

- Runtime events 投影为 MessageList。
- assistant 流式聚合成同一条消息。
- AI failed、input failed、command failed 有清晰展示。
- 保持 stick-to-bottom 和可滚动历史。

验收：

- 流式 chunk 不变成多条消息。
- assistant error 保留 partial text。
- 长中文文本视觉换行不丢字。

### 阶段 5：现有骨架闭环修正

状态：已完成。

目标：

- 修正 Hub `quit` 动作的退出链路，确保 driver 返回退出结果后真正卸载应用。
- 校对 ViewModel、driver 与组件之间的页面切换、loading 清理和 dispose 调用。
- 补齐 Hub -> Session -> Hub 的基础生命周期测试。
- 删除或明确标记仅供开发使用的占位路径，避免占位 Session 被误认为真实业务已接入。

验收：

- Hub 选择 `quit` 后应用正常退出。
- submit、cancel、command failed 后页面和 loading 不残留旧状态。
- 应用退出时 Runtime 与订阅被释放。
- 不执行真实业务时，界面明确报告能力未接入，不伪造成功结果。

### 阶段 6：接入 core 真实自然语言 Session

状态：已完成；Promptpile adapter 和真实 PTY 流式路径均有测试。

目标：

- 在 core 中实现或接入 `init/daily/play/revise` 对应的真实自然语言 Session。
- tui 的默认 `sessionFactory` 改为真实业务 Session factory。
- 普通用户输入始终是自然语言；业务 Session 内部负责构造结构化请求和处理产物。
- 保持 `/submit` 显式提交，不因 AI 一轮回复结束而自动提交。
- 接通真实 AI 流式事件、失败事件与取消信号。

验收：

- `init`、`daily`、`play`、`revise` 均能进入真实对话，而非 placeholder。
- 同一 Session 可进行多轮自然语言输入。
- `/submit` 能提交真实业务产物并触发对应 world transition。
- `/cancel` 能中断正在进行的 AI 调用并回到前一稳定 phase。
- AI 调用失败时保留 partial assistant text，Session 不会无提示消失。

### 阶段 7：业务流程完整化

状态：已完成第一版。

目标：

- 完成 `play` 的事件推进与产物写入，并保持“play 不自动切换 phase”的 core 约束。
- 完成 `revise` 的真实读取、修改、提交与取消流程。
- 完成 Hub 中 `settle` 和 `abandon-day` 的真实执行。
- 校对所有流程结束、取消和失败后的 phase、day、active Session 与 available commands。
- 为长任务提供来自 core operation/loading event 的真实进度文案。

验收：

- `planned -> play Session -> /submit -> awaiting-settle` 只由显式指令推进。
- `revise` 只能从允许的稳定状态进入，并能 submit/cancel。
- `settle` 在 Hub loading 中完成，完成后 day 和 status 同步更新。
- `abandon-day` 按 core 规则回到前一天 `idle`。
- event、transcript、plan/play state 等中间产物不会让恢复后的状态判断失真。

### 阶段 8：信息展示与错误恢复

状态：已完成。

目标：

- 丰富 Header，展示 world、day、phase、Session kind 和当前 operation。
- 完整实现 Hub status/help 内容，包括当前状态、可用动作、禁用原因、最近结果和页面操作。
- Footer 只展示当前页面、当前状态下真实可用的操作。
- 细化 loading 文案，区分等待 AI、流式回复、提交、结算和取消。
- 完善 AI、input、command、world invalid 等错误的用户提示和恢复路径。
- 校对 MessageList 的长文本换行、滚动、stick-to-bottom 和消息生命周期。

验收：

- 用户能从 Header/status 判断当前 day、phase 与正在执行的任务。
- help 内容与当前实际按键、slash 指令一致。
- 错误提示包含可执行的下一步，且不会覆盖已收到的消息。
- 长中文、英文长词和混合文本不丢字、不越界。
- 长 Session 消息不会无限制拖慢渲染，并具有明确保留策略。

### 阶段 9：启动参数与运行集成

状态：已完成。

目标：

- 对照现有 tui 校对 `worldRoot` 解析、默认目录和启动错误展示。
- 只迁移仍有价值的 argv 能力，不恢复已明确移除的 `--lang`、`next` 等旧入口。
- 补齐 monorepo script、bin、package exports 和依赖声明。
- 为 examples 中的启动脚本增加 tui 入口或独立示例。

验收：

- `dayloom-tui [worldRoot]` 可从 workspace 和安装后的 bin 启动。
- 不存在的 world、无权限目录和 invalid world 有清晰错误。
- 根目录 install/build/test 能覆盖 core 与 tui。
- 启动脚本不通过 npm registry 错误地查找本地包。

### 阶段 10：体验收尾和 E2E

状态：已完成。

目标：

- 补全主题、焦点恢复、输入历史、resize 和窄终端布局。
- 增加真实 PTY/terminal smoke test。
- 覆盖 HubSelect 键盘操作、Session 输入、流式输出、取消和退出。
- 与现有 tui 做关键交互回归对照。

验收：

- Hub/Session 往返稳定。
- HubSelect 上下键、回车和快捷键稳定。
- Session 输入框进入页面后自动获焦，回 Hub 后选择框恢复焦点。
- 消息区聚焦后可滚动，输入区与消息区焦点切换稳定。
- 窄终端布局不重叠。
- resize 后内容不丢失，CJK 长文本换行稳定。
- AI 流式 chunk 始终聚合在同一条消息。
- AI 失败、command 失败、cancel 和 dispose 均有 E2E 覆盖。
- 根 build/test 包含 tui。

阶段依赖关系：

```text
阶段 5 骨架闭环
  -> 阶段 6 真实 Session
  -> 阶段 7 业务流程完整化
  -> 阶段 8 信息与错误体验
  -> 阶段 9 启动集成
  -> 阶段 10 真实终端 E2E
```

阶段 8 与阶段 9 可以在阶段 7 后并行推进，但阶段 10 必须基于真实业务 Session 验收，不能只使用 fake/placeholder driver。

## 19. 测试计划

单元测试：

- command availability -> Hub action。
- Hub action ordering。
- world snapshot -> Hub status。
- Session status -> input mode。
- Runtime event -> driver state。
- slash input parser。
- Hub status/help local actions。
- RuntimeEvent -> MessageStore adapter。
- assistant event -> MessageStore projection。

组件测试：

- HubSelect 上下键、回车、快捷键。
- TextInput 输入和提交。
- MessageList 长文本和流式聚合显示。
- LoadingBar 状态切换。

集成测试：

- fake core runtime 下 Hub -> Session -> Hub。
- command rejected / failed。
- input failed。
- AI failed。
- cancel 回 Hub。

E2E：

- 真实终端启动 tui。
- resize 后布局稳定。
- CJK 长文本换行稳定。

## 20. 仍需 core 配合的点

core 已提供自然语言业务 Session、Promptpile 流式 client、显式 submit、play/settle 第一版产物和跨进程稳定状态回退。tui 正式路径不要求用户手写 JSON。

后续增强不阻塞本计划收尾：

- 使用真实远端模型做人工 smoke，继续调优四类 Session prompt。
- 扩展 play 的事件模型和 settle 的世界演化产物。
- 为 CLI 单独实现 core driver；CLI 可以自行提供 `next`，但不影响 tui。
