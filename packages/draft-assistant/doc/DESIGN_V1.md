# `@dayloom/draft-assistant` V1 设计

> 状态：**Review-ready V1（简化重推）**  
> 范围：`packages/draft-assistant`

## 1. 目标

`draft-assistant` 只做一件事：

```text
Conversation
    ↓
Draft
```

后续：

```text
Draft
  ↓
@dayloom/cli
  ↓
Archive
```

边界固定：

- Conversation 是用户与 Assistant 的交互历史；
- Draft 是当前 command 下、从已接受 Conversation 得到的有效创作语义；
- Archive 是 canonical state；
- `draft-assistant` 不生成 Patch，不 publish，不 settle，不直接修改 Archive；
- `@dayloom/cli` 继续独占 Draft → Archive 的 mutation / validation / publication。

V1 不建立新的 Session、stage store、transaction、recovery protocol 或 agent framework。

---

## 2. 为什么保留两条 React

每轮固定：

```text
User
 ↓
Dialogue React
 ↓
accepted Assistant reply
 ↓
Conversation
 ↓
Draft Sync React
 ↓
Draft
```

两条 React 只为一个真实边界服务：

```text
Dialogue
  不允许写 Draft

Draft Sync
  才允许写 Draft
```

如果合成一条 React，Dialogue Thought 在用户回复尚未通过 Observe 审查前就拥有 Draft RW，会重新把“交互”和“语义提交”耦合起来。

因此双 React 是 V1 保留的必要复杂度；不在它上面再增加 Session manager、FSM、pending state 或 coordinator。

---

## 3. Command 与 CLI

支持：

```text
init | plan | play | revise
```

### `init`

```text
dayloom-draft-assistant [init]
  (--draft <path>... | --draft-dir <path>)
  --conversation <path>
  --llm-config <path>
  --message <text>
  [--output-format terminal|stream-json]
```

`init` 不接收 `--world`。

### `plan / play / revise`

```text
dayloom-draft-assistant [plan|play|revise]
  --world <path>
  (--draft <path>... | --draft-dir <path>)
  --conversation <path>
  --llm-config <path>
  --message <text>
  [--output-format terminal|stream-json]
```

共同规则：

- `--draft` 可重复；
- `--draft` 与 `--draft-dir` 互斥且必须二选一；
- `--conversation`、`--llm-config`、`--message` 必填；
- `--message` 不可为空；
- `--output-format` 默认 `terminal`；
- unknown argument / duplicate singleton fail before Conversation mutation；
- one invocation = one user message。

command 省略时：

```text
无 --world
→ init

有 --world
→ 按 Published World availability 在 plan/play/revise 中推导
```

如果不能唯一推导就失败；不定义默认 command。

显式 command 不可用时直接失败，不自动替换。

---

## 4. World 的含义

`--world` 指向的是 Dayloom Archive，不是给 LLM 直接浏览的普通 World 文档目录。

因此 world-bound command 的 setup 固定为：

```text
Archive
  ↓ classify / read Published head
  ↓ materialize current tree
operation-local World view
```

这个 World view：

- 是当前 Published World 文档的临时普通文件树；
- 只读；
- 不包含 `manifest.json / current.json / commits / objects / operations / .locks` 等 Archive protocol 文件；
- invocation 结束即删除；
- 只用于 Dialogue grounding。

复用 `@dayloom/cli` 已有的 Published World read / materialize primitive，不在 `draft-assistant` 重写 Archive reader。

`init` 没有 Published World，因此不建立 World view。

不增加跨 invocation 的 base pin、Session pin 或持久化 World snapshot。每次 invocation 只以 setup 时读到的当前 Published World 为准。

---

## 5. Authority

V1 的 Dayloom file authority 只有下面这张表：

| command | React | Conversation | World view | Draft |
| --- | --- | --- | --- | --- |
| `init` | Dialogue | RW | NONE | NONE |
| `init` | Draft Sync | RO | NONE | RW |
| `plan/play/revise` | Dialogue | RW | RO | NONE |
| `plan/play/revise` | Draft Sync | RO | NONE | RW |

关键点：

```text
Dialogue 负责 World grounding
Draft Sync 负责 Conversation → Draft projection
```

Draft Sync 不需要再次读取 World。它只投影已经被 Dialogue 接受并写入 Conversation 的语义，避免第二次从 World 推导新的内容。

这张表只约束 Dayloom 的 World / Draft 文件 authority。

搜索、压缩或其他未来通用工具与这张表正交；增加这些工具不需要改变本设计。

---

## 6. Dialogue React

Dialogue 的职责：

```text
基于当前 command + Conversation
必要时读取 World view
产生候选用户回复
由 Observe 审查
只把通过审查的回复写入 Conversation
```

固定运行策略：

```text
max_step = 4
max_step_policy = error
observe_carryover = 1
```

### Thought

MUST：

- 遵守当前 command policy；
- 使用 Conversation 作为交互上下文；
- `plan/play/revise` 可读取 World view 作为 canonical baseline；
- `init` 不假设存在 World；
- 不访问 Draft；
- 将最近 Observe 仅作为 repair context。

