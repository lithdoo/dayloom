# `@dayloom/draft-assistant` V1 设计

> 状态：**Review-ready V1（重新推导，待复核后冻结）**（2026-09-01）  
> 范围：`packages/draft-assistant`  
> 目标：作为 Dayloom 的 Conversation → Draft 客户端，完整支持 `init / plan / play / revise` 的对话与 Draft 同步，同时把 Draft → Archive 的提交权完整留给 `@dayloom/cli`。

---

## 1. 系统边界

Dayloom 已冻结的主边界是：

```text
Conversation
    ↓
Draft
    ↓
@dayloom/cli
    ↓
Patch
    ↓
Archive
```

职责固定：

```text
Conversation → Draft
= 客户端职责
= draft-assistant 的范围

Draft → Archive
= CLI 职责
= draft-assistant 不拥有
```

因此：

- Conversation 是用户与 Assistant 的 authoritative interaction history；
- Draft 是当前 command 下 Conversation 的有效语义投影；
- Archive / Published World 是 canonical state；
- `draft-assistant` 不 publish、settle、创建 Patch，也不直接修改 Archive；
- `init` 形成初始 Draft 时还没有 World 输入；World 目录只在后续 `dayloom init <world> ...` 时由调用方指定。

V1 不追求与旧 `dayloom-draft` 的 CLI 表面完全一致。只在语义相同时复用它的 primitive 和实现风格。

---

## 2. Command 生命周期

四个 command 的输入不是同一种形态：

| command | World 输入 | World 前置状态 | Dialogue 目标 | 下游 CLI |
| --- | --- | --- | --- | --- |
| `init` | 无 | 无 | 形成初始 World 意图 | `dayloom init <new-world> ...` |
| `plan` | 必须 | `idle` | 形成下一日 / 下一阶段计划 | `dayloom plan <world> ...` |
| `play` | 必须 | `planned` | 在当前计划内交互式推进 | `dayloom play <world> ...` |
| `revise` | 必须 | `idle` | 形成长期 World revision | `dayloom revise <world> ...` |

`init` 与其他三个 command 的差别来自真实生命周期，不建立额外 stage state。

`draft-assistant` 不自动执行下游 CLI，也不自动切换 command。

---

## 3. CLI contract

### 3.1 Grammar

`init`：

```text
dayloom-draft-assistant [init]
  (--draft <path>... | --draft-dir <path>)
  --conversation <path>
  --llm-config <path>
  --message <text>
  [--output-format terminal|stream-json]
```

`plan / play / revise`：

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
- unknown argument / duplicate singleton option fail-closed；
- one invocation = one user message。

World 规则：

- 显式 `init` 不接受 `--world`；
- 显式 `plan / play / revise` 必须提供 `--world`；
- world-bound command 的 World 必须是合法 Published World，并满足当前 lifecycle availability。

### 3.2 command 省略时

command 仍可省略，但推导规则按输入形态固定：

```text
无 --world
→ init

有 --world
→ 只在 plan / play / revise 中按 Published World availability 推导
```

因此：

- planned World → 唯一推导为 `play`；
- idle World → `plan / revise` 同时可用，报 ambiguous；
- missing / uninitialized / invalid World → 不推导为 `init`，直接失败。

`init` 不通过一个预先指定的 World path 来判断可用性。真正的 init publication guard 由后续 `@dayloom/cli init <world>` 负责。

---

## 4. Authority matrix

这是 V1 的核心安全边界：

| command | React | Conversation | World | Draft |
| --- | --- | --- | --- | --- |
| `init` | Dialogue | RW | NONE | NONE |
| `init` | Draft Sync | RO | NONE | RW |
| `plan/play/revise` | Dialogue | RW | RO | NONE |
| `plan/play/revise` | Draft Sync | RO | RO | RW |

含义：

- Dialogue 永远不能读取或修改 Draft；
- Draft Sync 是唯一拥有 Draft RW 的 React；
- World-bound command 的 World 永远 RO；
- `init` 根本没有 World 输入，而不是“World missing 模式”。

