# TODO：Core 状态机重构方向

> **状态**：方向讨论中  
> **范围**：`@dayloom/core`、`@dayloom/cli`、`@dayloom/tui`  
> **日期**：2026-07  
> **原则**：先确定边界，不提前冻结具体数据结构和实现计划。

---

## 1. 背景

当前 core 与 CLI/TUI 的连接方式偏“终端文本 IO”：

- core 会输出 `AI>`、`You >`、`(Y/N)` 这类 CLI 展示文本。
- core 会用换行和普通文本写入表达排版。
- AI 流式回复、用户输入、确认、loading、状态反馈都混在同一类 IO 接口里。
- TUI 只能根据字符串猜测哪些是内容、哪些是 CLI 装饰。

这会让 TUI 多页面设计被 CLI 文本协议牵住。典型问题是：AI 流式回复过程中正文可见，但结束后可能只剩下 `AI>` 这类前缀。

因此这里讨论的不是给 TUI 过滤字符串，而是重新确定 core 与 CLI/TUI 的边界。

---

## 2. 设计方向

core 应提供业务状态机。

CLI/TUI 不直接驱动散落的业务函数，也不从 CLI 输出文本里反推状态。它们应作为状态机 driver：

```text
core business state machine
  暴露 world 状态
  暴露 Session 状态
  暴露具体命令能力
  发出语义事件
  接收自然语言输入并转发给当前 Session
  接收并执行所有具体业务指令

CLI / TUI driver
  读取状态
  监听事件
  渲染界面
  解析用户操作
  判断用户输入是否是指令
  将指令或自然语言输入提交给状态机
```

core 只描述业务状态和业务事件，不描述终端如何显示。

---

## 3. 已确定边界

### 3.1 core 不输出 UI 排版文本

以下内容不应该出现在 core 会话逻辑里：

- `AI>`
- `You >`
- `(Y/N):`
- 为了终端排版存在的空行
- 为了 CLI 阅读体验拼出来的标题线

这些只属于 CLI driver / renderer。

### 3.2 world/business 状态与 Session 交互状态分离

状态机至少需要区分两类状态：

- world/business 状态：描述 world 处于哪个业务阶段，例如是否初始化、是否正在规划、是否正在行动、是否等待结算。
- Session 交互状态：描述当前 Session 对象处于哪种交互状态，例如等待输入、等待确认、streaming、loading、完成、失败。

`playing` 这类 world/business 状态不能和 `running` 这类 Session 交互状态混在一个枚举里。

原因：

- `playing` 是 world/business 状态，即使没有打开 TUI 也成立。
- `running` 是当前进程里某个 Session 对象正在被 driver 驱动。
- 一个 world 可以是 `playing`，但当前 UI 仍然停在 Hub。
- 一个 Session 可以处于 `waiting-input/loading`，但 world/business 状态可能仍是 `planning`、`playing` 或 `revising`。

### 3.2.1 有 Session 的 world/business 状态

world/business 状态可以包含需要 Session 对象驱动的业务阶段，例如：

- `initializing`
- `planning`
- `playing`
- `revising`

这些是 world/business 状态，因为 world 已经进入了某个业务阶段，并且可以在该阶段停留、恢复或等待用户继续。

但它们仍然不能和 Session 交互状态混在一起。

例如：

- `planning` 是 world 正在进行当日规划的业务状态。
- `waiting-input` 是 planning Session 此刻正在等待用户输入的交互状态。
- `playing` 是 world 正在行动阶段。
- `streaming` 是 play Session 此刻正在接收 AI 输出的交互状态。

因此应同时存在两层：

- world/business 状态：描述 world 处于哪个业务阶段。
- Session 对象状态：描述当前会话对象处于输入、确认、流式、loading、完成等哪种交互状态。

`settle` 仍更适合作为短 operation：world 处于 `awaiting-settle` 时可以执行 `settle`，执行完成后进入下一轮 `idle`。它不需要成为一个长期可恢复的 `settling` Session 状态。

### 3.3 输入接口与指令接口分离

用户自然语言输入和业务指令/transition 是两类不同接口。

状态机不应该用一个 `dispatch(text)` 同时承载：

- 用户输入给 AI 的自然语言文本。
- `/save`、`/cancel`、`/exit` 这类 Session 指令。
- `init/daily/play/revise/settle` 这类具体业务指令。

方向上应分成：

- 输入通道：只响应当前 input request，提交用户对话文本；该通道由状态机暴露，内部转发给当前 Session。
- 指令通道：所有指令都统一提交给状态机，由状态机判断当前状态下是否可执行，并决定是否调用 SessionManager / Session。

