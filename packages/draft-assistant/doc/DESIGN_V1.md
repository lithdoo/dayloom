# `@dayloom/draft-assistant` V1 设计

> 状态：**Implemented V1（实现与真实 API 验收已闭环）**
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
- `@dayloom/cli` 独占 Draft → Archive 的 mutation / validation / publication。

V1 不建立新的 Session、stage store、transaction、recovery protocol 或 agent framework。

`--conversation` 是调用方提供的 Promptpile Conversation。V1 负责同一 command 下的多轮连续性，不定义 command 切换时必须复用或必须更换 Conversation 目录，也不为此增加 metadata。

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
- one invocation = one user message；
- `--help` / `--version` 在不启动 React 的情况下完成。

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

`--world` 指向 Dayloom Archive，不是给 LLM 直接浏览的普通 World 文档目录。

world-bound command 的 setup：

```text
Archive
  ↓ classify / read Published head once
  ↓ materialize that head.tree
operation-local World view
```

这个 World view：

- 是本次 invocation 读到的 Published World 文档临时副本；
- 只读；
- 不包含 `manifest.json / current.json / commits / objects / operations / .locks` 等 Archive protocol 文件；
- invocation 结束即删除；
- 只用于 Dialogue grounding。

`draft-assistant` 通过 `@dayloom/archive-protocol` 在自己的 package boundary 内校验 Published head、tree 与 blob identity，并只物化 tree documents。它不依赖 `@dayloom/cli` 或 `@dayloom/draft` 的运行时代码，也不复制它们的产品层 orchestration。

`init` 没有 Published World，因此不建立 World view。

这里的“read once + materialize that head”只是单次 invocation 内直接复用同一个已读取对象，不建立跨 invocation base pin、Session pin 或持久化 World snapshot。

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

Draft Sync 不再次读取 World。它只投影已经被 Dialogue 接受并写入 Conversation 的语义，避免第二处重新解释 World。

这张表只约束 Dayloom 的 World / Draft 文件 authority，不把 Promptpile 的 `tools_file` 或未来通用工具定义成领域状态。

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
```

规则：

```text
invalid
→ REVIEW != <none>
→ USER_REPLY = <none>

