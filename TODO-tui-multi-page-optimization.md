# TODO：TUI Hub / Session 页面优化

> **状态**：设计中  
> **范围**：`@dayloom/tui`  
> **日期**：2026-07  
> **原则**：先冻结用户体验，再反推数据结构与实现。

---

## 1. 目标

当前 TUI 把“选择指令”和“进行对话”都塞进同一个输入框，用户需要记住 slash command，且很难分清自己是在指令层还是会话层。

新的方向是把体验拆成两个页面语义：

```text
Hub     负责：我要做什么
Session 负责：这件事怎么完成
```

但视觉上不做大跳变。Hub 和 Session 都尽量复用现有 TUI 的页面骨架：

- 上方：当前信息展示区域
- 下方：当前可交互控件

区别在于：

- Hub 下方是选择框
- Session 下方是 Textarea / Confirm

### 1.1 已冻结的基本方向

以下是前面讨论已经收敛的设计结论，后续细化和实现都以这些为前提：

1. **启动永远进入 Hub**  
   不做 `autoStart` 直接进入对话。用户先看到状态和可选指令，再决定下一步。

2. **Session 只能从 Hub 进入**  
   不做 `Session(play) -> /revise -> Session(revise)` 这类链式跳转。Session 结束后统一回 Hub，再由用户选择下一步。

3. **Hub 是实际操作页**  
   Hub 用于查看状态、查看帮助、选择下一步动作，不做额外欢迎页。

4. **Hub 只有两个内容标题：状态 / 帮助**  
   `status` 和 `help` 是 Hub 上方内容模式切换，不是往消息流里追加输出。

5. **结算不是 Session**  
   `settle` 不进入对话页，也不做独立页面。它只是 Hub 中的 loading 执行状态。

6. **结算 MVP 不二次确认**  
   用户选择「下一步：结算」后直接执行；执行期间隐藏 Select。

7. **Hub 指令根据存档状态动态生成**  
   用户不需要记 slash command；可选指令由当前 world 状态决定。

8. **TUI 不复制 World 业务判断**  
   TUI 不直接读 yaml 判断 phase。状态判断来自 core inspection / routing 能力。

9. **Session 内拦截 Hub 层指令**  
   `/status`、`/help`、`/next`、`/revise` 在 Session 中不执行，只提示返回 Hub。

10. **`/save` 按 Session 能力开放**  
    `/save` 不是所有对话页的固定能力，footer 也不能固定显示。

---

## 2. 页面定义

### 2.1 Hub 页

Hub 是 TUI 启动后的默认页面，用于查看当前状态、查看帮助、选择下一步动作。

Hub 复用当前页面结构：

```text
World: /path/to/world                         day_0001 · planned

状态
当前世界：...
当前阶段：...
推荐下一步：开始行动

> 开始行动        进入行动对话
  查看状态        显示当前世界状态
  帮助            显示指令说明
  修订            进入修订会话
  退出游戏        关闭 dayloom-tui
```

Hub 的上方区域仍复用 MessageList 形态，但内容来源和 Session 完全独立。它不再作为通用日志追加 `status/help` 输出，而是按 Hub mode 渲染计划好的状态/帮助内容。

Hub 内容面板只有两个标题：

| mode | 标题 | 内容 |
|------|------|------|
| `status` | 状态 | world、day、phase、推荐下一步、可用指令摘要 |
| `help` | 帮助 | Hub 指令说明 + Session 指令说明 |

Hub 下方原 Textarea 改为 Select。用户通过选择项触发动作。

### 2.2 Session 页

Session 是真正的对话页，用于承载 `init`、`daily`、`play`、`revise` 这类多轮交互。

Session 沿用当前对话页结构：

```text
World: /path/to/world                         会话中 · play

消息
[AI ] ...
[YOU] ...
[AI ] ...

> 输入内容...

/exit 返回指令页 · /save 保存 · /quit 退出游戏
```

Session 的 footer 必须按当前会话能力生成，不能固定写 `/save`。

---

## 3. Hub 指令与反馈

Hub 的指令用于切换 Hub 内容状态或进入其它流程。

