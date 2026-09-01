# `@dayloom/draft-assistant` V1 设计草案

> 状态：**Draft**（2026-09-01）  
> 范围：`packages/draft-assistant`  
> 目标：在保持 `dayloom-draft` CLI 与实现风格兼容的前提下，把“用户对话”和“Draft 更新”拆成两条职责单一的 Promptpile React 流程。

---

## 1. 设计原则

`draft-assistant` 延续现有 `@dayloom/draft` 的实现取向：

- 只抽象真实存在的边界；
- 优先复用已有 primitive，不复制已有规则；
- 不引入独立 Session framework、状态机、repository/service 层；
- 不为尚未出现的恢复场景预先增加 public API；
- 不新增 Dayloom-owned runtime state，只使用已有 Conversation / Draft / World；
- 复杂度只允许出现在真实安全边界，例如 path authority、MCP tool authority 和 Promptpile runtime integration。

核心数据层级保持：

```text
Conversation
    ↓
Draft
    ↓
World
```

含义：

```text
Conversation = 用户意图形成过程
Draft        = Conversation 的当前语义投影
World        = settle 后的 canonical state
```

---

## 2. 核心变化

现有 `@dayloom/draft`：

```text
User message
    ↓
Single Promptpile React
    ↓
Thought 同时：
- 理解用户意图
- 读取 World
- 修改 Draft
    ↓
Observe 检查 Draft 是否还需要继续编辑
    ↓
Check
    ↓
Final
```

它本质上是一个“带对话能力的 Draft editor”。

`draft-assistant` V1 只做一个结构变化：

```text
User message
    ↓
Dialogue React
    ↓
Conversation
    ↓
Draft Sync React
    ↓
Draft
```

两条 React 对应两个真实 authority domain：

```text
Dialogue React
  World        RO
  Conversation RW（通过 Promptpile）
  Draft        NONE

Draft Sync React
  World        RO
  Conversation RO
  Draft        RW
```

Promptpile React 本身保持通用，不知道 `init / plan / play / revise` 的业务语义。

---

## 3. CLI contract

V1 完全参考现有 `dayloom-draft` 参数面：

```text
dayloom-draft-assistant [init|plan|play|revise]
  --world <path>
  (--draft <path>... | --draft-dir <path>)
  --conversation <path>
  --llm-config <path>
  --message <text>
  [--output-format terminal|stream-json]
```

规则保持一致：

1. command 可显式指定 `init | plan | play | revise`；
2. 未显式指定时，通过当前 World 状态推导可用 command；
3. `--world`、`--conversation`、`--llm-config`、`--message` 必填；
4. `--message` 不可为空；
5. `--draft` 可重复；
6. `--draft` 与 `--draft-dir` 互斥且必须二选一；
7. `--output-format` 默认 `terminal`；
8. argv、command availability、path canonicalization、authority resolution 和 Promptpile binary resolution 优先直接复用 `@dayloom/draft` 已公开 primitive。

外部语义仍是：

```text
one invocation = one user message
```

内部只是从一条 React 变为顺序执行两条 React。

---

## 4. Command / stage policy

command 同时决定 Dialogue React 的当前对话目标和 Draft Sync 的投影目标。

不为 stage 建立额外 TypeScript domain model；V1 直接在 prompt 中按 command 分支。

### `init`

目标：收敛初始化 World 所需的用户意图。

禁止：

- 未完成初始化就推进故事时间；
- 自顾自写场景或小说正文；
- 提前进入 `plan`；
- 将 assistant 自己的建议视为用户确认。

### `plan`

目标：收敛下一日 / 下一阶段的用户计划意图。

禁止：

- 把计划讨论当成已经发生的剧情；
- 未经用户确认自行决定关键目标、场景或行为。

### `play`

目标：在当前 World 与计划约束下进行交互式叙事推进。

规则：

- 用户角色的 material action、choice、intention 与 private thought 只能来自用户；Assistant 不替用户决定；
- Assistant 可以控制符合 World / plan / 已有状态的 NPC、environment 与用户行动的直接 consequence，并只推进到下一个需要用户决定的节点；
- NPC / environment outcome 可以成为当前 play 的已发生事实并进入 Draft，但不得据此改写长期 canon / profile；
- 长期 World 变化继续由 Draft 经 `@dayloom/cli` lifecycle 处理；Play 不直接 publish / settle。

Dialogue Observe 必须把替用户决定、越过新的 material decision point 或擅自改写长期 canon 的回复视为需要 repair。

### `revise`

目标：收敛用户希望长期修改的 World / canon / memory 意图。

禁止：

- 把候选修改视为已经写入 World；
- 绕过 Draft / CLI lifecycle 直接变更 Archive。

---

## 5. Dialogue React

### 5.1 Authority

```text
World           RO
Conversation    RW（通过 Promptpile）
Draft           NONE
```

工具层必须保证 Dialogue React 看不到任何 `mcp__draft__*` 工具。

