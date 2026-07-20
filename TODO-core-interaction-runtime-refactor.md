# TODO：Core 状态机重构方向

> **状态**：方向已定，进入接口规格设计  
> **范围**：`@dayloom/core`、`@dayloom/cli`、`@dayloom/tui`  
> **日期**：2026-07  
> **原则**：不考虑旧存档兼容；先定义最小可落地接口，再分阶段替换旧 `SessionIO` / CLI 文本协议。

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
- Session 交互状态：描述当前 Session 对象处于哪种交互状态，例如等待输入、streaming、loading、完成、失败。

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

这些是 world/business 状态，因为 world 已经进入了某个业务阶段，并且可以在该阶段停留或等待用户继续。跨进程时现阶段不恢复 Session 对象，而是回退到进入该 Session 前的非 Session 状态。

但它们仍然不能和 Session 交互状态混在一起。

例如：

- `planning` 是 world 正在进行当日规划的业务状态。
- `waiting-input` 是 planning Session 此刻正在等待用户输入的交互状态。
- `playing` 是 world 正在行动阶段。
- `streaming` 是 play Session 此刻正在接收 AI 输出的交互状态。

因此应同时存在两层：

- world/business 状态：描述 world 处于哪个业务阶段。
- Session 对象状态：描述当前会话对象处于输入、流式、loading、完成等哪种交互状态。

`settle` 仍更适合作为短 operation：world 处于 `awaiting-settle` 时可以执行 `settle`，执行完成后进入下一轮 `idle`。设计层不保留 `settling` world/business 状态；正在结算只属于 operation 运行时 loading。

### 3.3 输入接口与指令接口分离

用户自然语言输入和业务指令/transition 是两类不同接口。

状态机不应该用一个 `dispatch(text)` 同时承载：

- 用户输入给 AI 的自然语言文本。
- `/cancel`、`submit` 这类 Session 控制指令。
- `init/daily/play/revise/settle` 这类具体业务指令。

方向上应分成：

- 输入通道：只响应当前 input request，提交用户对话文本；该通道由状态机暴露，内部转发给当前 Session。
- 指令通道：所有指令都统一提交给状态机，由状态机判断当前状态下是否可执行，并决定是否调用 SessionManager / Session。

CLI/TUI 在自己的入口层只负责判断用户操作是不是指令：

- 如果是指令，提交给状态机指令通道。
- 如果不是指令，提交给状态机输入通道。

CLI/TUI 不直接执行指令，也不直接让 Session 执行 `/cancel`、`submit` 等指令。

Session 对象只负责处理自然语言输入、AI 流和会话内部运行过程。SessionManager 只作为状态机内部的会话生命周期组件，不对外暴露指令执行权。

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
- `cancel`

`next` 的职责是根据当前 world/business 状态选择一个具体业务指令。这个选择逻辑不属于 core 状态机本身。当前设计中 CLI 可以自行提供 `next` 作为入口层便捷能力；core 与 TUI 不提供 `next`，而是直接暴露或展示具体可执行动作。

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

### 3.6 现阶段不进入 core 状态机的能力

当前方向下，以下能力先不进入 core 状态机设计：

- 保存草稿：现阶段去掉 `save`。未来如需恢复，作为 SessionManager 统一会话管理能力重新设计，语义类似 `cancel/submit` 一类 Session 控制指令。
- 退出应用：core 没必要设计 `exit`。退出 CLI/TUI 进程属于 driver/app 生命周期，不属于 world/business 状态机。
- `next`：core 与 TUI 都不提供 `next` 指令。CLI 可以自行提供 `next` 作为入口层便捷能力，最终仍应转换成具体业务指令提交给 core。
- `invalid` 恢复/修复：延后设计。
- 跨进程 Session 恢复：现阶段不恢复 Session 对象；如果进程退出时处在 Session 状态，重新进入时回退到进入该 Session 前的非 Session 状态。

---

## 4. 状态机应提供的能力方向

这里只记录能力类别，不定义具体字段。

### 4.1 world/business 状态

当前设计方向下，world/business 状态应先按“可持久化、可停留、可等待用户继续”的业务阶段建模。

候选 world/business 状态：

| 状态 | 含义 | 主要可接收动作 |
|------|------|----------------|
| `uninitialized` | world 尚未初始化 | `init` |
| `initializing` | 正在初始化 world，有 init 会话对象 | 输入、`submit`、`cancel` |
| `idle` | world 已初始化，处于干净边界 | `daily`、`revise` |
| `planning` | 正在生成/确认当日计划，有 planning 会话对象 | 输入、`submit`、`cancel` |
| `planned` | 已生成当日计划，但尚未开始行动推进 | `play`、`abandon-day` |
| `playing` | 正在行动阶段，有 play Session | 输入、`submit`、`cancel` |
| `awaiting-settle` | 当日行动已完成，等待结算落盘 | `settle`、`abandon-day` |
| `revising` | 正在修订 world，等待提交或取消 | `submit`、`cancel` |
| `invalid` | 存档异常或无法识别 | 待定 |

其中 `initializing`、`planning`、`playing`、`revising` 都对应一个逻辑 Session。CLI/TUI 运行时可以挂载为内存中的 Session 对象；跨进程时现阶段不恢复 Session 对象，而是回退到进入该 Session 前的非 Session 状态。

`planned` 是静态等待 play 的状态，不等同于 `planning`。

`waiting-input`、`loading`、`streaming` 仍属于 Session 对象的交互状态，不能和 world/business 状态混在同一层。

### 4.2 状态图

主线流转：

```text
[uninitialized]
  -- init -->
[initializing]
  -- submit -->
[idle]

[initializing]
  -- cancel -->
[uninitialized]

[idle]
  -- daily -->
[planning]
  -- submit -->
[planned]

[planning]
  -- cancel -->
[idle]

[planned]
  -- play -->
[playing]
  -- submit -->
[awaiting-settle]
  -- settle -->
[idle]

[playing]
  -- cancel -->
[planned]
```

修订流转：

```text
[idle]
  -- revise -->
[revising]
  -- submit -->
[idle]

[revising]
  -- cancel -->
[idle]
```