这张表只描述 Dayloom 的 World / Draft 文件 authority。

它不规定 Promptpile React 是否还拥有搜索、压缩或其他非 World/Draft 能力；这些能力不得扩大本表定义的 authority。

---

## 5. 双 React 架构

每次 invocation 固定：

```text
User message
    ↓
Dialogue React
    ↓
accepted Final → Conversation
    ↓
Draft Sync React
    ↓
Draft
```

拆成两条 React 是必要复杂度，因为对应两个真实语义/authority domain：

```text
Dialogue
= 与用户对话并形成可接受回复

Draft Sync
= 把已接受 Conversation 投影到 Draft
```

不引入 Session framework、persisted FSM、pending turn、recovery coordinator 或 Conversation + Draft 联合事务。

---

## 6. Dialogue React

### 6.1 React contract

固定：

```toml
[promptpile-react]
max_step = 4
max_step_policy = "error"
observe_carryover = 1
```

`observe_carryover = 1` 只用于当前 reply 的内部 repair。

达到 `max_step` 且 Check 仍要求继续时必须 fail-closed：不执行成功 Final，进程 non-zero。

### 6.2 Thought

Thought MUST：

- 遵守当前 command policy；
- 以 Conversation 为当前交互依据；
- world-bound command 可读取 World，但只能作为 canonical baseline；
- `init` 不假设存在任何 World；
- 不访问 Draft；
- 把最近的 carryover Observe 作为 repair context，而不是新的事实来源。

### 6.3 Observe / Check / Final

Observe 固定产出：

```text
[REVIEW]
<none>，或说明当前回复的问题与下一轮修正方向

[USER_REPLY]
通过审查、准备发送给用户的回复；仍需修正则为 <none>

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
→ USER_REPLY = exact approved response
→ SHOULD_CONTINUE = false
```

Check 只把 latest Observe 的 `[SHOULD_CONTINUE]` 映射为 `react_check_decision`，不承担业务评审。

Final MUST 逐字输出 latest approved `[USER_REPLY]`，不得再改写、补充或推进剧情。

### 6.4 command policy

`init`：

- 收敛 premise、rules、style/tone、user role、starting entities 等初始意图；
- 不读取 World；
- 不因为“初始化”而写小说正文或推进故事时间；
- Assistant 建议不自动成为用户确认。

`plan`：

- 以 Published World 为 canonical baseline；
- 收敛下一日 / 下一阶段的目标、场景、beat 与约束；
- 计划讨论不能被当作已发生剧情；
- 未经用户确认，不替用户决定关键计划。

`play`：

```text
用户拥有：
  用户角色的 material action / choice / intention / private thought

Assistant 拥有：
  NPC 行为
  environment
  用户行动的 immediate/direct consequence
```

Assistant 只能推进到下一个需要用户做 material decision 的节点，然后停止等待用户。

Observe 必须 repair：

- 替用户角色决定 material action / choice / intention / private thought；
- 越过新的 material decision point；
- 用 play outcome 擅自改写长期 canon/profile。

`revise`：

- 以 Published World 为 canonical baseline；
- 收敛用户希望长期修改的 canon/state/entity/memory 意图；
- 不把候选修改描述成已经写入 World。

---

## 7. Draft Sync React

### 7.1 React contract

固定：

```toml
[promptpile-react]
max_step = 6
max_step_policy = "error"
observe_carryover = 1
```

Sync 不与用户对话，不向 authoritative Conversation 写入 Thought / Observe / Final。

### 7.2 Projection contract

总目标：

```text
Draft = 当前 command 下 Conversation 的有效语义投影
```

| command | projection |
| --- | --- |
| `init` | 当前仍成立的初始化用户意图 |
| `plan` | 当前仍成立的计划意图 |
| `play` | 用户明确行动/选择 + 已接受的 NPC/environment/direct consequence |
| `revise` | 当前仍成立的长期 revision 用户意图 |