| 指令 | 页面行为 | 反馈方式 |
|------|----------|----------|
| 下一步 | 根据存档状态进入 Session 或执行结算 | 见第 4 节 |
| 查看状态 | 留在 Hub | 上方面板切到「状态」 |
| 帮助 | 留在 Hub | 上方面板切到「帮助」 |
| 修订 | 进入 Session(revise) | 下方切为对话输入 |
| 退出游戏 | 退出 TUI | 结束进程 |

`status/help` 不追加到消息流，不弹临时输出，不进入 Session。

### 3.1 状态内容

状态面板至少显示：

- World 路径
- 当前 day
- 当前 phase
- 推荐下一步
- 当前可用指令摘要
- 最近一次会话结果摘要，若有

### 3.2 帮助内容

帮助面板至少显示：

```text
指令页
  下一步      根据存档状态执行推荐动作
  查看状态    查看世界、日期、阶段和推荐动作
  帮助        查看可用操作
  修订        进入世界修订会话
  退出游戏    关闭 TUI

对话页
  /exit      返回指令页
  /save      保存当前会话进度，仅部分会话可用
  /quit      退出游戏
```

---

## 4. 存档状态与动作

`next` 是推荐主入口，但它具体做什么由存档状态决定。

| 存档状态 | `next` 对应动作 | 页面归属 | Hub 可用指令 |
|----------|-----------------|----------|--------------|
| 未初始化 | `init` 初始化世界 | Session(init) | 下一步、状态、帮助、退出游戏 |
| `idle` | `daily` 生成今日事件 | Session(daily) | 下一步、状态、修订、帮助、退出游戏 |
| `planned` | `play` 开始行动 | Session(play) | 下一步、状态、修订、帮助、退出游戏 |
| `playing` | `play` 继续行动 | Session(play) | 下一步、状态、帮助、退出游戏 |
| `settling` | `settle` 结算当前阶段 | Hub loading | 下一步、状态、帮助、退出游戏 |
| 存档异常 | 无推荐动作 | Hub status/error | 状态、帮助、退出游戏 |

TUI 不直接读 yaml 判断 phase。MVP 可以在 TUI 层组合 core 已有 inspection 能力，但业务判断必须来自 core 导出的状态。

### 4.1 可进入 Session 的场景

只有这些动作进入 Session：

| 入口 | 进入页面 | 说明 |
|------|----------|------|
| Hub `next`，且推荐动作是 `init` | Session(init) | 初始化世界，多轮访谈 |
| Hub `next`，且推荐动作是 `daily` | Session(daily) | 生成今日内容，若需要追问则留在 Session |
| Hub `next`，且推荐动作是 `play` | Session(play) | 开始或继续行动对话 |
| Hub `revise` | Session(revise) | 修订世界/设定 |

这些动作不进入 Session：

| 动作 | 处理方式 |
|------|----------|
| Hub `status` | 切换 Hub 上方面板为「状态」 |
| Hub `help` | 切换 Hub 上方面板为「帮助」 |
| Hub `next -> settle` | Hub loading |
| Hub `quit` | 退出 TUI |
| Session 内 `/status` / `/help` / `/next` / `/revise` | 提示先 `/exit` 返回 Hub |

### 4.2 Hub 可用指令的生成原则

Hub 的指令不是静态列表，但位置和心智要稳定。

MVP 建议始终围绕这些固定入口生成：

```text
next / status / help / revise / quit
```

其中：

- `next` 始终是推荐主入口，但 label 随存档状态变化。
- `status` 始终可用；未初始化或异常存档时也显示对应状态说明。
- `help` 始终可用。
- `status` 和 `help` 是 Hub mode，不进入 Session。
- `revise` 在 `playing` / `settling` / 异常存档中不出现在 Hub Select。
- `quit` 始终可用。
- MVP 中 Hub Select 只展示当前可执行 action；不可用原因可在状态面板中说明。

---

## 5. 结算流程

结算不是 Session，也没有独立页面。

结算是 Hub 的临时 loading 状态：

```text
Hub(status)
  选择「下一步：结算」
  -> 隐藏 Select
  -> 显示 loading：正在结算当前阶段...
  -> 执行完成
  -> refresh header/status
  -> Hub(status)
  -> 显示 Select
```

MVP 中结算不做二次确认。用户选择「下一步：结算」后直接执行。