放弃当日内容：

```text
[planned]
  -- abandon-day -->
[idle]

[awaiting-settle]
  -- abandon-day -->
[idle]
```

说明：

- `initializing`、`planning`、`playing`、`revising` 都对应可挂载的 Session；跨进程时现阶段不恢复 Session 对象，而是回退到进入该 Session 前的非 Session 状态。
- `planned` 不存在 planning Session；它表示当日计划已确认，静态等待 play。
- `revise` 只从 `idle` 进入 `revising`。
- `submit` 是统一的 Session 控制指令，语义是“提交当前 Session 的产物”。具体提交的是初始化结果、当日计划、行动结果还是修订结果，由当前 world/business 状态决定。
- `cancel` 是统一的 Session 控制指令，语义是“取消当前 Session，不提交当前产物，并让当前业务指针回到进入该 Session 前的业务边界”。清理中间产物是 best-effort，不作为状态切换成功的前置条件。
- `playing` 通过 `submit` 手动进入 `awaiting-settle`，不由 play Session 自动跳转阶段。
- `abandon-day` 只在已进入当日流程、且当前没有 active Session 的静态状态可用。当前具体是 `planned`、`awaiting-settle`，用于放弃已经进入的当日内容，并把当前业务指针切回前一天的 `idle`。清理被放弃 day 的文件是 best-effort。
- `next` 不出现在状态图中，因为它不是 core 指令。

状态图只表达逻辑目标状态，不等于“只改 phase 字段”。core2 不追求强文件回滚，而应定义“引用有效性模型”：业务正确性由 current 指针、phase 和 publish marker 决定；未被当前有效引用指向的文件视为 orphan，不参与业务读取。

### 4.2.1 World State 表

| 状态 | 是否有 Session | world 业务指令 | Session 控制指令 | 成功目标状态 | 取消目标状态 |
|------|----------------|----------------|------------------|--------------|--------------|
| `uninitialized` | 否 | `init` | 无 | `initializing` | 无 |
| `initializing` | 是 | 无 | `submit`、`cancel` | `idle` | `uninitialized` |
| `idle` | 否 | `daily`、`revise` | 无 | `planning` / `revising` | 无 |
| `planning` | 是 | 无 | `submit`、`cancel` | `planned` | `idle` |
| `planned` | 否 | `play`、`abandon-day` | 无 | `playing` / `idle` | 无 |
| `playing` | 是 | 无 | `submit`、`cancel` | `awaiting-settle` | `planned` |
| `awaiting-settle` | 否 | `settle`、`abandon-day` | 无 | `idle` | 无 |
| `revising` | 是 | 无 | `submit`、`cancel` | `idle` | `idle` |
| `invalid` | 否 | 延后设计 | 无 | 延后设计 | 无 |

### 4.2.2 Command 表

| 指令 | 类型 | 可用状态 | 是否需要 SessionManager | 成功目标状态 | 失败/取消行为 |
|------|------|----------|--------------------------|--------------|---------------|
| `init` | world 业务指令 | `uninitialized` | 创建 init Session | `initializing` | 保持 `uninitialized` |
| `daily` | world 业务指令 | `idle` | 创建 planning Session | `planning` | 保持 `idle` |
| `play` | world 业务指令 | `planned` | 创建 play Session | `playing` | 保持 `planned` |
| `revise` | world 业务指令 | `idle` | 创建 revise Session | `revising` | 保持 `idle` |
| `settle` | world 业务指令 | `awaiting-settle` | 否，短 operation | `idle` | 保持 `awaiting-settle` |
| `abandon-day` | world 业务指令 | `planned`、`awaiting-settle`，且无 active Session | 否，短 operation | 前一天 `idle` | 保持原状态 |
| `submit` | Session 控制指令 | `initializing`、`planning`、`playing`、`revising` | 通过当前 Session | 见 World State 表 | 保持当前状态并报告错误 |
| `cancel` | Session 控制指令 | `initializing`、`planning`、`playing`、`revising` | 通过当前 SessionManager | 见 World State 表 | 保持当前状态并报告错误 |

### 4.2.3 引用有效性与清理边界

状态机 transition 不能只理解为 phase transition，但 core2 首版也不应该尝试对所有文件副作用做强事务回滚。

第一版采用引用有效性模型：

- 正式业务读取必须从 `current.yaml`、runtime state 或明确 publish marker 出发。
- 文件存在不代表有效；被当前状态引用才有效。
- 未被当前有效引用指向的文件视为 orphan。
- orphan 文件不参与业务读取，不影响状态机判断。
- 删除 orphan / workspace 文件属于 best-effort cleanup；删除失败只记录 warning，不阻塞状态切换。
- 后续可以提供 `gc` 工具清理 orphan 文件。

尤其以下动作不能设计成“扫描目录猜状态”：

- `playing -- cancel --> planned`
- `planned -- abandon-day --> idle`
- `awaiting-settle -- abandon-day --> idle`

`playing -- cancel --> planned` 的问题：

- play Session 可能已经持续修改 `plan.current.json` 中的 beat 状态。
- play Session 可能已经创建或更新 `events/*`。
- play Session 可能已经写入 event `transcript.md`。
- play Session 可能已经写入 event result / status / replan 相关文件。
- play Session 可能已经更新 `play.state.json`。
- play Session 可能已经追加 world/day 日志。
- 现有实现还可能更新 `current.yaml` 和 day `meta.yaml` 的 phase。

因此 core2 首版推荐使用“会话工作区 + publish marker”：

- play Session 的中间文件写入 session workspace。
- `submit` 前，workspace 文件不被正式业务读取。
- `submit` 成功时，runtime 将 workspace publish 到正式 day 结构，并更新 current/phase/publish marker。
- `cancel` 成功时，只需要把业务指针回到 `planned`，并将 workspace 标记为 cancelled。
- workspace 删除失败不影响 cancel 结果。

`abandon-day` 的核心不是删除所有文件，而是让被放弃 day 不再被当前业务指针引用。