### Observe

固定语义：

```text
[REVIEW]
<none> 或当前候选回复的问题

[USER_REPLY]
通过审查的用户可见回复；仍需修正则为 <none>

[SHOULD_CONTINUE]
true | false
```

规则：

```text
invalid
→ REVIEW != <none>
→ USER_REPLY = <none>
→ SHOULD_CONTINUE = true

valid
→ REVIEW = <none>
→ USER_REPLY = exact approved reply
→ SHOULD_CONTINUE = false
```

Check 只把 `[SHOULD_CONTINUE]` 转成 React continue/stop 决策。

Final MUST 输出 latest approved `[USER_REPLY]`，不得在 Observe 之后重新发挥。

### command policy

`init`：收敛初始 premise、rules、style、user role、entities、facts、seeds 等；不推进故事时间，不把 Assistant 建议当用户确认。

`plan`：基于 Published World 讨论下一阶段计划；计划内容不是已发生事实；关键用户选择仍由用户决定。

`play`：遵守第 8 节的玩家 agency / narrative authority。

`revise`：基于 Published World 收敛长期 World revision；不得声称修改已经发布。

---

## 7. Draft Sync React

Draft Sync 不与用户对话。

职责只有：

```text
accepted Conversation
  ↓ semantic projection
Draft
```

固定运行策略：

```text
max_step = 6
max_step_policy = error
observe_carryover = 1
```

Projection：

| command | Draft 内容 |
| --- | --- |
| `init` | 当前仍成立的初始化意图 |
| `plan` | 当前仍成立的计划意图 |
| `play` | 用户明确行动/选择 + 已接受的 NPC/environment/direct consequence |
| `revise` | 当前仍成立的长期 revision 意图 |

统一规则：

- latest effective intent wins；
- 被否定或替换的旧含义不得继续占优；
- Assistant suggestion alone 不构成用户确认；
- `play` 中 Assistant 虚构的用户行动不得进入 Draft；
- accepted NPC/environment/direct consequence 可以进入 play Draft；
- play outcome 不自动成为长期 canon/profile revision；
- Draft 是给后续 CLI 的创作语义输入，不是 Archive mutation DSL；
- 对已经收敛的 Conversation + Draft 重跑应语义幂等。

Observe 只需要：

```text
[REVIEW]
<none> 或当前 Draft 与 Conversation 的剩余不一致

[SHOULD_CONTINUE]
true | false
```

Sync Final 没有产品语义；不得写入 authoritative Conversation，stdout 丢弃。

---

## 8. Play authority

`play` 的边界固定为：

```text
User owns
  用户角色的 material action
  choice
  intention
  private thought

Assistant owns
  NPC speech / reaction / concealment
  environment
  immediate event
  用户明确行动的 direct consequence
```

Assistant 可以推进场景，但只能推进到下一个需要用户做 material decision 的位置，然后停止等待用户。

例如：

```text
User: 我推开门。

Assistant:
老板抬头看向你。
角落里的两个人停止了交谈。
“找谁？”
```

允许记录：

```text
用户推开门
老板注意到用户
角落两人停止交谈
老板询问来意
```

不得补成：

```text
用户走向老板
用户拔枪
用户决定威胁老板
```

play 的 scene outcome 可以成为本次 play Draft 的事实材料，但长期 World promotion 仍由后续 CLI lifecycle 决定。

---

## 9. Runtime wiring

不新建 runtime framework。

复用现有 `@dayloom/draft` file runtime，并只做一个必要泛化：

```ts
startFileRuntimeV1({
  worldRoot,
  draft: DraftAuthorityV1 | null,
})
```

实际需要：

```text
init Dialogue
  无 Dayloom file runtime

world-bound Dialogue
  worldRoot = materialized World view
  draft = null
  → World RO only

all Draft Sync
  worldRoot = null
  draft = Draft RW
  → Draft only
```

不新增 Session runtime、runtime provider、runtime manager 或新的 shared runtime package。

Promptpile 所需的 `tools_file / after_hook` 是运行时 wiring，不是领域模型。

`init Dialogue` 可以使用合法的 operation-local tool configuration；当前没有 Dayloom file tool 不代表未来不能加入搜索、压缩等通用工具。

---

## 10. Invocation lifecycle

顶层代码保持顺序可读：

```text
1. parse argv
2. resolve command
3. world-bound command: classify World / check availability
4. resolve Draft / Conversation / LLM authority
5. world-bound command: materialize temporary read-only World view
6. resolve Promptpile boundaries + caller config
7. prepare Dialogue config/tools
8. append User → Conversation
9. run Dialogue
10. Dialogue success → approved Assistant persisted in Conversation
11. close Dialogue runtime
12. start Draft-only runtime
13. run Draft Sync
14. close Sync runtime
15. cleanup operation root
16. return exit status
```

不建立额外 coordinator；一个直接的 async function 足够。

---

## 11. Persistence / failure / output

V1 不伪造 Conversation + Draft 事务。