结算期间：

- Hub title 仍然是「状态」
- 不显示「结算」标题
- 下方 Select 隐藏
- 完成后切回 `status`

---

## 6. Session 指令能力

Session 内只处理当前会话相关指令。Hub 层指令不在 Session 内执行。

| Session 类型 | 可用指令 | 拦截/提示回 Hub |
|--------------|----------|----------------|
| `init` | `/exit`、`/cancel`、`/quit`；`/save` 按实现开放 | `/status`、`/help`、`/next`、`/revise` |
| `daily` | `/exit`、`/cancel`、`/quit`；`/save` 通常不开放 | `/status`、`/help`、`/next`、`/revise` |
| `play` | `/exit`、`/cancel`、`/save`、`/quit` | `/status`、`/help`、`/next`、`/revise` |
| `revise` | `/exit`、`/cancel`、`/save`、`/quit` | `/status`、`/help`、`/next`、`/revise` |

Session 内输入 Hub 指令时提示：

```text
当前正在会话中。请先输入 /exit 返回指令页，再选择状态、帮助或其它操作。
```

`/save` 必须按会话能力开放，不作为所有 Session 的固定指令。

实现时必须把 `getSessionCapability` 的静态映射与 core 当前实际支持的 session command spec 校对一遍。若 core 暂不支持某个命令，TUI 不应在 footer 中展示，也不应自行模拟该能力。

Hub 层指令的拦截位置：

```text
session-io.readInput()
  -> 收到用户文本
  -> command-guard 判断是否是 /status /help /next /revise
  -> 若是：不写入 [YOU]，显示提示，继续等待输入
  -> 若不是：写入 [YOU]，交给 core session
```

这样可以避免 `/status`、`/help` 这类 Hub 指令污染 Session 消息流。

---

## 7. 页面切换规则

启动永远进入 Hub：

```text
start -> Hub(status)
```

从 Hub 进入 Session：

```text
Hub(next -> init)  -> Session(init)  -> Hub(status)
Hub(next -> daily) -> Session(daily) -> Hub(status)
Hub(next -> play)  -> Session(play)  -> Hub(status)
Hub(revise)        -> Session(revise)-> Hub(status)
```

从 Hub 执行结算：

```text
Hub(next -> settle) -> Hub(status, loading) -> Hub(status)
```

不做：

- 不做 autoStart 直进 Session
- 不做 Session 链式跳转
- 不在 Session 中执行 `/status`、`/help`、`/next`、`/revise`
- 不把结算做成 Session
- 不把结算做成独立页面
- 不给结算加二次确认

### 7.1 入口场景

这里按用户实际路径列出入口，而不是按代码函数列出：

| 场景 | 起点 | 目标状态 | 说明 |
|------|------|----------|------|
| 冷启动 | 启动 TUI | Hub(status) | 默认焦点在 Select，推荐动作高亮 |
| 查看状态 | Hub 任意 mode | Hub(status) | 只切换上方内容标题和内容 |
| 查看帮助 | Hub 任意 mode | Hub(help) | 只切换上方内容标题和内容 |
| 进入初始化 | Hub(status/help) | Session(init) | 由 `next` 根据未初始化状态进入 |
| 进入今日生成 | Hub(status/help) | Session(daily) | 由 `next` 根据 `idle` 进入 |
| 进入行动 | Hub(status/help) | Session(play) | 由 `next` 根据 `planned/playing` 进入 |
| 进入修订 | Hub(status/help) | Session(revise) | 仅当 Hub Select 中出现 `revise` 时可进入 |
| 执行结算 | Hub(status/help) | Hub(status, loading) | 由 `next` 根据 `settling` 进入，完成后回 Hub(status) |
| Session 正常完成 | Session | Hub(status) | 刷新 Header 和状态内容 |
| Session 保存/取消 | Session | Hub(status) | 状态面板可显示最近结果摘要 |
| Session 内全局指令 | Session | Session | 不执行，提示 `/exit` 回 Hub |
| 退出游戏 | Hub 或 Session | 进程退出 | `/quit` 或 Hub 退出游戏 |

### 7.2 产品状态

实现前先按产品状态理解，不急着落到最终 TypeScript。