- `planned -- abandon-day --> idle` 需要把 current 指针切回前一天 idle，并让当前 day 目录不再被引用。
- `awaiting-settle -- abandon-day --> idle` 也需要把 current 指针切回前一天 idle，并让 play 产生的 event、transcript、play state、runtime state、plan current、day meta 不再被引用。
- “前一天 idle” 不是单个 phase 值，而是 `current.yaml` 的 day、phase、last_committed_day 与有效引用集合共同构成的状态。

因此 `abandon-day` 第一版必须定义：

| 项 | 必须回答 |
|----|----------|
| current 指针 | 回到哪个 day，`last_committed_day` 如何写。 |
| abandoned marker | 被放弃 day 如何标记为不可被正式读取。 |
| publish marker | 哪些文件算已发布，哪些只是 session/workspace 中间产物。 |
| 日志 | 追加 abandon 记录即可；不要求删除历史日志。 |
| 清理 | day/workspace 文件可 best-effort 删除，失败只记录 warning。 |
| 读取规则 | 后续读取不得扫描 orphan 文件推导业务状态。 |

在引用有效性规则未定义前，`cancel` / `abandon-day` 只能作为逻辑设计，不能视为可直接落地的实现规格。

### 4.2.4 SessionManager 职责表

| 职责 | 说明 |
|------|------|
| 创建 Session | 根据状态机指令创建 init/planning/play/revise Session。 |
| 挂载 Session | 当前进程内把逻辑 Session 挂载为可接收输入和事件的 Session 对象。 |
| 转发自然语言输入 | 状态机输入通道收到自然语言输入后，由 SessionManager 转发给 active Session。 |
| 执行 Session 控制 | 状态机收到 `submit` / `cancel` 后，由 SessionManager 协调当前 Session 完成提交或取消。 |
| 汇总 Session 事件 | 将 AI 流、消息、输入请求、loading、错误等 Session 事件转给状态机事件流。 |
| 结束 Session | Session submit/cancel 完成后清理 active Session，并把结果交给状态机决定目标 world/business 状态。 |
| 跨进程回退 | 现阶段不恢复 Session 对象；如果进程退出时处在 Session 状态，重新进入时回退到进入该 Session 前的非 Session 状态。 |
| 延后设计 | 保存草稿、损坏 Session 修复都延后统一设计。 |

### 4.3 world 状态读取

用于回答：

- world 是否初始化。
- 当前 day 是什么。
- 当前 world/business 状态是什么。
- 当前状态是否对应可挂载的 Session。
- 存档是否异常。
- 各具体业务指令与当前 world 状态的关系。

### 4.4 Session 状态读取

用于回答：

- 当前是否有可挂载/已挂载的 Session。
- 当前 Session 类型是什么。
- 当前是否等待用户输入。
- 当前是否 loading。
- 当前 Session 是否完成、取消或失败。

### 4.5 指令能力

用于回答：

- 当前可以调用哪些 world 业务指令。
- 当前可以调用哪些 Session 控制指令。
- 某个指令为什么不可调用。
- 当前 Session 支持哪些控制指令，例如取消、提交。
- 当前状态下 `revise`、`submit`、`cancel`、`abandon-day` 等指令是否可用。

这里不包含 `next`。core 与 TUI 都不提供 `next` 指令；CLI 可以自行提供 `next` 作为入口层便捷能力，最终仍应转换成具体业务指令提交给 core。

具体业务指令至少需要覆盖：

- `init`
- `daily`
- `play`
- `settle`
- `revise`
- `abandon-day`

Session 控制指令至少需要覆盖：

- `submit`
- `cancel`

### 4.6 语义事件

状态机在业务推进过程中发出事件，CLI/TUI 分别渲染。

事件方向包括：

- AI 回复开始、增量、结束。
- 普通消息、状态消息、警告、错误。
- 请求用户输入。
- loading 开始、更新、结束。
- world 状态变化。
- Session 状态变化。

### 4.6.1 流式回复事件

流式回复应表达为同一条 assistant message 的生命周期，而不是把每个 delta 当成一条独立消息。

方向上应至少区分：

- assistant message 开始。
- assistant message 增量。
- assistant message 结束。
- assistant message 失败。

这些事件需要共享同一个 message id。CLI/TUI 根据 message id 把增量聚合到同一条消息里：

```text
assistant-message-start(id)
assistant-message-delta(id, delta)
assistant-message-delta(id, delta)
assistant-message-end(id)
```

错误方向是：

```text
delta -> append message row
```

正确方向是：

```text
delta -> update message text by message id
```

这样可以避免 TUI 中每个词或每个 chunk 单独成行，也可以避免流式结束后正文丢失、只剩 `AI>` 一类 UI 前缀。

### 4.6.2 消息聚合边界

流式事件不应直接等同于展示消息。展示层需要读取聚合后的消息模型：

```text
Message
  id
  role
  text
  status
```

聚合规则：

- start：创建一条 assistant message，状态为 streaming。
- delta：按 message id 追加到同一条 message 的 text。
- end：把 message 状态改为 complete。
- error：把 message 状态改为 error，并保留已有正文。

消息聚合可以作为 runtime 内部能力，也可以作为 CLI/TUI 共享的 driver 辅助模块；但 provider 原始流不应直接进入 TUI，TUI 也不应根据文本前缀猜测消息边界。

### 4.7 输入通道

由状态机对外暴露，只用于提交当前 input request 的用户自然语言输入。

状态机收到自然语言输入后，内部转发给当前 active Session。

它不负责执行 `submit`、`cancel` 等指令。CLI 自行提供的 `next` 也必须先转换为具体业务指令，再进入指令通道。

### 4.8 指令通道

由状态机对外暴露，只用于调用具体业务指令或 Session 指令。

所有指令统一进入状态机，包括：