统一不变量：

- latest effective user intent wins；
- 被否定、替换的旧意图不能继续占优；
- Assistant suggestion alone 不是用户确认；
- `play` 中 Assistant 虚构的用户行动永远不能写成 user action；
- accepted NPC / environment outcome 可以进入 play Draft；
- play outcome 不构成长线 canon/profile revision 授权；
- World-bound command 的 World 是 canonical baseline，只读；
- Draft 只能通过 granted Draft tools 修改；
- Draft 是后续 CLI 的语义输入，不是 Archive mutation DSL。

Conversation 可以跨 command 继续使用；当前 command 决定本次 projection scope。旧 command 的历史可以提供上下文，但不能因为仍在 Conversation 中就自动保留为当前 Draft 内容。

### 7.3 Observe

固定产出：

```text
[REVIEW]
<none>，或当前 Draft 与有效语义仍存在的具体不一致

[SHOULD_CONTINUE]
true | false
```

已收敛为 `false`；仍需 repair 为 `true`。

对相同 Conversation + World（如有）+ 已收敛 Draft 重跑，应保持语义幂等。

Sync Final 没有产品语义，stdout 被内部丢弃。

---

## 8. Promptpile / file runtime wiring

### 8.1 React argv

Dialogue：

```text
promptpile-react
  --config <operation>/dialogue/config.toml
  -d <conversation>
  --output-dir <conversation>
  --continue
  --output-format <caller terminal|stream-json>
  --max-step 4
  --max-step-policy error
  --observe-carryover 1
  --work-root <operation>/dialogue/work
```

Draft Sync：

```text
promptpile-react
  --config <operation>/sync/config.toml
  -d <conversation>
  --output-format terminal
  --max-step 6
  --max-step-policy error
  --observe-carryover 1
  --work-root <operation>/sync/work
```

Sync MUST NOT 使用 `--output-dir <conversation>` 或 `--continue`。

### 8.2 Dayloom file runtime

V1 复用 `@dayloom/draft` 的 file runtime，只做一个真实需要的泛化：Draft authority 可为空，以支持 world-only Dialogue。

```ts
startFileRuntimeV1({
  worldRoot: string | null,
  draft: DraftAuthorityV1 | null,
  ...
})
```

需要支持的组合：

```text
init Dialogue
  no Dayloom file runtime

init Sync
  worldRoot = null
  draft     = RW
  → draft-only runtime

plan/play/revise Dialogue
  worldRoot = World
  draft     = null
  → world-only RO runtime

plan/play/revise Sync
  worldRoot = World
  draft     = RW
  → world RO + draft RW runtime
```

world-only runtime：

- 只导出 `mcp__world__*` read tools；
- 不创建 Draft filesystem server；
- 不导出任何 `mcp__draft__*`；
- policy 中任何 Draft call fail-closed。

不新增 `worldRoot=null + draft=null` 的 file-runtime 模式。

### 8.3 tools/config 不是领域 authority

`tools_file`、`after_hook` 等属于 Promptpile wiring，不是 Dayloom 的业务 authority 定义。

因此文档只冻结：

```text
init Dialogue
→ 不得暴露任何 World/Draft file tool

world-bound Dialogue
→ 可暴露 World RO file tools
→ 不得暴露 Draft tools
```

当前 Promptpile 若要求 Thought 有合法 tools definition，实现可生成 operation-local tool configuration；其中不得出现未授权的 Dayloom World/Draft tools。

未来增加搜索、压缩等能力，不改变本设计的 World/Draft authority matrix。

---

## 9. Invocation lifecycle

顶层保持直接顺序：