```text
TUI
  Hub
    status
    help
    busy/loading
  Session
    starting
    streaming
    waiting-input
    waiting-confirm
    loading
    completed
    cancelled
    failed
```

Hub 状态：

| 状态 | 上方标题 | 下方控件 | 说明 |
|------|----------|----------|------|
| Hub(status) | 状态 | Select | 默认状态，显示 world 当前信息 |
| Hub(help) | 帮助 | Select | 显示 Hub/Session 指令说明 |
| Hub(status, loading) | 状态 | 隐藏 Select | 用于结算等短流程；MVP 主要只有 settle |

Session 状态：

| 状态 | UI 表现 |
|------|---------|
| `starting` | 刚从 Hub 切入，准备执行 |
| `streaming` | AI/core 流式输出，合并到当前消息 |
| `waiting-input` | Textarea 出现并聚焦 |
| `waiting-confirm` | Confirm 控件出现并聚焦 |
| `loading` | 显示 loading，输入控件不可用 |
| `completed` | 写摘要/结束信息，然后回 Hub(status) |
| `cancelled` | 写取消信息，然后回 Hub(status) |
| `failed` | 显示错误，可回 Hub(status) |

### 7.3 不支持的入口

这些入口在 MVP 中明确不做：

| 入口 | 原因 |
|------|------|
| 启动后自动进入 `/next` | 用户缺少选择感，且 Hub 失去入口页意义 |
| Session 内 `/next` 链到新 Session | 页面状态复杂，用户也难分清当前会话边界 |
| Session 内 `/revise` 链到修订 | 同上，统一回 Hub 后再选择 |
| Session 内 `/status` / `/help` 输出 Hub 内容 | 会污染当前对话消息流 |
| 结算进入 Session | 结算是执行/落盘流程，不是自由对话 |
| 结算独立页面 | 增加第三页面心智，MVP 没必要 |
| Hub 内手动 slash 输入框 | 二期能力；MVP 用 Select |

---

## 8. 交互细节

### 8.1 Hub Select

Hub Select 是 Hub 的主操作入口。

基本能力：

- ↑↓ 切换选项
- Enter 执行
- 默认选中推荐动作，通常是「下一步」

快捷键可以分期：

```text
n  下一步
s  状态
?  帮助
r  修订
q  退出游戏
```

MVP 可以先只做 ↑↓ + Enter。

### 8.2 Busy 状态

Hub busy 时：

- Select 隐藏
- 不接受新的 Hub action
- 上方状态面板显示 loading 行
- loading 结束后刷新状态并恢复 Select

### 8.3 Focus

同一时刻只有一个主 focusable：

| 页面状态 | 主 focus |
|----------|----------|
| Hub 普通状态 | Select |
| Hub busy | 无输入控件，或 loading 占用 |
| Session waiting-input | Textarea |
| Session waiting-confirm | Confirm |

---

## 9. 消息与历史

Hub 上方仍使用 MessageList 形态，但它不是通用日志，而是 Hub mode 内容面板：

- `status` 渲染当前状态
- `help` 渲染帮助
- `settle` 期间在 `status` 中显示 loading

Session 使用另一套独立消息流：

- AI/core 输出进入 Session MessageList
- 用户输入 echo 为 `[YOU]`
- 流式输出合并为同一条 assistant 消息

回到 Hub 后，MVP 可以只在状态面板显示最近一次会话摘要，例如：

```text
最近会话：已完成
最近保存：已保存草稿
最近错误：...
```

Hub MessageList 与 Session MessageList 在数据上完全独立。MVP 不要求完整历史页；只需要 runner 在 Session completed/saved/cancelled/failed 后写入 `recent`，Hub status 渲染它。

---

## 10. 主要接口与数据结构

本节先定义 TUI 层需要稳定依赖的接口形状。命名是草案，重点是边界：TUI 负责页面状态和渲染，World/phase 业务判断来自 core inspection/routing。

### 10.1 页面状态

页面只分 Hub / Session。结算是 Hub 的 busy 状态，不是第三页面。