- world 业务指令，例如 `init`、`daily`、`play`、`settle`、`revise`、`abandon-day`。
- Session 指令，例如 `submit`、`cancel`。

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
TUI Session 读取 Session 状态并响应输入事件
TUI 判断用户操作是否是指令，然后统一提交给状态机输入通道或指令通道
```

如果只做 TUI 多页面，而 core 仍然输出 CLI 文本，TUI 仍会遇到 AI 前缀、loading、status/help 文本混杂等问题。

因此状态机方向应作为 TUI 多页面之后的下一轮设计主线。

---

## 6. 落地接口规格

这里开始进入可实现规格，但仍只冻结第一版最小接口，不提前设计复杂扩展。

### 6.1 Runtime 对外接口

CLI/TUI 只接触 runtime，不直接接触具体业务函数或 Session 对象。

第一版 runtime 应提供：

| 接口 | 调用方 | 职责 |
|------|--------|------|
| `getSnapshot` | CLI/TUI | 读取当前 world 与 session 的最小运行快照。 |
| `getAvailableCommands` | CLI/TUI | 读取当前可执行指令及不可执行原因。 |
| `sendInput` | CLI/TUI | 提交自然语言输入，只能在当前 Session 等待输入时调用；接受输入并启动后台任务后返回。 |
| `executeCommand` | CLI/TUI | 提交具体 world 指令或 Session 控制指令。 |
| `subscribe` | CLI/TUI | 订阅 runtime 语义事件，用于增量渲染和测试断言。 |
| `dispose` | CLI/TUI | 释放当前 runtime 持有的外部资源，例如子进程、MCP gateway、临时目录。 |

约束：

- runtime 不暴露 `next`。
- runtime 不暴露 CLI 文本输出。
- runtime 不让外部直接调用 Session 的 `submit/cancel`。
- runtime 内部可以使用 SessionManager，但 SessionManager 不作为第一版公共 API。
- `getSnapshot()` 和 `getAvailableCommands()` 是只读接口，不进入 mutation 队列。
- `sendInput()`、`executeCommand()`、`dispose()` 是短 mutation 接口，同一时刻只能执行一个短 mutation。

### 6.1.1 并发与重入规则

runtime 第一版采用短 mutation 串行规则：

- 同一时刻只能有一个短 mutation 正在执行。
- 短 mutation 包括 `sendInput`、`executeCommand`、`dispose`。
- 短 mutation 执行期间，新的 mutation 请求直接失败，返回 `RUNTIME_BUSY`。
- `getSnapshot` / `getAvailableCommands` 可以随时读取最近一次已提交状态。
- listener 中不能重入调用 mutation；如果调用，按普通并发规则处理，通常返回 `RUNTIME_BUSY`。
- `dispose` 开始后，runtime 进入 disposing/closed 语义，后续 mutation 返回错误。

第一版不自动排队外部 mutation。原因是 CLI/TUI 的用户操作通常需要立刻知道“当前 runtime 忙”，而不是把过期输入排到后面执行。

关键约束：

- `sendInput` 只负责接收输入、更新 Session 状态、启动后台 Session task，然后尽快返回。
- `sendInput` 不等待完整 AI streaming 结束。
- AI streaming/loading 由后台 Session task 通过事件继续推进。
- 后台 Session task 不持有 mutation lock。
- streaming/loading 期间，`cancel` 和 `dispose` 可以获得 mutation lock。
- SessionManager 必须为后台 task 持有 `AbortController` 或等价取消句柄。
- `cancel` 负责 abort 当前后台 task，并把 Session 标记为 cancelled/failed 后回到对应业务边界。
- `dispose` 是最高优先级关闭操作，负责 abort 当前后台 task 并释放资源。
- 如果后台 task 已经自然结束，后续 `cancel/dispose` 按当前 Session 状态幂等处理。

内部实现仍建议用一个 serial executor 包住短 mutation，保证状态提交和事件发送顺序一致。后台 task 发事件前也必须通过 runtime 的状态提交入口，避免和短 mutation 并发改同一份状态。

### 6.1.2 指令可用性规则

`getAvailableCommands()` 不能只按 world phase 判断，还必须结合 Session 状态。

第一版规则：

- world 指令按 world phase 判断，例如 `planned` 才能 `play`。
- `submit` 只有在存在 active Session，且 Session status 为 `ready-to-submit` 时启用。
- `cancel` 只有在存在 active Session，且 Session status 不是 `submitting/completed/cancelled` 时启用。
- `sendInput` 只有在存在 active Session，且 Session status 为 `waiting-input` 时允许。
- `streaming/loading` 期间，`cancel` 和 `dispose` 允许执行并中断后台 task；其它 mutation 应禁用或返回 `COMMAND_NOT_AVAILABLE`。
- `submitting` 期间，除 `dispose` 外其它 mutation 禁用；是否允许 `cancel` 中断 submit 后续单独设计，第一版不允许。
- `invalid` 状态第一版禁用所有 mutation，只允许读取 snapshot 和 commands。

因此 commands 的唯一事实来源是 `getAvailableCommands()`。snapshot 不包含 commands，避免出现两个来源不一致。

### 6.2 Snapshot 最小模型

snapshot 是 CLI/TUI 判断当前 runtime 状态的最小读数，不承担消息历史、菜单内容或 UI 配置职责。第一版只包含两块：

```text
RuntimeSnapshot
  world
  session
```

world snapshot 用于判断 world 业务阶段：

```text
WorldSnapshot
  phase
  worldRoot
  day
  initialized
  invalidReason
```

session snapshot 用于判断当前是否存在 active Session 以及 Session 交互状态：

```text
SessionSnapshot
  active
  id
  kind
  status
  input
  loading
  error