```text
1. parse argv
2. resolve command + World requirement
3. world-bound command: validate Published World + lifecycle availability
4. resolve Draft / Conversation / LLM authority
5. resolve Promptpile binaries + caller LLM config
6. create invocation operation root

7. prepare Dialogue config / tools
8. world-bound command: start world-only file runtime
9. append User → Conversation
10. run Dialogue React
11. accepted Final persists → Conversation
12. close Dialogue file runtime（如有）

13. start Draft Sync file runtime
      init: draft-only
      other: world+draft
14. prepare Sync config
15. run Draft Sync React
16. close Sync runtime
17. cleanup operation root / return status
```

任一时刻只存在当前阶段所需的 Dayloom file runtime。Dialogue 运行期间不存在 Draft RW runtime。

---

## 10. Failure / output contract

V1 不伪造 Conversation + Draft 跨文件系统事务。

| failure | Conversation | Draft | exit |
| --- | --- | --- | --- |
| pre-Dialogue setup | 不变 | 不变 | non-zero |
| append User | fail-closed | 不变 | non-zero |
| Dialogue / max-step | User 可能已存在；无伪造 Assistant Final | 不变 | non-zero |
| Dialogue success | User + Assistant Final 已提交 | 原状态 | 继续 Sync |
| Sync setup | 已提交，不 rollback | 原状态 | non-zero |
| Sync / max-step | 已提交，不 rollback | 可能 stale / partial | non-zero |

成功固定为：

```text
exit 0
= append User + Dialogue + Draft Sync 全部成功
```

Dialogue Final 一旦持久化，就是有效 interaction history；后续 Sync 失败不回滚它。

`--output-format` 只描述 Dialogue 的用户可见输出。Sync stdout / React events / Final 不进入用户 stdout，也不进入 authoritative Conversation。

`stream-json` 直接转发 Dialogue React 的事件，因此其 `session.completed` 只表示 Dialogue React 完成；整个 `draft-assistant` invocation 的最终成功仍以进程 exit code 为准。V1 不为此增加第二套 Dayloom event envelope。

---

## 11. 复用边界

语义优先于代码复用。

不能直接复用：

- `@dayloom/draft parseArgvV1`：它要求 `--world` 全局存在；
- `@dayloom/draft resolveDraftCommandV1`：它会把 uninitialized World 推导为 `init`。

`draft-assistant` 自己实现小而直接的 argv / command resolver。

应复用：

- `@dayloom/cli` 的 `classifyWorldV1` / `availableMutationCommandsV1`，用于 world-bound command；
- `@dayloom/draft` 的 Promptpile binary resolution；
- LLM config reader / derived config primitive；
- Conversation append primitive；
- process helpers；
- Draft path canonicalization / authority rules；
- file runtime / hook / authority policy。

如果现有 `@dayloom/draft` public surface 没有导出实际需要的 primitive，只导出这些 named primitives / types；不要按文件整体扩大 public API，也不要复制实现到 `draft-assistant`。

现有 authority helper 若把 World 与 Draft 绑定在一个 resolver 中，应最小拆出可复用的 Draft / Conversation / LLM path resolution，而不是为 `init` 制造假的 World path。

---

## 12. Package / dependency

`@dayloom/draft-assistant` V1 是完整 CLI package：

```text
bin: dayloom-draft-assistant
build
test
prepack
files: dist + doc + README.md + package.json
node >= 20
```

Promptpile React 固定使用：

```text
promptpile-react = 0.1.0-beta.7
```

依赖的能力：

- file-native `observe_carryover`；
- `max_step_policy = "error"`。

不需要 Promptpile React beta.8，也不要求修改 Promptpile React 的 tool protocol。

由于 Promptpile binary 由 `@dayloom/draft` 的 boundary resolver 从自身 dependency tree 解析，实现必须同步把 `@dayloom/draft` 的 `promptpile-react` pin 到 beta.7。

---

## 13. Complete acceptance matrix

V1 完整实现必须覆盖：

### CLI

- explicit `init` without `--world`；
- `init + --world` rejected；
- explicit `plan/play/revise` without `--world` rejected；
- omitted command + no `--world` → `init`；
- omitted command + planned World → `play`；
- omitted command + idle World → ambiguous；
- supplied missing/uninitialized/invalid World 不得推导成 `init`；
- explicit world-bound command availability；
- Draft file-set / draft-dir / argv / terminal / stream-json / help / version。