```ts
type TuiPage =
  | {
      kind: 'hub';
      mode: HubMode;
      busy?: HubBusyState;
    }
  | {
      kind: 'session';
      command: SessionCommand;
      state: SessionState;
    };

type HubMode = 'status' | 'help';

type HubBusyState = {
  kind: 'settling';
  label: string;
};

type SessionCommand =
  | 'init'
  | 'daily'
  | 'play'
  | 'revise';

type SessionState =
  | { kind: 'starting' }
  | { kind: 'streaming' }
  | { kind: 'waiting-input' }
  | { kind: 'waiting-confirm' }
  | { kind: 'loading'; label: string }
  | { kind: 'completed'; summary?: string }
  | { kind: 'cancelled'; summary?: string }
  | { kind: 'failed'; error: string };
```

约束：

- `TuiPage.kind === 'hub'` 时，下方主控件是 Select；若 `busy` 存在则 Select 隐藏。
- `TuiPage.kind === 'session'` 时，下方主控件由 `SessionState` 决定：Textarea / Confirm / loading / hidden。
- `settle` 只能出现在 `HubBusyState`，不能出现在 `SessionCommand`。

### 10.2 Hub action

Hub action 是 Select 的数据源。它是用户可见操作，不等同于 core command。

```ts
type HubActionId =
  | 'next'
  | 'status'
  | 'help'
  | 'revise'
  | 'quit';

type HubActionTarget =
  | { kind: 'hub-mode'; mode: HubMode }
  | { kind: 'next-session'; expectedCommand: Extract<SessionCommand, 'init' | 'daily' | 'play'> }
  | { kind: 'revise-session' }
  | { kind: 'settle-loading'; busy: HubBusyState }
  | { kind: 'app-exit' };

interface HubAction {
  id: HubActionId;
  label: string;
  summary: string;
  recommended?: boolean;
  shortcut?: string;
  target: HubActionTarget;
}
```

示例：

```ts
{
  id: 'next',
  label: '继续行动',
  summary: '进入当前行动对话',
  recommended: true,
  shortcut: 'n',
  target: { kind: 'next-session', expectedCommand: 'play' },
}
```

`next` 的 `target` 根据 core inspection 结果变化：

| next action | target |
|-------------|--------|
| `init` | `{ kind: 'next-session', expectedCommand: 'init' }` |
| `daily` | `{ kind: 'next-session', expectedCommand: 'daily' }` |
| `play` | `{ kind: 'next-session', expectedCommand: 'play' }` |
| `settle` | `{ kind: 'settle-loading', busy: { kind: 'settling', label } }` |

`revise` 使用独立 target：

```ts
{ kind: 'revise-session' }
```

这样 runner 能区分“由 next 进入的 session”和“手动修订 session”，避免所有 Session 都混成一个执行路径。

### 10.3 Hub status / help 内容

Hub 上方 MessageList 不直接消费字符串日志，而消费结构化内容，再由 TUI 渲染。

```ts
interface HubStatusContent {
  worldRoot: string;
  initialized: boolean;
  day?: string;
  phase?: string;
  nextLabel: string;
  nextSummary: string;
  actions: Array<{
    id: HubActionId;
    label: string;
  }>;
  recent?: HubRecentSummary;
  error?: string;
}

interface HubRecentSummary {
  kind: 'completed' | 'saved' | 'cancelled' | 'failed';
  label: string;
  detail?: string;
}

interface HubHelpContent {
  hubCommands: Array<{
    label: string;
    summary: string;
    shortcut?: string;
  }>;
  sessionCommands: Array<{
    command: string;
    summary: string;
    availability?: string;
  }>;
}
```

MVP 可以先把 `HubStatusContent` 渲染成多行文本，但生成层仍应保留结构，避免后续继续用字符串拼 UI。

`recent` 由 runner 写入：

- Session completed -> `recent.kind = 'completed'`
- Session saved -> `recent.kind = 'saved'`
- Session cancelled -> `recent.kind = 'cancelled'`
- Session failed -> `recent.kind = 'failed'`

新 Session 开始时不强制清空 `recent`；它表示“最近一次会话结果”。如果后续需要避免过期提示，可以在下一次成功刷新状态后由 runner 覆盖。

### 10.4 Session capability

Session footer 和命令拦截都基于 capability，不在 UI 中硬编码 `/save`。