```

消息不放入 snapshot；消息由 runtime 事件流和消息聚合模块处理。指令能力不放入 snapshot；指令能力通过 `getAvailableCommands` 单独读取。

第一版 snapshot 字段只表达“够判断当前 runtime 状态、够测试状态机”。具体 TypeScript 类型后续实现时再冻结。

### 6.3 Runtime 事件模型

runtime 事件用于增量更新和测试，不承载 UI 文案排版。

第一版事件分组：

| 事件组 | 说明 |
|--------|------|
| world | world phase 变化、day 变化、world 错误。 |
| session | Session 创建、状态变化、结束、失败。 |
| message | 用户消息、系统消息、错误消息、assistant 完整消息。 |
| stream | assistant message start/delta/end/error。 |
| input | 请求输入、输入关闭。 |
| loading | loading 开始、更新、结束。 |
| command | 指令开始、成功、失败、不可执行。 |

事件命名后续可以细化，但必须满足：

- 每个事件都有稳定 type。
- 和消息相关的事件都有 message id。
- 和 Session 相关的事件都有 session id。
- 错误事件保留可展示 message 和可序列化 details；原始 cause 只进入 runtime 内部日志。
- CLI/TUI 不需要解析普通字符串来判断事件含义。

事件发送规则：

- runtime 必须先提交内部状态，再发送对应事件。
- 同一个 mutation 产生的事件必须按发生顺序发送。
- listener 抛错不能破坏 runtime 状态，也不能阻止后续 listener 收到事件。
- listener 抛错应进入内部日志；第一版不把 listener 错误重新抛给 mutation caller。
- `subscribe()` 只订阅调用之后的新事件，不回放历史事件。
- 如果 driver 需要当前状态，应在 subscribe 后主动调用 `getSnapshot()` 和 `getAvailableCommands()`。

每个 mutation 都必须有 operation id：

- `sendInput` 事件携带 `operationId`。
- `executeCommand` 事件携带 `operationId`。
- 同名 command 连续执行时，UI 通过 `operationId` 匹配 started/succeeded/failed/rejected。
- operation id 可以由调用方传入；未传入时 runtime 生成并在 result 与事件中返回同一个 id。

### 6.4 Session 接口方向

Session 是一次业务会话对象，只负责交互过程，不拥有 world phase 跳转权。

第一版 Session 能力：

| 能力 | 说明 |
|------|------|
| `start` | 启动会话，发出 opening message / input request / loading 等事件。 |
| `sendInput` | 接收自然语言输入，启动 AI 对话后台任务。 |
| `submit` | 提交当前会话产物，返回 submit result。 |
| `cancel` | 取消当前会话，不返回业务产物。 |
| `getSnapshot` | 返回当前 Session 交互状态。 |
| `dispose` | 清理 Session 内部资源。 |

Session 不做的事：

- 不解析 `init/daily/play/revise/settle/abandon-day`。
- 不解析 `submit/cancel/next`。
- 不直接修改 world phase。
- 不输出 `AI>`、`You >`、`(Y/N)` 等 UI 文本。

### 6.5 Session submit result

`submit` 是统一控制指令，但不同 Session 的产物不同。状态机负责根据当前 world phase 解释 submit result。

| Session kind | world phase | submit result 含义 | submit 后目标状态 |
|--------------|-------------|--------------------|-------------------|
| init | `initializing` | 初始化后的 world 文件/结构产物 | `idle` |
| planning | `planning` | 当日计划产物 | `planned` |
| play | `playing` | 当日行动结果或当日完成标记 | `awaiting-settle` |
| revise | `revising` | world 修订产物 | `idle` |

约束：

- Session 返回产物，不返回目标 world phase。
- world phase transition 只由状态机决定。
- submit 失败时保持当前 world phase，并发出错误事件。
- cancel 成功时不提交产物；如果存在 session/workspace 中间产物，应将其标记为 cancelled 或 orphan，并按 World State 表回到对应非 Session 状态。物理删除是 best-effort cleanup。

### 6.6 消息聚合位置

第一版建议先把消息聚合放在 driver 共享辅助模块，runtime 只发消息事件。

理由：

- snapshot 应保持精简，只表达 world/session 状态。
- CLI/TUI 都需要同一套流式聚合语义，但这不要求消息进入 runtime snapshot。
- 测试可以分别断言 runtime events 与 message store 聚合结果。
- CLI 仍可在 renderer 层决定是否显示 `AI>`。

driver 共享辅助模块可以保留一个 message store：

```text
RuntimeEvent -> MessageStore -> Message[]
```

CLI/TUI 可以订阅 runtime 事件并把事件交给 message store。runtime 的 `getSnapshot()` 不作为消息历史来源。

消息生命周期第一版采用 session-scoped 策略：

- message store 按 session id 分组保存消息。
- 切换到新的 Session 时，driver 默认展示新 Session 的消息。
- Hub 消息、系统消息可由 driver 单独维护，不进入 core runtime snapshot。
- 长期 play 可能产生大量消息，message store 必须支持按 session 查询和上限保留策略。
- 第一版建议每个 session 只保留最近 N 条或最近 N KB 文本，完整持久化另行设计。
- runtime 事件仍应完整发出；保留策略只影响 driver 侧 message store。

### 6.7 不考虑旧存档兼容

当前重构不考虑旧存档兼容。

这意味着：

- 不为旧 `settling` phase 设计兼容映射。
- 不为旧 session 草稿恢复设计兼容逻辑。
- 不保留旧 `save/exit/giveup` 作为 runtime 指令。
- 不为了旧 CLI 文本协议保留 `AI>` 或其他 CLI 展示文案输出。

如果后续需要迁移旧存档，应单独设计迁移工具，而不是污染 runtime 第一版接口。

### 6.7.1 invalid 第一版行为

`invalid` 作为第一版可读取状态保留，但不设计恢复/修复语义。

第一版行为：

- runtime 可以启动并返回 `world.phase = invalid`。
- `WorldSnapshot.invalidReason` 必须给出可展示原因。
- `getAvailableCommands()` 返回所有 mutation command disabled。
- `sendInput()` 返回 `INPUT_NOT_EXPECTED` 或 `WORLD_INVALID`。
- `executeCommand()` 返回 `WORLD_INVALID`。
- `dispose()` 仍可执行。
- 不提供 repair/recover/import/migrate 等指令。

恢复/修复能力后续单独设计，不能混入第一版状态机。

### 6.8 TypeScript 签名草案

第一版可以先按以下类型落地。实现时允许微调字段命名，但不应改变职责边界。

```ts
export type WorldPhase =
  | 'uninitialized'
  | 'initializing'
  | 'idle'
  | 'planning'
  | 'planned'
  | 'playing'
  | 'awaiting-settle'
  | 'revising'
  | 'invalid';

export type WorldCommand =
  | 'init'
  | 'daily'
  | 'play'
  | 'settle'
  | 'revise'
  | 'abandon-day';