这是 infrastructure authority，不是 prompt-only 约束。

### 5.2 React 配置

V1：

```toml
[promptpile-react]
max_step = 4
observe_carryover = 1
```

`observe_carryover = 1` 让上一轮 Observe 自然进入下一轮 Thought 的 active work Conversation：

```text
Thought₀
  ↓
Observe₀ 发现问题并说明修正方向
  ↓
Check₀ = continue
  ↓
Thought₁ 看到 Observe₀
  ↓
修正
```

不修改 Promptpile React Check protocol。

### 5.3 Observe contract

保持最小：

```text
[REVIEW]
<none>，或说明当前回复的问题以及下一轮应该如何修正。

[USER_REPLY]
通过审查、准备发送给用户的回复；若仍需修正则为 <none>。

[SHOULD_CONTINUE]
true | false
```

语义：

```text
SHOULD_CONTINUE=true
= 当前 reply 仍需要内部修正

SHOULD_CONTINUE=false
= 当前 reply 已经可以交给 Final
```

它不表示整个 `init / plan / play / revise` 是否完成。

不增加 `STAGE_STATUS`、结构化 intent event 或额外业务 protocol。

### 5.4 Check contract

Check 只读取 latest Observe 的 `[SHOULD_CONTINUE]`：

```text
true  → react_check_decision({ decision: true })
false → react_check_decision({ decision: false })
```

Check 不产生业务 feedback；feedback 已经存在于 Observe 的 `[REVIEW]` 中。

### 5.5 Final contract

Final 是 delivery adapter，不是第二个 writer。

V1 固定：

```text
Final output == latest approved Observe 的 [USER_REPLY]
```

不得重新改写、补充、格式化或引入新的事实、决定、问题、计划与剧情推进。

---

## 6. Draft Sync React

Dialogue Final 成功并持久化进入用户 Conversation 后，立即运行独立 Draft Sync React。

### 6.1 Authority

```text
Conversation    RO
World           RO
Draft           RW
```

Draft RW 严格受 `--draft` / `--draft-dir` authority 限制。

Draft Sync 不向用户 Conversation 写入任何 Thought / Observe / Final。

### 6.2 目标

```text
根据当前 command，把 Conversation 中仍然有效的用户意图投影到 Draft。
```

保留现有 `@dayloom/draft` V1 已有的不变量：

1. Draft 是 `@dayloom/cli` 的后续语义输入，不是 World mutation DSL；
2. World 只读；
3. Draft 必须反映当前有效用户意图；
4. 被否定或替换的旧意图不能继续占优；
5. assistant 自己的建议不等于用户确认；
6. 只能写 granted Draft authority；
7. Draft 改动只能通过授权工具发生。

V1 不增加单独的 confirmation protocol；“可以”“第二个”“就这样”“前面的不要了”等确认语义继续由 React 从 Conversation 解释，并通过测试覆盖。

### 6.3 Observe contract

同样保持最小：

```text
[REVIEW]
<none>，或说明当前 Draft 与有效 Conversation 仍有什么不一致以及应如何修正。

[SHOULD_CONTINUE]
true | false
```

V1：

```toml
[promptpile-react]
max_step = 6
observe_carryover = 1
```

Draft Sync 本身应是趋向幂等的：重新读取完整 Conversation 与当前 Draft 后，继续把 Draft 收敛到当前有效意图。

---

## 7. Invocation 顺序

顶层流程保持像现有 `@dayloom/draft` 一样直接：

```text
1. parse / validate argv
2. classify World / resolve command
3. resolve canonical authority
4. resolve Promptpile binaries + LLM config
5. prepare runtime / sidecars
6. append user message → Conversation
7. run Dialogue React
8. Dialogue Final → Conversation
9. run Draft Sync React
10. return process status
11. cleanup operation root
```

V1 不引入：

- `DraftAssistant` 长生命周期 class；
- Session abstraction；
- persisted stage metadata；
- pending-turn metadata；
- assistant-owned state machine；
- Conversation + Draft 跨文件系统事务；
- public `syncDraft()` / `resyncDraft()` recovery API。

这些只有在出现真实需求后才考虑。

---

## 8. Failure semantics

保持现有 Draft 的克制策略，不伪造事务。

### setup 失败

所有可提前完成的 setup 必须发生在 append user 之前。

```text
setup failure
→ Conversation 不变
→ Draft 不变
```

### Dialogue 失败

```text
User 已 append
Dialogue Final 未完成
```

本次 invocation 返回失败。

V1：

- 不 rollback User message；
- 不伪造 Assistant Final；
- 不增加 pending-turn 状态协议；
- 保留 Promptpile React 自身的失败 / debug 行为。

### Draft Sync 失败

```text
Conversation 已包含成功的 User + Assistant
Draft 可能 stale 或部分更新
```

本次 invocation 返回 non-zero。

不 rollback Conversation，也不构造跨文件系统事务。