```ts
interface SessionCapability {
  canExit: boolean;
  canCancel: boolean;
  canSave: boolean;
  canQuit: boolean;
  blockedHubCommands: Array<'status' | 'help' | 'next' | 'revise'>;
}

function getSessionCapability(command: SessionCommand): SessionCapability;
```

MVP 映射：

| Session | capability |
|---------|------------|
| `init` | exit / cancel / quit；save 按实现 |
| `daily` | exit / cancel / quit |
| `play` | exit / cancel / save / quit |
| `revise` | exit / cancel / save / quit |

### 10.5 Resolver 边界

TUI 需要几个“解析/编排”函数。它们可以先放在 `@dayloom/tui`，但不得直接读 world yaml 判断业务状态。

```ts
interface HubResolveContext {
  worldDir: string;
  t: Translator;
  recent?: HubRecentSummary;
}

interface HubResolvedState {
  page: Extract<TuiPage, { kind: 'hub' }>;
  actions: HubAction[];
  status: HubStatusContent;
  help: HubHelpContent;
}

function resolveHubState(ctx: HubResolveContext): HubResolvedState;

function resolveHubActions(ctx: HubResolveContext): HubAction[];

function resolveHubStatus(
  ctx: HubResolveContext,
  actions: HubAction[],
): HubStatusContent;
```

职责：

- `resolveHubActions`：用 core inspection 生成 Select 项。
- `resolveHubStatus`：生成状态面板结构化内容。
- `resolveHubState`：组合 Hub 页面默认状态，通常是 `Hub(status)`。

### 10.6 Runner 边界

页面选择和 core 执行之间需要一层 TUI 编排。

```ts
interface TuiRuntime {
  page: Signal<TuiPage>;
  actions: Signal<HubAction[]>;
  status: Signal<HubStatusContent>;
  help: Signal<HubHelpContent>;
  recent: Signal<HubRecentSummary | undefined>;
}

async function runHubAction(
  action: HubAction,
  runtime: TuiRuntime,
  ctx: TuiRunContext,
): Promise<void>;

interface TuiRunContext {
  worldDir: string;
  actionOpts: RecommendedActionOptions;
  t: Translator;
}
```

`runHubAction` 的行为：

| target | 行为 |
|--------|------|
| `hub-mode` | 更新 `page.mode` |
| `next-session` | 设置 `page=session`，调用 `runShellNext` 路径，finally 回 Hub(status) |
| `revise-session` | 设置 `page=session(revise)`，调用 revise 路径，finally 回 Hub(status) |
| `settle-loading` | 设置 `page=Hub(status,busy)`，隐藏 Select，执行 core 结算路径，刷新 Hub(status) |
| `app-exit` | dispose / exit |

MVP 中 `next-session` 和 `settle-loading` 都可以继续复用 core 的 `runShellNext`，但 TUI 外环负责页面切换。`revise-session` 走 revise 路径。

执行时允许 core 重新 inspect world 状态，并以执行时 core 最新状态为准。Hub action 展示的是用户按下 Enter 前的建议；真正执行后必须刷新 Hub actions/header/status，以消除期间存档状态变化带来的差异。

错误处理规则：

- Session 失败：写入 `recent.failed`，回到 Hub(status)，刷新 Header/actions/status。
- 结算失败：回到 Hub(status)，恢复 Select，并在 status 中显示错误或 `recent.failed`。
- 无论成功失败，runner 的 `finally` 都必须尝试刷新 Header/actions/status，避免页面停在 busy 或 session 状态。

### 10.7 组件输入

组件层尽量只消费渲染所需 props，不读取业务上下文。

```ts
interface HubViewProps {
  mode: HubMode;
  busy?: HubBusyState;
  status: HubStatusContent;
  help: HubHelpContent;
  actions: HubAction[];
  selectedIndex: number;
}

interface SessionViewProps {
  command: SessionCommand;
  state: SessionState;
  capability: SessionCapability;
}
```

Hub 渲染规则：

- `mode=status` 渲染 `status`
- `mode=help` 渲染 `help`
- `busy` 存在时强制显示 status 标题和 loading 行
- `busy` 存在时 Select 隐藏

Session 渲染规则：