CLI/TUI 在自己的入口层只负责判断用户操作是不是指令：

- 如果是指令，提交给状态机指令通道。
- 如果不是指令，提交给状态机输入通道。

CLI/TUI 不直接执行指令，也不直接让 Session 执行 `/save`、`/cancel`、`submit`、`giveup` 等指令。

Session 对象只负责处理自然语言输入、确认结果、AI 流和会话内部运行过程。SessionManager 只作为状态机内部的会话生命周期组件，不对外暴露指令执行权。

### 3.4 `next` 不属于 core 具体命令

`next` 是入口层推荐动作，不是 core 基础业务命令。

状态机应负责具体、可执行、语义明确的指令。

world 业务指令包括：

- `init`
- `daily`
- `play`
- `revise`
- `settle`
- `abandon-day`

Session 控制指令包括：

- `submit`
- `giveup`
- `save`
- `cancel`
- `exit`

`next` 的职责是根据当前 world/business 状态选择一个具体业务指令。这个选择逻辑属于 CLI/TUI 入口层，或一个独立的 app-level orchestration 层，而不是 core 状态机本身。

core 可以提供：

- 当前 world 状态。
- 当前 Session 状态。
- 各具体业务指令是否可执行。
- 不可执行原因。

core 不负责生成 Hub Select，也不负责决定按钮顺序、推荐高亮或快捷键。

### 3.5 CLI 与 TUI 平等适配 core

TUI 不应适配 CLI 文本输出。

正确关系是：

```text
core 状态机
  -> CLI driver / renderer
  -> TUI driver / renderer
```

而不是：

```text
core CLI 文本
  -> CLI
  -> TUI 过滤和猜测 CLI 文本
```

---

## 4. 状态机应提供的能力方向

这里只记录能力类别，不定义具体字段。

### 4.1 world/business 状态

当前设计方向下，world/business 状态应先按“可持久化、可恢复、可等待用户继续”的业务阶段建模。

候选 world/business 状态：

| 状态 | 含义 | 主要可接收动作 |
|------|------|----------------|
| `uninitialized` | world 尚未初始化 | `init` |
| `initializing` | 正在初始化 world，有 init 会话对象 | 输入、`submit`、`giveup` |
| `idle` | world 已初始化，处于干净边界 | `daily`、`revise` |
| `planning` | 正在生成/确认当日计划，有 planning 会话对象 | 输入、`submit`、`giveup` |
| `planned` | 已生成当日计划，但尚未开始行动推进 | `play`、`abandon-day` |
| `playing` | 正在行动阶段，有可恢复的 play Session | 输入、`play`、`abandon-day` |
| `awaiting-settle` | 当日行动已完成，等待结算落盘 | `settle`、`abandon-day` |
| `revising` | 正在修订 world，等待提交或放弃 | `submit`、`giveup` |
| `invalid` | 存档异常或无法识别 | 待定 |

其中 `initializing`、`planning`、`playing`、`revising` 都对应一个逻辑 Session。CLI/TUI 运行时可以挂载为内存中的 Session 对象；进程退出后，world 仍可停留在这些状态，下一次进入时再恢复 Session。

`planned` 是静态等待 play 的状态，不等同于 `planning`。

`waiting-input`、`waiting-confirm`、`loading`、`streaming` 仍属于 Session 对象的交互状态，不能和 world/business 状态混在同一层。

### 4.2 状态图

主线流转：

```text
[uninitialized]
  -- init -->
[initializing]
  -- submit -->
[idle]

[initializing]
  -- giveup -->
[uninitialized]

[idle]
  -- daily -->
[planning]
  -- submit -->
[planned]

[planning]
  -- giveup -->
[idle]

[planned]
  -- play -->
[playing]
  -- play -->
[playing]

[playing]
  -- play / day finished -->
[awaiting-settle]
  -- settle -->
[idle]
```

修订流转：

```text
[idle]
  -- revise -->
[revising]
  -- submit -->
[idle]

[revising]
  -- giveup -->
[idle]
```

放弃当日内容：

```text
[planned]
  -- abandon-day -->
[idle]

[playing]
  -- abandon-day -->
[idle]

[awaiting-settle]
  -- abandon-day -->
[idle]
```

说明：

- `initializing`、`planning`、`playing`、`revising` 都对应可挂载/可恢复的 Session。
- `planned` 不存在 planning Session；它表示当日计划已确认，静态等待 play。
- `revise` 只从 `idle` 进入 `revising`。
- `submit` 和 `giveup` 是 Session 状态下的控制指令，在 `initializing`、`planning`、`revising` 中含义不同。
- `play` 在 `playing` 中可能继续留在 `playing`，也可能在当日完成后进入 `awaiting-settle`。
- `abandon-day` 用于放弃已经进入的当日内容，回到前一轮干净边界 `idle`。
- `next` 不出现在状态图中，因为它不是 core 指令。