Draft Sync 设计为可重新执行的收敛过程；若未来 recovery 成为真实产品需求，再公开专门入口。

### Authority violation

一律 fail-closed。

不得自动扩大 path authority，不得因为模型请求暴露额外工具。

---

## 9. Output contract

`--output-format terminal|stream-json` 只代表用户可见的 Dialogue React 输出。

Draft Sync 是内部流程：

- 不把自身 React event 混入用户 stdout；
- 失败通过进程 exit code / stderr 表达；
- 不改变用户 Conversation 的消息形态。

用户 Conversation 只包含：

```text
User
Assistant Final
User
Assistant Final
...
```

---

## 10. 实现结构

V1 保持扁平，不预先建立子系统目录：

```text
packages/draft-assistant/src/
├── index.ts
├── main.ts
├── run.ts
├── react.ts
├── prompts.ts
├── runtime.ts
└── conversation.ts   # 仅在有足够独立逻辑时保留
```

实际实现时允许进一步合并文件；不以“每个概念一个文件”为目标。

职责建议：

```text
run.ts
= 顶层顺序编排

react.ts
= Dialogue / Sync 的 Promptpile React argv 与进程调用

prompts.ts
= 两条 React 的 prompts + command 分支

runtime.ts
= MCP / tool authority；允许复用现有 @dayloom/draft runtime 代码后做最小拆分
```

不新增 `stage/`、`dialogue/`、`sync/`、`services/`、`session/` 等目录，除非后续代码量真实证明有必要。

Prompts V1 继续放 TypeScript 字符串，不增加 package 内 Markdown prompt loading system。

---

## 11. 复用策略

`draft-assistant` V1 优先直接依赖 `@dayloom/draft` 已公开的稳定 primitive，例如：

```text
parseArgvV1
resolveDraftCommandV1
resolveAuthorityV1
resolvePromptpileBoundariesV1
```

不调用现有完整 `executeDraftV1()`，因为其 orchestration 仍是单 React。

不复制 argv / authority / command / path canonicalization 代码。

如果后续 `@dayloom/draft` 与 `draft-assistant` 的共享 primitive 明显增多，再依据真实代码抽共享 package；V1 不提前建立 shared runtime abstraction。

---

## 12. V1 验收重点

### Dialogue drift repair

```text
command = init
User: 我想初始化一个近未来东京世界。

Thought₀:
错误开始小说场景

Observe₀:
[REVIEW]
init 尚未完成，不应推进剧情；回到初始化并询问用户角色。

[USER_REPLY]
<none>

[SHOULD_CONTINUE]
true

Thought₁:
看到 Observe₀ 后纠正

Observe₁:
[REVIEW]
<none>

[USER_REPLY]
你希望自己在这个世界中扮演什么角色？

[SHOULD_CONTINUE]
false

Final:
逐字输出该 USER_REPLY
```

### Draft projection

Conversation：

```text
User: 我想设定在东京。
Assistant: 你希望什么时代？
User: 2040 年。
Assistant: 你的角色呢？
User: 调查记者。之前说的警察不要了。
```

Draft Sync 后必须满足：

```text
东京
2040 年
调查记者
```

不得继续保留“警察”，也不得把 Assistant 自己提出但用户没有确认的内容写成有效意图。

### Play authority

至少覆盖：

- 用户说“我推开门”时，Assistant 可以生成 NPC / environment 的直接反应，但不能替用户决定下一步行动；
- Dialogue 必须在新的 material user decision point 前停下；
- Draft 可以记录用户明确行动以及已接受的 NPC / environment outcome；
- Assistant 自行生成的用户行动不得被 Draft 当成 user action；
- Play outcome 不得被解释为修改长期 canon / profile 的授权。

### Authority

必须证明：

- Dialogue tools 中不存在 Draft 写工具；
- Draft Sync World 只读；
- Draft Sync 只能写声明的 Draft file-set / subtree；
- path escape / symlink escape fail-closed。

### Failure

至少覆盖：

- setup failure 不 append User；
- Dialogue failure 不伪造 Final；
- Draft Sync failure 不 rollback Conversation；
- Draft Sync event 不污染 stdout / 用户 Conversation。

---

## 13. 非目标

V1 不做：

- 自动 settle / publish World；
- 自动切换 command/stage；
- Conversation stage pin metadata；
- persisted assistant state；
- exactly-once user-turn protocol；
- structured intent event log；
- confirmation DSL；
- public recovery API；
- 跨 Conversation / Draft 事务；
- Prompt markdown loader；
- 新的通用 agent framework；
- 删除或替换现有 `@dayloom/draft`。

---

## 14. V1 状态

`play` authority 已按旧 Core 中经过验证的边界冻结，但不继承其 Arbiter / Change Plan / Candidate 等执行层。

当前设计没有需要新增 runtime/state protocol 才能解决的 Open question。后续优先通过最小实现与真实 Promptpile E2E 验证行为，而不是继续增加抽象。