- MessageList 沿用现有对话区域
- footer 由 `capability` 生成
- Textarea / Confirm / loading 由 `state` 决定

Footer 归属：

| 页面状态 | Footer 内容 |
|----------|-------------|
| Hub(status/help) | Select 操作提示，例如 Enter 确认、↑↓ 选择、q 退出 |
| Hub busy | loading 提示或空 footer；不显示普通 Select 操作 |
| Session | 按 `SessionCapability` 渲染 `/exit`、按需 `/save`、`/quit` |

Footer 是全局组件，但内容必须由 `page.kind` 和当前状态决定。

---

## 11. 建议文件结构

当前 `packages/tui/src` 结构比较扁平：

```text
packages/tui/src/
  main.ts
  app.tsx
  view-model.ts
  session-io.ts
  message-history.ts
  components/
```

多页面优化建议保持小步扩展：新增 Hub/Session 专属模块，不把现有文件一次性拆散。

### 11.1 MVP 目录结构

```text
packages/tui/src/
  main.ts
  app.tsx
  view-model.ts
  session-io.ts
  message-history.ts
  theme.ts
  argv.ts

  hub/
    actions.ts
    content.ts
    runner.ts
    types.ts

  session/
    capabilities.ts
    command-guard.ts
    types.ts

  components/
    constants.ts
    footer.tsx
    header.tsx
    loading-bar.tsx
    message-list.tsx
    text-input.tsx
    hub-content.tsx
    hub-select.tsx
    session-view.tsx
```

### 11.2 文件职责

| 文件 | 职责 |
|------|------|
| `main.ts` | 启动 TUI，创建 VM/IO，进入 TUI 外环 |
| `app.tsx` | 挂载 terminal，根据 `vm.page` 渲染 Hub 或 Session |
| `view-model.ts` | 管理信号：page、hub actions、hub content、input、header、messages |
| `session-io.ts` | core `SessionIO` 到 TUI VM 的桥接 |
| `message-history.ts` | Session 消息追加、流式输出合并、用户 echo |
| `hub/types.ts` | Hub 相关类型：`HubAction`、`HubMode`、`HubStatusContent` |
| `hub/actions.ts` | 由 core inspection 生成 Hub Select action |
| `hub/content.ts` | 生成 status/help 面板内容 |
| `hub/runner.ts` | 执行 Hub action，负责 Hub/Session 页面切换 |
| `session/types.ts` | Session 相关类型：`SessionCommand`、`SessionState` |
| `session/capabilities.ts` | `getSessionCapability` 静态映射 |
| `session/command-guard.ts` | 拦截 Session 内 Hub 层指令并给提示 |
| `components/hub-content.tsx` | 渲染 Hub 上方状态/帮助内容 |
| `components/hub-select.tsx` | 渲染 Hub Select、recommended、busy |
| `components/session-view.tsx` | 组合 MessageList、LoadingBar、TextInputArea |

### 11.3 渲染分层

`app.tsx` 不做业务判断，只按 page 渲染：

```tsx
<screen gap={0} alignItems="stretch">
  <Header vm={vm} />
  {page.kind === 'hub' ? (
    <>
      <HubContent vm={vm} />
      <HubSelect vm={vm} />
    </>
  ) : (
    <SessionView vm={vm} />
  )}
  <Footer vm={vm} />
</screen>
```

Hub busy 时，`HubSelect` 隐藏：

```tsx
page.kind === 'hub' && !page.busy ? <HubSelect vm={vm} /> : null
```

### 11.4 外环分层

`main.ts` 当前直接调用 `runGameShell`。多页面后改为 TUI 外环：

```text
main.ts
  createViewModel
  createTuiSessionIO
  mountApp
  runTuiShell

hub/runner.ts
  waitHubSelection
  runHubAction
  call core action
  refreshHub
```

建议新增：

```text
packages/tui/src/tui-shell.ts
```

职责：

- 启动时刷新 Hub
- 等待 Hub Select
- 调用 `runHubAction`
- 处理退出
- 保持 CLI 的 `runGameShell` 不变

### 11.5 分期落地顺序