valid
→ REVIEW = <none>
→ USER_REPLY = exact approved reply
```

Observe 不输出 continuation flag，避免模型把“当前候选是否需要 repair”误解成“未来用户对话是否继续”。Check 从 Observe 结构确定性推导：仅当 `REVIEW` 精确为 `<none>` 且 `USER_REPLY` 非 `<none>` 时调用 `react_check_decision(false)`；其他、矛盾或 malformed 结果一律 continue repair。

只有 authoritative Conversation 中的 User message 能证明用户 action、choice、intention 或 confirmation。carried Observe、候选 `USER_REPLY` 与 Assistant proposal 都不是用户输入；候选若把不存在的选择归给用户，Observe 必须判为 player-agency violation。

Final 是低自由度 copy phase：MUST 输出 latest approved `[USER_REPLY]`，不得在 Observe 之后重新发挥。

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

- 不冲突的早期有效意图继续保留；
- 后来的否定、替换或修正覆盖它实际改变的旧含义；
- Assistant suggestion alone 不构成用户确认；
- `play` 中 Assistant 虚构的用户行动不得进入 Draft；
- accepted NPC/environment/direct consequence 可以进入 play Draft；
- play outcome 不自动成为长期 canon/profile revision；
- Draft 是给后续 CLI 的创作语义输入，不是 Archive mutation DSL；
- 对已经收敛的 Conversation + Draft 重跑应语义幂等。

Observe：

```text
[REVIEW]
<none> 或当前 Draft 与 Conversation 的剩余不一致
```

Sync Thought 必须使用 Draft tools 完成 projection，普通 prose 不构成写入证据。Prompt 明示 tool root 下获准的相对 Draft path 及其 `existing/missing` 状态：existing file 先读再决定，missing file 在存在已确认语义时直接 `write_file`。Observe 只审计，不调用或模拟工具；prose-only Thought、失败 ToolResult 或缺少 read/write evidence 都必须继续 repair。

Sync Check 只有在整个 Observe 精确为 `[REVIEW]\n<none>` 时停止；任何其他文本、tool syntax、矛盾或 malformed output 都继续。React 成功退出后，父进程还会验证获准 Draft authority 中至少存在一个非空、合法 UTF-8 artifact；否则以 `DRAFT_SYNC_FAILED` fail closed。

Draft Sync 不需要用户可见 Final。其 Final prompt 为空，让 Promptpile React 按原生语义 skip Final；不为一个没有产品语义的阶段再调用一次 LLM。

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

play 的 scene outcome 可以成为本次 play Draft 的事实材料；`@dayloom/cli play` 决定 day artifacts，后续 deterministic settle 决定允许的长期状态变化。Play Dialogue / Draft Sync 不把 scene outcome 自行升级为长期 canon/profile revision。

---

## 9. Runtime wiring

不新建 runtime framework。

package 内部使用一套最小 file runtime glue，统一承载 World RO 与 Draft RW 两种 authority：

```ts
startFileRuntimeV1({
  worldRoot,
  draft: DraftAuthorityV1 | null,
})
```

实际只有三种情况：

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

不新增 `worldRoot=null + draft=null` 的 file runtime，也不新增 runtime provider / manager / shared runtime package。该 glue 不从 `@dayloom/draft` 导入实现。

Promptpile wiring：

- world-bound Dialogue / Draft Sync 使用对应 runtime 生成的 tools + hook；
- init Dialogue 不启动 Dayloom file runtime；V1 当前使用合法的 operation-local empty tools definition，且不配置 `after_hook`；
- 因此共用的 React config writer只需要允许 `after_hook` 为空，不需要上游 Promptpile React 改动。

`tools_file / after_hook` 是运行时 wiring，不是领域 authority。

---

## 10. React invocation 与生命周期

Conversation persistence 必须明确区分：

### Dialogue

```text
-d <conversation>
--output-dir <conversation>
--continue
--output-format stream-json
--max-step 4
--max-step-policy error
--observe-carryover 1
```

Final 成功后由 Promptpile React 原生持久化到 authoritative Conversation。

Dialogue 内部固定消费 Agent Event JSONL。调用方选择 `stream-json` 时原样转发；选择 `terminal` 时父进程捕获事件流，只投影 `session.completed.final.content`，Thought / Observe / Check 永不进入 stdout。

### Draft Sync

```text
-d <conversation>
--output-format terminal
--max-step 6
--max-step-policy error
--observe-carryover 1
```

明确：

```text
NO --output-dir <conversation>
NO --continue
empty Final prompt
stdout captured/discarded
```

因此 Sync 读取 Conversation，但不向它追加 Final。

顶层代码保持顺序可读：

```text
1. parse argv
2. resolve command
3. world-bound command: classify World / check availability
4. resolve Draft / Conversation / LLM authority
5. world-bound command: materialize temporary World view from the already-read head
6. resolve Promptpile boundaries + caller config
7. world-bound command: start World-only Dialogue runtime
8. prepare Dialogue config/tools
9. append User → Conversation
10. run Dialogue
11. Dialogue success → approved Assistant persisted in Conversation
12. close Dialogue runtime（如有）
13. start Draft-only runtime
14. prepare/run Draft Sync
15. verify at least one non-empty UTF-8 Draft artifact
16. close Sync runtime
17. cleanup operation root（debug 模式除外）
18. return exit status
```

`init` 在第 7 步没有 Dayloom file runtime，但仍正常准备合法 Promptpile React config。

不建立额外 coordinator；一个直接的 async function 足够。

---

## 11. Persistence / failure / output

V1 不伪造 Conversation + Draft 事务。

```text
pre-Dialogue setup failure
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