### 4.3 world 状态读取

用于回答：

- world 是否初始化。
- 当前 day 是什么。
- 当前 world/business 状态是什么。
- 当前状态是否对应可挂载/可恢复的 Session。
- 存档是否异常。
- 各具体业务指令与当前 world 状态的关系。

### 4.4 Session 状态读取

用于回答：

- 当前是否有可挂载/已挂载的 Session。
- 当前 Session 类型是什么。
- 当前是否等待用户输入。
- 当前是否等待确认。
- 当前是否 loading。
- 当前 Session 是否完成、保存、取消或失败。

### 4.5 指令能力

用于回答：

- 当前可以调用哪些 world 业务指令。
- 当前可以调用哪些 Session 控制指令。
- 某个指令为什么不可调用。
- 当前 Session 支持哪些控制指令，例如保存、取消、退出、提交、放弃。
- 当前状态下 `revise`、`submit`、`giveup`、`abandon-day` 等指令是否可用。

这里不包含 `next`。`next` 由 driver 根据这些能力自行解析。

具体业务指令至少需要覆盖：

- `init`
- `daily`
- `play`
- `settle`
- `revise`
- `abandon-day`

Session 控制指令至少需要覆盖：

- `submit`
- `giveup`
- `save`
- `cancel`
- `exit`

### 4.6 语义事件

状态机在业务推进过程中发出事件，CLI/TUI 分别渲染。

事件方向包括：

- AI 回复开始、增量、结束。
- 普通消息、状态消息、警告、错误。
- 请求用户输入。
- 请求用户确认。
- loading 开始、更新、结束。
- world 状态变化。
- Session 状态变化。

### 4.7 输入通道

由状态机对外暴露，只用于提交当前 input request 的用户自然语言输入。

状态机收到自然语言输入后，内部转发给当前 active Session。

它不负责执行 `/save`、`/exit`、`/next`、`submit`、`giveup` 等指令。

### 4.8 指令通道

由状态机对外暴露，只用于调用具体业务指令或 Session 指令。

所有指令统一进入状态机，包括：

- world 业务指令，例如 `init`、`daily`、`play`、`settle`、`revise`、`abandon-day`。
- Session 指令，例如 `submit`、`giveup`、`save`、`cancel`、`exit`。

状态机负责判断指令是否可执行，并在需要时调用内部 SessionManager / Session。

它不负责提交 AI 对话文本。

---

## 5. 与 TUI 多页面方案的关系

TUI 多页面方案解决的是用户体验结构：

```text
Hub      选择做什么
Session  完成这件事
```

core 状态机重构解决的是底层业务接口：

```text
TUI Hub 读取 world 状态和具体指令能力
TUI Session 读取 Session 状态并响应输入/确认事件
TUI 判断用户操作是否是指令，然后统一提交给状态机输入通道或指令通道
```

如果只做 TUI 多页面，而 core 仍然输出 CLI 文本，TUI 仍会遇到 AI 前缀、confirm 文案、loading、status/help 文本混杂等问题。

因此状态机方向应作为 TUI 多页面之后的下一轮设计主线。

---

## 6. 暂不确定内容

当前阶段不确定、也不应写死：

- TypeScript 数据结构。
- 文件结构。
- 具体迁移步骤。
- 具体测试计划。
- 是否保留旧 `SessionIO` 的最终形式。
- 状态机内部实现方式。
- 事件名称和字段。
- `giveup` 与 `cancel` 是否是两个不同指令，还是同一个指令在不同 UI 文案下的表现。
- `submit` 在 `initializing`、`planning`、`revising` 中的精确语义是否一致。
- `awaiting-settle` 的持久化名称是否沿用当前存档里的 `settling`。

这些等设计方向稳定后再单独细化。

---

## 7. 下一步讨论点

后续再逐步讨论：

- world 状态接口需要表达哪些信息。
- Session 状态接口需要表达哪些信息。
- world/business 状态应有哪些，哪些状态持有可恢复 Session，哪些只是短 operation。
- `invalid` 状态下允许哪些恢复指令。
- 状态机输入通道与指令通道的最小接口。
- SessionManager 作为状态机内部组件应承担哪些生命周期职责。
- CLI 如何基于状态机保持当前体验。
- TUI 如何基于状态机驱动 Hub / Session 页面。
- 旧 `SessionIO` 如何过渡。