export type SessionCommand =
  | 'submit'
  | 'cancel';

export type RuntimeCommand = WorldCommand | SessionCommand;

export type OperationId = string;
```

runtime 公共接口：

```ts
export interface DayloomRuntime {
  getSnapshot(): RuntimeSnapshot;
  getAvailableCommands(): CommandAvailability[];
  sendInput(input: RuntimeInput): Promise<RuntimeResult>;
  executeCommand(command: RuntimeCommandRequest): Promise<RuntimeResult>;
  subscribe(listener: RuntimeEventListener): RuntimeUnsubscribe;
  dispose(): Promise<void>;
}
```

输入与指令请求：

```ts
export interface RuntimeInput {
  operationId?: OperationId;
  text: string;
}

export interface RuntimeCommandRequest {
  operationId?: OperationId;
  command: RuntimeCommand;
}

export interface RuntimeResult {
  operationId: OperationId;
  ok: boolean;
  error?: RuntimeError;
}
```

说明：

- `sendInput` 只接自然语言，不接 slash command。
- `executeCommand` 只接具体 runtime command，不接 `next`。
- CLI 可以解析 `/next`，但必须转换成具体 `RuntimeCommandRequest`。
- TUI Hub 直接从 `CommandAvailability[]` 渲染选择项。

### 6.9 Snapshot 类型草案

```ts
export interface RuntimeSnapshot {
  world: WorldSnapshot;
  session: SessionSnapshot;
}

export interface WorldSnapshot {
  phase: WorldPhase;
  worldRoot: string;
  day: string | null;
  initialized: boolean;
  invalidReason: string | null;
}
```

Session snapshot：

```ts
export type SessionKind = 'init' | 'planning' | 'play' | 'revise';

export type SessionStatus =
  | 'none'
  | 'created'
  | 'waiting-input'
  | 'streaming'
  | 'loading'
  | 'ready-to-submit'
  | 'submitting'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface SessionSnapshot {
  active: boolean;
  id: string | null;
  kind: SessionKind | null;
  status: SessionStatus;
  input: InputRequestSnapshot | null;
  loading: LoadingSnapshot | null;
  error: RuntimeError | null;
}
```

消息事件与指令能力：

```ts
export type MessageRole = 'user' | 'assistant' | 'system' | 'error';
export type MessageStatus = 'complete' | 'streaming' | 'error';

export interface RuntimeMessage {
  id: string;
  role: MessageRole;
  text: string;
  status: MessageStatus;
  sessionId?: string;
}

export interface CommandAvailability {
  name: RuntimeCommand;
  type: 'world' | 'session';
  enabled: boolean;
  reason: string | null;
}
```

输入与 loading：

```ts
export interface InputRequestSnapshot {
  id: string;
  prompt: string | null;
}

export interface LoadingSnapshot {
  id: string;
  operation: string;
  detail: string | null;
}
```

### 6.10 Event 类型草案

事件按语义命名，不按 UI 文案命名。

```ts
export type RuntimeEvent =
  | { type: 'world-changed'; operationId?: OperationId; previous: WorldSnapshot; current: WorldSnapshot }
  | { type: 'session-created'; sessionId: string; kind: SessionKind }
  | { type: 'session-status-changed'; sessionId: string; status: SessionStatus }
  | { type: 'session-ended'; sessionId: string; status: 'completed' | 'cancelled' }
  | { type: 'message-added'; message: RuntimeMessage }
  | { type: 'assistant-message-start'; sessionId: string; messageId: string }
  | { type: 'assistant-message-delta'; sessionId: string; messageId: string; delta: string }
  | { type: 'assistant-message-end'; sessionId: string; messageId: string }
  | { type: 'assistant-message-error'; sessionId: string; messageId: string; error: RuntimeError }
  | { type: 'input-started'; operationId: OperationId; sessionId: string }
  | { type: 'input-succeeded'; operationId: OperationId; sessionId: string }
  | { type: 'input-failed'; operationId: OperationId; sessionId: string | null; error: RuntimeError }
  | { type: 'input-requested'; sessionId: string; request: InputRequestSnapshot }
  | { type: 'input-closed'; sessionId: string; requestId: string }
  | { type: 'loading-started'; sessionId?: string; loading: LoadingSnapshot }
  | { type: 'loading-updated'; sessionId?: string; loading: LoadingSnapshot }
  | { type: 'loading-ended'; sessionId?: string; loadingId: string }
  | { type: 'command-started'; operationId: OperationId; command: RuntimeCommand }
  | { type: 'command-succeeded'; operationId: OperationId; command: RuntimeCommand }
  | { type: 'command-failed'; operationId: OperationId; command: RuntimeCommand; error: RuntimeError }
  | { type: 'command-rejected'; operationId: OperationId; command: RuntimeCommand; reason: string };

export type RuntimeEventListener = (event: RuntimeEvent) => void;
export type RuntimeUnsubscribe = () => void;
```

约束：

- `message-added` 只用于非 assistant 流式生命周期消息，例如 user/system/error。
- assistant 回复统一使用 `assistant-message-start/delta/end/error`，包括非流式 assistant 回复。
- `assistant-message-end` 表示同一条 assistant message 完成；结束时不得再补发同 id 的 `message-added`。
- message store 必须按 message id 幂等更新，重复 delta/end/error 不能生成重复消息行。
- `loading-*` 可以没有 `sessionId`，用于 `settle` 这种短 operation。
- `command-rejected` 表示状态不允许执行，和执行中失败分开。
- `world-changed` 携带前后完整 world snapshot；因为 settle 后可能出现 `idle -> idle` 但 day 已改变。

### 6.10.1 AI 调用失败规则

AI 调用失败必须显式反映到 message、Session status 和 command/input result 中。

第一版采用保守策略：

- AI 回复失败后，当前 Session 进入 `failed`。
- `submit` 禁用。
- `sendInput` 禁用。
- `cancel` 仍允许，用于退出失败 Session 并回到对应业务边界。
- `retry` 不进入第一版 runtime command。

如果 assistant message 已经开始流式输出：

- 保留已经收到的 delta。
- 发出 `assistant-message-error`，携带同一个 `messageId`。
- message store 将该 message 标记为 `error`，并保留已有正文。
- Runtime 将 Session status 更新为 `failed`。
- 后台 task 发出失败事件，并将 Session 置为 failed；`sendInput` 本身通常已经返回成功，因为它只表示输入已被接受。

如果 AI 调用在 assistant message 开始前失败：

- 可以发出 `message-added`，role 为 `error`。
- Runtime 将 Session status 更新为 `failed`。
- 如果失败发生在 `sendInput` 接受输入之前，`sendInput` result 返回失败；如果失败发生在后台 task 中，则通过事件报告失败。

AI 失败不应自动切换 world phase，也不应自动 submit/cancel。后续如果需要 retry，应作为新的 Session 控制能力单独设计。

### 6.11 Session 接口草案

```ts
export interface RuntimeSession {
  readonly id: string;
  readonly kind: SessionKind;