```text
setup failure
→ Conversation unchanged
→ Draft unchanged
→ non-zero

append User failure
→ Draft unchanged
→ non-zero

Dialogue failure after append
→ User message may remain
→ no fake Assistant Final
→ Draft unchanged
→ non-zero

Dialogue success
→ User + approved Assistant committed
→ continue Sync

Sync failure
→ Conversation remains committed
→ Draft may be stale/partial
→ non-zero
```

成功：

```text
exit 0
= Dialogue + Draft Sync 都成功
```

`--output-format` 只控制 Dialogue 的用户可见输出。

- terminal：直接使用 Dialogue React terminal 输出；
- stream-json：直接使用 Dialogue React event stream；
- Sync stdout / event / Final 不进入用户 stdout；
- 整个 invocation 是否成功最终看进程 exit code。

不额外包 Dayloom event envelope。

---

## 12. Path / authority safety

继续复用已经证明过的 Draft authority 规则：

- `--draft` 精确文件集合；
- `--draft-dir` 精确 subtree；
- canonical path；
- 防 `..` escape；
- 防 symlink escape；
- Conversation 与 Draft 不重叠；
- LLM config 不落入 Draft writable authority。

world-bound command 还必须保证 Archive / World target 与 Draft、Conversation authority 不重叠。

`init` 没有 `--world`，因此不制造假的 World path 参与 authority resolution。

---

## 13. 复用原则

只复用语义一致的 primitive。

应复用：

- `@dayloom/cli` World classification / availability；
- `@dayloom/cli` Published World materialization；
- `@dayloom/draft` Draft path authority；
- `@dayloom/draft` Promptpile boundary resolution；
- caller LLM config reader / derived config；
- Conversation append；
- process helpers；
- file runtime / hook policy。

不应为了复用而保留错误语义：

- 旧 `@dayloom/draft` parser 要求所有 command 都有 `--world`，不能直接复用；
- 旧 command resolver 会从 uninitialized World 推导 `init`，不能直接复用。

如果 primitive 没有 public export，只最小导出实际需要的函数/type；不复制整套实现，也不新建 shared framework。

---

## 14. Promptpile dependency

V1 使用已经验证的：

```text
promptpile-react = 0.1.0-beta.7
```

依赖：

```text
observe_carryover
max_step_policy = error
Final observation handoff
```

不要求修改 Promptpile React，也不为当前设计增加 beta.8 前提。

由于 boundary resolver 从 `@dayloom/draft` 自身 dependency tree 解析 React binary，相关依赖 pin 必须保持一致。

---

## 15. Complete acceptance

实现完成至少证明以下闭环：

```text
CLI
  init 无 --world
  plan/play/revise 必须有 --world
  command inference / ambiguity / availability
  draft files / draft-dir
  terminal / stream-json

Authority
  init Dialogue 无 Dayloom World/Draft tool
  world-bound Dialogue = World view RO only
  Sync = Draft RW only
  World write denied
  Draft path/symlink escape denied

Dialogue
  init / plan / play / revise
  drift → Observe repair
  max-step fail closed
  Final == approved USER_REPLY

Draft Sync
  四 command projection
  changed mind / negation / replacement
  Assistant suggestion 未确认不进入 Draft
  play accepted outcome 可进入 Draft
  invented user action 不进入 Draft
  semantic idempotence

Failure/output
  setup / append / Dialogue / Sync failure
  Dialogue committed 后 Sync failure 不 rollback
  Sync output hidden
  exit 0 only after both Reacts succeed

Real E2E
  init multi-turn → Init Draft → later dayloom init <world> --draft ... --check
  plan multi-turn → Plan Draft → dayloom plan ... --check
  play multi-turn → Play Draft → dayloom play ... --check
  revise multi-turn → Revise Draft → dayloom revise ... --check
  real Promptpile React carryover repair
```

不要求用测试证明没有引入某个抽象；代码审查直接拒绝不必要的长期状态和 orchestration framework。

---

## 16. 明确不做

V1 不做：

- Session class / manager；
- persisted FSM；
- command/stage metadata；
- pending turn / pending sync；
- base-commit pin protocol；
-跨 invocation recovery state；
- Conversation fingerprint protocol；
- structured intent event log；
- Change Plan / Candidate / Assignment；
- public recovery API；
- Conversation + Draft transaction；
- 自动调用 `dayloom init/plan/play/revise`；
- 自动 settle / abandon；
- 新 shared agent/runtime package；
- 为工具存在与否建立领域状态。

如果未来出现真实失败案例，再针对那个具体问题增加最小机制。

---

## 17. 冻结标准

重新冻结前只检查五件事是否一致：

```text
command 输入
→ authority
→ Dialogue
→ Draft Sync
→ CLI handoff
```

只要这条主链闭环，V1 就可以实施。

private function 名、文件拆分、prompt 非语义措辞、operation-local 临时目录结构都不冻结。

需要修改设计的只有：

- CLI / command 语义；
- Conversation / World / Draft authority；
- Dialogue → Sync 顺序；
- play agency；
- Draft projection；
- failure / persistence；
- caller-visible output。