### Authority

- init Dialogue 暴露 0 个 Dayloom World/Draft file tool；
- init Sync 只有 Draft RW；
- world-bound Dialogue 只有 World RO，无 `mcp__draft__*`；
- world-bound Sync 为 World RO + Draft RW；
- World write fail-closed；
- Draft file-set / directory / path escape / symlink / create-write-delete 边界；
- generic/non-Dayloom tools 不得扩大 World/Draft authority。

### Dialogue

- 四个 command 正常 turn；
- phase drift → Observe repair；
- carryover repair；
- max-step fail-closed；
- Final 与 approved `[USER_REPLY]` 逐字相等；
- init 无 World 输入；
- plan/play/revise 可读取 World RO。

### Play

- 不替用户角色决定 material action / choice / intention / private thought；
- NPC / environment / direct consequence 允许；
- 在新的 material decision point 前停止；
- invented user action 被 repair；
- accepted NPC/environment outcome 可进入 Draft；
- invented user action 不进入 Draft；
- play outcome 不升级为 canon/profile revision permission。

### Draft Sync

- 四个 command projection matrix；
- initial / incremental projection；
- changed mind / negation / replacement；
- contextual confirmation；
- Assistant suggestion 未确认不进入 Draft；
- play accepted outcome；
- 跨 command 复用 Conversation 时不把旧 command 语义误保留为当前 projection；
- 语义幂等；
- max-step fail-closed。

### Failure / process

- pre-Dialogue setup / append / Dialogue / Sync setup / Sync execution；
- Dialogue commit 后 Sync failure 不 rollback；
- 两个 runtime 按阶段顺序持有；
- Dialogue 期间不存在 Draft RW runtime；
- Sync stdout/event 不可见；
- process exit 只在两条 React 都成功时为 0。

### Real E2E

至少覆盖：

```text
init:
  no --world
  multi-turn Conversation
  → Init Draft
  → dayloom init <new-world> --draft ... --check

plan:
  idle Published World
  → Plan Draft
  → dayloom plan <world> --draft ... --check

play:
  planned Published World
  → Play Draft
  → dayloom play <world> --draft ... --check

revise:
  idle Published World
  → Revise Draft
  → dayloom revise <world> --draft ... --check
```

以及真实 Promptpile React 的 carryover repair、max-step fail-closed、连续 invocation 使用同一 Conversation / Draft，并保持现有 `@dayloom/draft` 完整回归测试通过。

---

## 14. 非目标

V1 不做：

- 自动调用 `dayloom init/plan/play/revise`；
- 自动 settle / abandon；
- 自动 stage transition；
- Conversation stage metadata；
- persisted assistant state；
- exactly-once turn protocol；
- structured intent event log；
- confirmation DSL；
- public recovery API；
- Conversation + Draft transaction；
- 新 agent framework；
- 复制 `@dayloom/draft` runtime；
- 把 Promptpile tools wiring 当作 Dayloom domain authority；
- 为 `init` 创建假的 World / missing-World 模式。

---

## 15. 冻结门槛

本版从系统边界重新推导，暂不继续沿用旧文档的 Frozen 标记。

重新冻结前必须确认以下五项互相一致：

```text
1. Conversation → Draft 与 Draft → Archive 的 ownership
2. command lifecycle / CLI 输入
3. authority matrix
4. runtime wiring
5. Complete acceptance matrix
```

冻结后允许调整 private function、文件拆分和 prompt 非语义措辞；以下变化必须先修改设计：

- command / CLI surface；
- World / Draft / Conversation authority；
- Dialogue → Conversation → Draft Sync 顺序；
- play agency / narrative / canon policy；
- projection semantics；
- Observe / Check / Final contract；
- Promptpile persistence / max-step assumptions；
- failure / output semantics；
- acceptance behavior。