Sync setup/runtime failure
→ Conversation remains committed
→ Draft unchanged
→ non-zero

Sync execution failure
→ Conversation remains committed
→ Draft may be stale/partial
→ non-zero

Sync React reports success but no usable Draft artifact
→ Conversation remains committed
→ DRAFT_SYNC_FAILED
→ non-zero
```

成功：

```text
exit 0
= Dialogue + Draft Sync 都成功
+ Draft postcondition 成功
```

`--output-format` 只控制 Dialogue 的用户可见输出。

- terminal：内部仍运行 stream-json，只输出 approved `session.completed.final.content`；
- stream-json：直接使用 Dialogue React Agent Event Protocol；
- Sync stdout 永远不进入用户 stdout；
- Sync stderr 可在失败时作为 diagnostics 暴露；
- Dialogue 的 `session.completed` 只表示 Dialogue React 完成；整个 `draft-assistant` 是否成功最终看父进程 exit code。

不额外包 Dayloom event envelope。

React 子进程的 cwd 固定在对应 operation-local phase root。`PROMPTPILE_DUMP_LLM=1` 因此只会把 request/response dump 写入临时 operation，而不会污染调用者 cwd。普通运行无论成功失败都清理 operation root；显式设置 `PROMPTPILE_REACT_DEBUG=1|true|yes|on` 时保留成功或失败的完整 operation root，并把真实路径写到 stderr。

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

world-bound command 还必须保证 Archive target 与 Draft、Conversation authority 不重叠，防止 Draft/Conversation 写入 canonical Archive。

`init` 没有 `--world`，因此不制造假的 World path 参与 authority resolution。

---

## 13. Package boundary 原则

`@dayloom/draft-assistant` 不运行时依赖 sibling product package `@dayloom/cli` 或 `@dayloom/draft`。它只依赖 publishable protocol / Promptpile / MCP packages，并在自己的 boundary 内保留必要的最小 glue：

- Archive classification、Published head validation 与 World view materialization；
- Draft / Conversation canonical authority；
- caller LLM config reader 与 derived React config；
- Conversation append；
- packaged binary resolution 与 process helpers；
- file runtime、hook 与 tool artifact policy。

这些实现只覆盖本 package 的 authority contract，不引入新的 shared framework，也不反向导入 sibling package 的 parser、command resolver 或 orchestration。与 `@dayloom/cli` 的闭环发生在公开 Draft handoff，而不是运行时 import。

---

## 14. Package / dependency

`@dayloom/draft-assistant` 是完整 CLI package：

```text
bin: dayloom-draft-assistant
node >= 20
scripts: build / test / prepack
files: dist / doc / README.md / package.json
version: 与当前 Dayloom beta line 对齐
```

monorepo root 的 `build` / `test` 必须包含 `@dayloom/draft-assistant`。

package root 的 public API 只导出：

```ts
executeDraftAssistantV1
DraftAssistantDependenciesV1
DraftAssistantRunResultV1
```

其中后两项仅为 TypeScript type；runtime export 只有 `executeDraftAssistantV1`。内部 authority、runtime、prompt 和 process helper 不属于公共 API。

Promptpile React 固定使用已经验证的：

```text
promptpile-react = 0.1.0-beta.7
```

依赖的能力：

```text
observe_carryover
max_step_policy = error
Final observation handoff
empty Final prompt skip
```

不要求 Promptpile React beta.8，也不修改 Promptpile React tool protocol。

boundary resolver 只从 `@dayloom/draft-assistant` 自己的 dependency tree 解析 packaged binaries；`promptpile-react` 必须在本 package 精确 pin 到 beta.7。packed fresh-install smoke 必须证明仅安装本 package 及 publishable dependency closure 即可运行，不需要 `@dayloom/cli` 或 `@dayloom/draft`。

---

## 15. Complete acceptance

实现完成至少证明以下闭环：

### CLI / package

- init 无 `--world`；
- init + `--world` rejected；
- plan/play/revise 必须有 `--world`；
- command inference / ambiguity / availability；
- draft files / draft-dir，包括 prospective Draft file 与 empty Draft dir；
- terminal / stream-json；
- terminal 只投影 approved Final，内部 phase 不泄漏；
- help / version；
- package build / test / prepack / bin smoke；
- monorepo root build / test。

### Authority / World view

- init Dialogue 暴露 0 个 Dayloom World/Draft file tool；
- world-bound Dialogue = materialized World view RO only；
- World view 不含 Archive protocol files；
- Sync = Draft RW only；
- World write denied；
- Draft path / symlink escape denied；
- Archive target 与 Draft / Conversation overlap denied。

### Dialogue

- init / plan / play / revise；
- drift → Observe repair；
- `observe_carryover=1` repair；
- max-step fail closed；
- Final == approved `[USER_REPLY]`；
- 同一 command 多 invocation 使用同一 Conversation 可连续对话。

### Draft Sync

- 四 command projection；
- initial / incremental projection；
- changed mind / negation / replacement；
- 不冲突的旧意图仍保留；
- contextual confirmation；
- Assistant suggestion 未确认不进入 Draft；
- play accepted outcome 可进入 Draft；
- invented user action 不进入 Draft；
- semantic idempotence；
- exact Draft relative path / missing file direct write；
- prose-only Sync 不得被当成写入成功；
- exit 0 前必须存在非空、合法 UTF-8 Draft artifact；
- Sync Final 确认被 skip；
- Sync 不修改 authoritative Conversation。

### Failure / output

- pre-Dialogue setup / append / Dialogue / Sync setup / Sync execution；
- Dialogue committed 后 Sync failure 不 rollback；
- Sync output hidden；
- stream-json 的 Dialogue `session.completed` 后若 Sync 失败，父进程仍 non-zero；
- exit 0 only after both Reacts succeed and the Draft postcondition passes；
- `PROMPTPILE_DUMP_LLM` 输出隔离在 operation root；
- debug 模式成功/失败现场路径真实存在，普通模式自动清理。

### E2E

先用 `--check` 做 Draft snapshot / lint 的廉价验证；真正的 Draft → CLI 闭环必须用 `--dry-run`，因为 `--dry-run` 才会把 Draft 应用到 temporary Workspace、执行 validation/repair 并形成 validated Patch，而不 publish。

至少覆盖：

```text
init:
  no --world
  multi-turn Conversation
  → Init Draft
  → dayloom init <fresh-world> --draft ... --dry-run

plan:
  idle Published World
  → Plan Draft
  → dayloom plan <world> --draft ... --dry-run

play:
  planned Published World
  → Play Draft
  → dayloom play <world> --draft ... --dry-run

revise:
  idle Published World
  → Revise Draft
  → dayloom revise <world> --draft ... --dry-run
```

同时保留真实 Promptpile React carryover repair、max-step fail-closed，以及现有 `@dayloom/cli` / `@dayloom/draft` 回归测试。

默认测试使用真实 Promptpile React / MCP runtime 和确定性 LLM stub，覆盖四个 command 与语义边界；packed fresh-install smoke 验证发布闭包。外部 API 验收使用 `examples/dayloom-tui/llm.toml` 完成 `init` 多轮 Dialogue → tool-backed Sync → UTF-8 Draft → CLI `--check` → 生产 LLM editor `--dry-run`，并确认 dry-run 不创建或发布 World。外部 API smoke 不作为普通 PR 的必跑测试，避免密钥、费用和供应商波动进入 hermetic CI。

---

## 16. 明确不做

V1 不做：

- Session class / manager；
- persisted FSM；
- command/stage metadata；
- pending turn / pending sync；
- base-commit pin protocol；
- 跨 invocation recovery state；
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