  getSnapshot(): SessionSnapshot;
  start(): Promise<void>;
  sendInput(input: RuntimeInput, signal: AbortSignal): Promise<void>;
  submit(): Promise<SessionSubmitResult>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}
```

Session 通过注入的 emitter 发窄化 `SessionEvent`，不直接返回 UI 文本，也不能发 runtime 级事件：

```ts
export type SessionEvent =
  | { type: 'status-changed'; status: SessionStatus }
  | { type: 'message-added'; message: Omit<RuntimeMessage, 'sessionId'> }
  | { type: 'assistant-message-start'; messageId: string }
  | { type: 'assistant-message-delta'; messageId: string; delta: string }
  | { type: 'assistant-message-end'; messageId: string }
  | { type: 'assistant-message-error'; messageId: string; error: RuntimeError }
  | { type: 'input-requested'; request: InputRequestSnapshot }
  | { type: 'input-closed'; requestId: string }
  | { type: 'loading-started'; loading: LoadingSnapshot }
  | { type: 'loading-updated'; loading: LoadingSnapshot }
  | { type: 'loading-ended'; loadingId: string };

export interface SessionContext {
  worldRoot: string;
  day: string | null;
  emit(event: SessionEvent): void;
}
```

Runtime 负责把 `SessionEvent` 转换为 `RuntimeEvent`：

- 为 Session 事件补充 `sessionId`。
- 根据 Session 事件更新 Session snapshot。
- 把 `status-changed` 转换为 `session-status-changed`。
- 禁止 Session 发出 `world-changed`、`command-started/succeeded/failed/rejected`、`session-created`、`session-ended`。
- world transition 和 command 生命周期只能由 Runtime 状态机发出。

submit result 第一版保持粗粒度：

```ts
export type SessionSubmitResult =
  | { kind: 'init'; payload: unknown }
  | { kind: 'planning'; payload: unknown }
  | { kind: 'play'; payload: unknown }
  | { kind: 'revise'; payload: unknown };