1. 新增 `hub/types.ts`、`session/types.ts`，先沉淀类型。
2. 扩展 `view-model.ts`，增加 `page`、`hubActions`、`hubSelection`、`hubStatus`、`hubHelp`。
3. 新增 `components/hub-content.tsx` 和 `components/hub-select.tsx`，让 Hub 能渲染。
4. 新增 `hub/actions.ts` 和 `hub/content.ts`，接入 core inspection。
5. 新增 `tui-shell.ts` / `hub/runner.ts`，替换 `main.ts` 里直接跑 `runGameShell` 的路径。
6. 新增 `session/capabilities.ts` 和 `session/command-guard.ts`，接入 footer 和命令拦截。
7. 最后按代码体量决定是否抽 `components/session-view.tsx`；MVP 可先在 `app.tsx` 里组合现有组件。

### 11.6 不建议的拆法

- 不建议把所有 Hub routing 继续塞进 `main.ts`。
- 不建议让 React/TSX 组件直接调用 core action。
- 不建议让 `session-io.ts` 负责 Hub action routing。
- 不建议一开始就把 `view-model.ts` 拆成很多小 store；等信号继续膨胀后再拆。
- 不建议 TUI 新建 World/phase parser。

---

## 12. 实现分期

### Phase 1：Hub 骨架

- [ ] 启动默认进入 Hub(status)
- [ ] 保留现有 Header
- [ ] 上方区域保留 MessageList 形态，支持 `status/help` 两种内容
- [ ] 下方 Textarea 在 Hub 中替换为 Select
- [ ] `status/help` 只切换 mode
- [ ] `quit` 可退出

### Phase 2：Hub action 生成

- [ ] 基于 core inspection 生成 Hub action 列表
- [ ] `next` label 随状态变化
- [ ] 只生成当前可执行 action；`revise` 在不可用状态不出现在 Select
- [ ] 状态面板说明不可用能力或异常状态，不用不可执行 action 表达
- [ ] 默认高亮推荐 action

### Phase 3：Session 接入

- [ ] `next -> init/daily/play` 进入 Session
- [ ] `revise` 进入 Session
- [ ] Session 退出后回 Hub(status)
- [ ] Session footer 按能力生成，并与 core 实际 session command spec 校对
- [ ] Session 内拦截 Hub 指令：在写入 `[YOU]` 前拦截 `/status`、`/help`、`/next`、`/revise`
- [ ] Session failed 时写入 `recent.failed`，回 Hub(status)，并刷新 Header/actions/status

### Phase 4：结算 loading

- [ ] `next -> settle` 留在 Hub
- [ ] 执行时隐藏 Select
- [ ] 显示 loading
- [ ] 执行时以 core 最新 inspect 状态为准；完成后刷新 Header、actions 和 status
- [ ] 结算失败时恢复 Select，回 Hub(status)，并显示 error/recent.failed
- [ ] 不做二次确认

### Phase 5：验证与打磨

- [ ] PTY 覆盖冷启动 Hub
- [ ] PTY 覆盖 status/help mode 切换
- [ ] PTY 覆盖 Hub -> Session -> /exit -> Hub
- [ ] PTY 覆盖 settling -> loading -> status
- [ ] PTY 覆盖 settling 失败 -> Hub(status) + Select 恢复
- [ ] PTY 覆盖 Session 抛错 -> Hub(status) + recent.failed
- [ ] PTY 覆盖 Session 输入 `/status` 不出现 `[YOU] /status`
- [ ] PTY 覆盖 `playing/settling` 状态下 Hub Select 不出现 `revise`
- [ ] 检查 Select/Textarea/Confirm 焦点互斥

---

## 13. 完成定义

- [ ] 启动默认显示 Hub(status)
- [ ] Hub 上方只有「状态 / 帮助」两种标题
- [ ] Hub 下方是 Select，不再是通用 Textarea
- [ ] `status/help` 只切换 Hub 内容，不追加消息
- [ ] `init/daily/play/revise` 使用 Session 页面
- [ ] `settle` 使用 Hub loading，完成后回 status
- [ ] Session 内 Hub 指令被拦截并提示返回 Hub
- [ ] `/save` 按 Session 能力显示
- [ ] Hub Select 不展示当前不可执行 action
- [ ] 失败路径都能回 Hub(status)，且 Select 不被卡住
- [ ] CLI 行为不回归