```

`payload` 的精确结构由 init/daily/play/revise 各自业务模块定义。状态机第一版只要求 kind 与当前 world phase 匹配。

### 6.12 Runtime 错误模型

错误需要同时服务 UI 展示和测试断言。

```ts
export interface RuntimeError {
  code: string;
  message: string;
  details?: JsonValue;
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
```

建议第一版错误 code 至少覆盖：

| code | 含义 |
|------|------|
| `COMMAND_NOT_AVAILABLE` | 当前状态不允许执行该指令。 |
| `RUNTIME_BUSY` | 当前已有 mutation 正在执行。 |
| `INPUT_NOT_EXPECTED` | 当前没有 active Session 或 Session 不在等待输入。 |
| `SESSION_NOT_ACTIVE` | 需要 Session 的操作找不到 active Session。 |
| `SESSION_KIND_MISMATCH` | submit result 与当前 world phase 不匹配。 |
| `SESSION_FAILED` | Session 内部执行失败。 |
| `AI_CALL_FAILED` | AI/provider 调用失败。 |
| `OPERATION_FAILED` | settle / abandon-day 等短 operation 失败。 |
| `WORLD_INVALID` | world 处于 invalid 状态或读取失败。 |

### 6.13 文件结构建议

建议在 `packages/core/src/runtime/` 下新增新 runtime，不直接塞进现有 `shell` 或 `session-io`：

```text
packages/core/src/runtime/
  index.ts
  types.ts
  runtime.ts
  transitions.ts
  commands.ts
  events.ts
  message-store.ts
  session-manager.ts
  errors.ts
  sessions/
    types.ts
    fake-session.ts
    init-session.ts
    planning-session.ts
    play-session.ts
    revise-session.ts
  operations/
    settle.ts
    abandon-day.ts
```

阶段一只需要：

```text
types.ts
runtime.ts
transitions.ts
commands.ts
events.ts
message-store.ts
session-manager.ts
errors.ts
sessions/fake-session.ts
```

真实业务 Session 可以在阶段三再接入。

### 6.14 测试结构建议

新增测试建议放在：

```text
packages/core/test/runtime/
  transitions.test.js
  commands.test.js
  runtime-input.test.js
  runtime-commands.test.js
  message-store.test.js
  events.test.js
  session-manager.test.js
```

第一阶段最小测试矩阵：

| 测试 | 覆盖 |
|------|------|
| transitions | 每个合法 transition、非法 transition。 |
| commands | 每个 phase 的 enabled/disabled commands 与 reason。 |
| runtime-commands | `executeCommand` 的成功、失败、rejected。 |
| runtime-input | 没有输入请求时拒绝 input；有 Session 时转发 input。 |
| message-store | stream start/delta/end/error 聚合为同一条 message。 |
| session-manager | create / submit / cancel / dispose 的生命周期。 |
| runtime-busy | 并发 `sendInput` / `executeCommand` / `dispose` 返回 `RUNTIME_BUSY`。 |
| background-task-cancel | `sendInput` 返回后 AI 后台 task streaming 时，`cancel/dispose` 可以 abort 后台 task。 |
| operation-id | 连续同名 command 的 started/succeeded/failed/rejected 可用 operation id 匹配。 |
| listener | listener 抛错不破坏 runtime 状态，也不阻止其它 listener。 |
| submit-availability | `submit` 只在 Session `ready-to-submit` 时启用。 |
| invalid | `invalid` 可读取但禁用所有 mutation。 |
| ai-failure | AI 流式前/流式中失败会进入 Session `failed`，保留已有消息，且只允许 cancel。 |

阶段一不需要真实 AI，不需要 MCP，不需要 TUI E2E。

### 6.15 旧阻塞式 loop 的处理原则

现有 core 里的 interactive 实现大多是主动阻塞式循环：

```text
loop
  io.write(...)
  await io.readInput(...)
  parse shell command
  call AI
  io.write(...)
```

这种结构不能直接成为新 runtime 的 Session 主体。

原因：

- 输入控制权在旧 loop 内部，而新设计要求输入统一从 runtime `sendInput` 进入。
- 指令解析在旧 loop 内部，而新设计要求 `submit/cancel/init/daily/play/...` 都进入 runtime 指令通道。
- 输出是 `SessionIO` 文本协议，而新设计要求 Session 发语义事件。
- 旧 loop 自己维护交互生命周期，容易和 runtime 状态机形成两套状态。

因此真实业务接入应优先拆出以下非交互部件：

- prompt 构建。
- AI 调用与 provider stream 适配。
- assistant 输出解析。
- payload validate。
- 文件 apply / write。
- MCP gateway 与工具准备。

特别注意 `play`：

- 现有 `play/event-loop` 在计划事件耗尽或用户结束当天时会调用 `finishPlay()`。
- 现有 `finishPlay()` 会直接把 play state、`current.yaml`、day `meta.yaml` 写成 `settling`。
- 这与新设计的 `playing -- submit --> awaiting-settle` 冲突。
- core2 的 play Session 不应复用带 phase 副作用的 `finishPlay()` 作为会话内部逻辑。
- play Session 可以产出“当日行动已完成”的 submit result，但只有 runtime 状态机执行 `submit` 时才能切换到 `awaiting-settle`。

新 RuntimeSession 再用这些部件实现：

```text
start
sendInput
submit
cancel
```

过渡期如果使用旧 loop adapter，只能作为拆分过程中的短期验证手段，不应作为 core2 runtime 的最终设计。

---

## 7. 落地阶段建议

### 7.1 阶段一：状态机骨架

目标：

- 定义 world phase、command、runtime snapshot、runtime event 的第一版类型。
- 实现 transition 表。
- 实现 `getAvailableCommands`。
- 实现无真实 AI 的 fake SessionManager，用于状态机单测。

验收：

- 每个 world phase 的可用指令和不可用原因可测。
- `submit/cancel/abandon-day` 的逻辑状态跳转可测；引用有效性、publish marker 和 cleanup 行为不在阶段一实现。
- runtime 不输出 CLI 文本。

### 7.2 阶段二：Session 与事件

目标：

- 定义 Session 接口。
- 实现 SessionManager。
- 实现 message store 和流式聚合。
- 用 fake Session 验证 input、stream、loading、submit、cancel。

验收：

- delta 会聚合为同一条 assistant message。
- Session 不直接修改 world phase。
- `sendInput` 和 `executeCommand` 通道严格分离。

### 7.3 阶段三：接入真实业务

目标：

- 将 init/daily/play/revise 从现有主动阻塞式 loop 中拆出可复用业务步骤。
- 基于拆出的业务步骤实现新 RuntimeSession，而不是直接包装旧 interactive loop。
- 将 settle 包装为短 operation。
- 只复用旧实现中的非交互部件，例如 prompt、parse、validate、apply、MCP gateway、AI 调用工具；不复用旧 `SessionIO` loop 作为 runtime Session 主体。

现有实现注意点：

- `init/interview-loop`、`daily/dialogue-loop`、`play/event-loop`、`revise/dialogue-loop` 都是主动阻塞式循环。
- 这些 loop 会主动调用 `io.readInput` / `io.confirm` / `io.write`，并解析 shell-level command。
- 新 Session 不能让旧 loop 继续主导输入与指令，否则会重新引入 CLI 文本协议和双状态机问题。
- 现有 play 在事件耗尽或用户结束当天时会调用 `finishPlay()` 并直接写入 `settling`；core2 不能保留这个自动切阶段副作用。
- 过渡期可以临时抽 adapter 辅助迁移，但 adapter 只能用于拆分验证，不能成为最终 runtime 设计。

验收：

- init -> idle。
- idle -> daily -> planning -> submit -> planned。
- planned -> play -> playing -> submit -> awaiting-settle。
- awaiting-settle -> settle -> idle。
- idle -> revise -> revising -> submit/cancel -> idle。

### 7.4 阶段四：CLI/TUI driver 切换

目标：

- CLI 改为 runtime driver，可自行提供 `next`。
- TUI Hub 读取 world snapshot 和 commands。
- TUI Session 读取 session snapshot，并通过事件流/消息聚合模块读取 messages。
- 移除 TUI 对 CLI 文本协议的猜测。

验收：

- CLI/TUI 同跑一套 core runtime。
- TUI 流式消息不再拆成多行消息。
- TUI 不再出现 AI 正文丢失后只剩前缀的问题。

---

## 8. 暂不确定内容

当前阶段不确定、也不应写死：

- 具体迁移步骤。
- 旧 `SessionIO` 最终如何被拆分或替换。
- 状态机内部实现方式。
- 真实业务 Session 的 payload 精确结构。

这些等设计方向稳定后再单独细化。

---

## 9. 下一步讨论点

后续再逐步讨论：

- world 状态接口需要表达哪些信息。
- Session 状态接口需要表达哪些信息。
- 真实业务 Session 的 payload 结构。
- `cancel` / `abandon-day` 的引用有效性、orphan 标记与 best-effort cleanup 边界。
- `settle` 的文件写入边界。
- 旧 `SessionIO` 如何被拆分为非交互部件，并逐步替换为 runtime 事件接口。

延后专题：

- `invalid` 状态下允许哪些恢复/修复指令。
- 更完整的跨进程 Session 恢复规则，如未来决定支持恢复。
