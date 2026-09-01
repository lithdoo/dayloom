# `@dayloom/draft-assistant` V1 设计

> 状态：**Frozen V1（Dayloom-side；Promptpile React max-step dependency pending）**（2026-09-01）  
> 范围：`packages/draft-assistant`  
> 目标：在保持 `dayloom-draft` CLI 与实现风格兼容的前提下，把“用户对话”和“Draft 更新”拆成两条职责单一的 Promptpile React 流程，并完整实现 `init / plan / play / revise`。

---

## 1. 设计原则

`draft-assistant` 延续现有 `@dayloom/draft` 的实现取向：

- 只抽象真实存在的边界；
- 优先复用已有 primitive，不复制已有规则；
- 不引入独立 Session framework、状态机、repository/service 层；
- 不为尚未出现的恢复场景预先增加 public API；
- 不新增 Dayloom-owned runtime state，只使用已有 Conversation / Draft / World；
- 复杂度只允许出现在真实安全边界，例如 path authority、MCP tool authority 和 Promptpile runtime integration。

核心数据层级：

```text
Conversation
    ↓
Draft
    ↓
World
```

含义：

```text
Conversation = authoritative interaction history
Draft        = 当前 command 下 Conversation 的有效语义投影
World        = CLI lifecycle 后的 canonical state
```

V1 是完整实现，不以 vertical slice / MVP 为完成标准。

---

## 2. 核心架构

现有 `@dayloom/draft` 本质上是一条同时负责对话与 Draft 编辑的 React：

```text
User message
    ↓
Single Promptpile React
    ↓
理解用户意图 + 读取 World + 修改 Draft
    ↓
Final
```

`draft-assistant` V1 固定拆成两条顺序 React：

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
  World        RO（存在时）/ NONE（尚未存在时）
  Conversation RW（通过 Promptpile）
  Draft        NONE

Draft Sync React
  World        RO（存在时）/ NONE（尚未存在时）
  Conversation RO
  Draft        RW
```

Promptpile React 保持通用，不知道 `init / plan / play / revise` 的业务语义；command policy 由 Dayloom prompt contract 提供。

---

## 3. CLI contract

V1 参数面与现有 `dayloom-draft` 保持兼容：

```text
dayloom-draft-assistant [init|plan|play|revise]
  --world <path>
  (--draft <path>... | --draft-dir <path>)
  --conversation <path>
  --llm-config <path>
  --message <text>
  [--output-format terminal|stream-json]
```

规则固定：

1. command 可显式指定 `init | plan | play | revise`；
2. 未显式指定时，通过当前 World 状态推导可用 command；
3. `--world`、`--conversation`、`--llm-config`、`--message` 必填；
4. `--message` 不可为空；
5. `--draft` 可重复；
6. `--draft` 与 `--draft-dir` 互斥且必须二选一；
7. `--output-format` 默认 `terminal`；
8. unknown argument / duplicate singleton option / unavailable explicit command 均 fail-closed；
9. argv、command availability、path canonicalization、authority resolution 与 Promptpile binary resolution 直接复用 `@dayloom/draft` public primitive。

外部语义固定为：

```text
one invocation = one user message
```

内部双 React 对调用方透明。

---

## 4. Command policy

command 同时决定 Dialogue React 的对话目标和 Draft Sync 的投影目标。V1 不为 stage 建立额外 TypeScript domain model，直接在 prompt 中按 command 分支。

### `init`

目标：收敛初始化 World 所需的用户意图。

禁止：

- 未完成初始化就推进故事时间；
- 自顾自写场景或小说正文；
- 提前进入 `plan`；
- 将 Assistant 自己的建议视为用户确认。

### `plan`

目标：收敛下一日 / 下一阶段的用户计划意图。

禁止：

- 把计划讨论当成已经发生的剧情；
- 未经用户确认自行决定关键目标、场景或行为。

### `play`

目标：在当前 World 与计划约束下进行交互式叙事推进。

规则固定：

- 用户角色的 material action、choice、intention 与 private thought 只能来自用户；Assistant 不替用户决定；
- Assistant 可以控制符合 World / plan / 已有状态的 NPC、environment 与用户行动的直接 consequence；
- Assistant 只推进到下一个需要用户做 material decision 的节点；
- NPC / environment outcome 可以成为当前 play 的已发生事实并进入 Draft；
- Play outcome 不构成修改长期 canon / profile 的授权；
- 长期 World 变化继续由 Draft 经 `@dayloom/cli` lifecycle 处理；Play 不直接 publish / settle。

Dialogue Observe 必须把替用户决定、越过新的 material decision point 或擅自改写长期 canon 的回复判定为需要 repair。

### `revise`

目标：收敛用户希望长期修改的 World / canon / memory 意图。

禁止：

- 把候选修改视为已经写入 World；
- 绕过 Draft / CLI lifecycle 直接变更 Archive。

---

## 5. Dialogue React

### 5.1 Authority

```text
World           RO（存在时）/ NONE（尚未存在时）
Conversation    RW（通过 Promptpile）
Draft           NONE
```

工具层必须保证 Dialogue React 的 tool set 中不存在任何 `mcp__draft__*`。这是 infrastructure authority，不是 prompt-only 约束。

当 World 尚未存在时，Dialogue 没有任何文件工具 authority；这种情况不启动 MCP runtime，也不构造空 tool set。

### 5.2 React contract

固定：

```toml
[promptpile-react]
max_step = 4
observe_carryover = 1
```

`observe_carryover = 1` 用于 repair：

```text
Thought₀
  ↓
Observe₀ 发现问题并给出修正方向
  ↓
Check₀ = continue
  ↓
Thought₁ 看到 Observe₀
  ↓
修正
```

不修改 Promptpile React Check protocol。

### 5.3 Prompt contract

Thought MUST：

- 遵守当前 command policy；
- World 存在时只把它作为只读事实依据；
- 不访问 Draft；
- 把 carryover Observe 视为历史评审与 repair context；
- 当前轮始终以最新 Conversation 与当前目标为准。

Observe MUST 严格产出：

```text
[REVIEW]
<none>，或说明当前回复的问题以及下一轮应如何修正。

[USER_REPLY]
通过审查、准备发送给用户的回复；若仍需修正则为 <none>。

[SHOULD_CONTINUE]
true | false
```

判定规则固定：

```text
invalid reply
→ REVIEW != <none>
→ USER_REPLY = <none>
→ SHOULD_CONTINUE = true

valid reply
→ REVIEW = <none>
→ USER_REPLY = exact approved response
→ SHOULD_CONTINUE = false
```

`SHOULD_CONTINUE` 只表示当前 reply 是否仍需内部修正，不表示整个 `init / plan / play / revise` 是否完成。

Check MUST 只依据 latest Observe：

```text
true  → react_check_decision({ decision: true })
false → react_check_decision({ decision: false })
```

Check 不产生业务 feedback。

Final MUST：

```text
Final output == latest approved Observe 的 [USER_REPLY]
```

逐字交付，不重新改写、补充、格式化，也不引入新的事实、决定、问题、计划或剧情推进。

---

## 6. Draft Sync React

Dialogue Final 成功并持久化进入用户 Conversation 后，立即运行独立 Draft Sync React。

### 6.1 Authority

```text
Conversation    RO
World           RO（存在时）/ NONE（尚未存在时）
Draft           RW
```

Draft RW 严格受 `--draft` / `--draft-dir` authority 限制。Draft Sync 不向用户 Conversation 写入任何 Thought / Observe / Final。

### 6.2 Projection contract

总目标固定为：

```text
根据当前 command，把 Conversation 中仍然有效的语义投影到 Draft。
```

command 语义矩阵：

| command | Draft Sync 投影 |
| --- | --- |
| `init` | 当前仍然成立的初始化用户意图 |
| `plan` | 当前仍然成立的下一日 / 下一阶段计划意图 |
| `play` | 用户明确行动 / 选择 + 已接受的 NPC / environment / direct consequence |
| `revise` | 当前仍然成立的长期 World revision 用户意图 |

统一规则：

```text
Assistant suggestion alone      → never authoritative
user rejection / replacement    → old meaning removed
accepted play world outcome      → may enter play Draft
Assistant-invented user action   → never becomes user action
play outcome                     → never implies canon/profile revision permission
```

保留现有 `@dayloom/draft` 的不变量：

1. Draft 是 `@dayloom/cli` 的后续语义输入，不是 World mutation DSL；
2. World 存在时只读；
3. Draft 必须反映当前 command 下 Conversation 的有效语义；
4. 被否定或替换的旧语义不能继续占优；
5. Assistant 自己的建议不等于用户确认；
6. 只能写 granted Draft authority；
7. Draft 改动只能通过授权工具发生。

V1 不增加 confirmation protocol；“可以”“第二个”“就这样”“前面的不要了”等确认语义由 React 从 Conversation 解释，并由测试冻结行为。

### 6.3 React contract

固定：

```toml
[promptpile-react]
max_step = 6
observe_carryover = 1
```

Thought MUST 读取当前 Conversation 与 Draft，必要且 World 存在时读取 World，并通过 Draft tools 把 Draft 收敛到有效语义。

Observe MUST 严格产出：

```text
[REVIEW]
<none>，或说明当前 Draft 与有效 Conversation 语义仍有什么不一致以及应如何修正。

[SHOULD_CONTINUE]
true | false
```

Draft 已收敛时 `false`；仍需修改时 `true`。Draft Sync 本身应趋向幂等：对相同 Conversation + World + 已收敛 Draft 重跑不得产生新的语义变化。

Sync Final 没有用户产品语义，其文本被内部丢弃。

---

## 7. Exact React invocation

两条 React 的进程 wiring 属于 Frozen contract。

### 7.1 Dialogue

等价 argv 固定为：

```text
promptpile-react
  --config <operation>/dialogue/config.toml
  -d <conversation>
  --output-dir <conversation>
  --continue
  --output-format <caller terminal|stream-json>
  --max-step 4
  --observe-carryover 1
  --work-root <operation>/dialogue/work
```

Dialogue stdout / stderr 按现有 `dayloom-draft` 进程转发方式向调用方转发。

`--output-dir <conversation> + --continue` 是唯一把 accepted Final 写回 authoritative Conversation 的路径。

当 Dialogue 没有任何文件 authority 时，`dialogue/config.toml` MUST 不包含 `tools_file` 与 `after_hook`；React invocation 本身不变。

### 7.2 Draft Sync

等价 argv 固定为：

```text
promptpile-react
  --config <operation>/sync/config.toml
  -d <conversation>
  --output-format terminal
  --max-step 6
  --observe-carryover 1
  --work-root <operation>/sync/work
```

Draft Sync MUST NOT 使用：

```text
--output-dir <conversation>
--continue
```

因此 Sync 只读 authoritative Conversation，不向其持久化内部 Final。

Sync stdout 被内部 capture / discard，不得进入用户 stdout。Sync stderr 可内部 capture；失败时向调用方 stderr 提供诊断。

---

## 8. Runtime reuse contract

V1 不复制 `@dayloom/draft` 的 file runtime，也不抽新的 shared runtime package。

实现必须对现有 `@dayloom/draft` runtime 做最小泛化：

```ts
startFileRuntimeV1({
  ...,
  worldRoot: string | null,
  draft: DraftAuthorityV1 | null,
})
```

语义固定：

```text
draft != null
→ 保持现有 @dayloom/draft 行为
→ Draft RW
→ World 存在时同时提供 World RO

worldRoot != null && draft == null
→ 创建 world-only MCP runtime
→ 不创建 draft MCP server
→ 不导出任何 mcp__draft__* tool
→ hook / policy 的 Draft authority 为 null

worldRoot == null && draft == null
→ 不调用 startFileRuntimeV1
→ 不启动 Promptpile MCP gateway
→ 不生成 tools_file / after_hook
→ React 以无文件工具运行
```

`FileHookConfigV1` / authority policy 的 Draft authority改为 nullable；`draft == null` 时任何 Draft tool call 均 fail-closed，即使正常情况下该 tool 不会被导出。

现有 derived React config writer 做最小泛化：tool binding 可选；没有 runtime binding 时省略 `tools_file` 与 `after_hook`，不创建 noop hook 或空 tools file。

`@dayloom/draft` public surface 只增加 `draft-assistant` 实际消费的 named primitives / types，不按文件整体扩大 public contract。预计仅包括已有的：

```text
readLlmConfigV1
writeDerivedReactConfigV1
appendConversationUserV1
runCommandV1 / spawnForwardedV1
startFileRuntimeV1
以及上述函数必需的 public types
```

实现时若某项没有实际调用则不导出。不复制这些实现到 `draft-assistant`，不改变现有 `dayloom-draft` 在 `draft != null` 下的行为。

---

## 9. Invocation lifecycle

顶层流程固定并保持顺序直接：

```text
1. parse / validate argv
2. classify World / resolve command
3. resolve canonical authority
4. resolve Promptpile binaries + LLM config
5. create one invocation operation root
6. prepare Dialogue config
7. World 存在时启动 Dialogue world-only runtime；否则不启动 runtime
8. append user message → Conversation
9. run Dialogue React
10. accepted Dialogue Final persists → Conversation
11. close Dialogue runtime（若存在）
12. prepare + start Draft Sync world+draft runtime
13. prepare Draft Sync config
14. run Draft Sync React
15. close Draft Sync runtime
16. return process status / cleanup operation root
```

所有可能影响 Dialogue 能否启动的 setup MUST 在 append user 前完成。Draft Sync 自身的 runtime / config setup 属于 Sync 阶段，只在 Dialogue 成功提交后发生。

任一阶段只持有该阶段所需 runtime；Dialogue 运行期间不存在 Draft RW runtime。

V1 不引入：

- `DraftAssistant` 长生命周期 class；
- Session abstraction；
- persisted stage metadata；
- pending-turn metadata；
- assistant-owned state machine；
- Conversation + Draft 跨文件系统事务；
- public `syncDraft()` / `resyncDraft()` recovery API。

---

## 10. Failure / output contract

V1 不伪造跨文件系统事务。

| 失败点 | Conversation | Draft | 用户 stdout | exit |
| --- | --- | --- | --- | --- |
| pre-Dialogue setup | 不变 | 不变 | 无 Final | non-zero |
| append user | fail-closed | 不变 | 无 Final | non-zero |
| Dialogue | User 可能已存在；不伪造 Assistant Final | 不变 | 不伪造 Final | non-zero |
| Dialogue success | User + Assistant Final 已提交 | 原状态 | Dialogue Final 有效 | 继续 Sync |
| Draft Sync setup | 已提交，不 rollback | 原状态 | 已产生的 Dialogue 输出仍有效 | non-zero |
| Draft Sync | 已提交，不 rollback | 可能 stale / partial | 已产生的 Dialogue 输出仍有效 | non-zero |
| authority violation | 保留已提交历史 | 不扩大 authority | error diagnostic | non-zero |

进程成功定义固定为：

```text
exit 0
= append user + Dialogue + Draft Sync 全部成功
```

其他情况均 non-zero。V1 不承诺稳定的具体 numeric error code；错误类别通过 stderr / typed internal error 表达。

`--output-format terminal|stream-json` 只描述用户可见 Dialogue 输出。Draft Sync 的 React event / Final 不得污染 stdout，也不得进入用户 Conversation。

用户 Conversation 正常形态始终是：

```text
User
Assistant Final
User
Assistant Final
...
```

Dialogue Final 一旦成功持久化，就是有效 interaction history，即使后续 Draft Sync setup / execution 失败。

---

## 11. Package / dependency contract

`@dayloom/draft-assistant` V1 是与 `@dayloom/draft` 同级的完整 CLI package，而不是仅供内部调用的 library scaffold。

必须提供：

```text
bin: dayloom-draft-assistant
build
完整 test
prepack
files: dist + doc + README.md + package.json
node >= 20
```

包仍可保持 `private`，release policy 不属于本设计冻结范围。

`draft-assistant` 直接依赖 `@dayloom/draft` 并复用其 public primitive；不复制 CLI / authority / runtime 实现。

本设计依赖 Promptpile React 的 file-native Observe carryover。`0.1.0-beta.6` 是当前 carryover baseline；Promptpile React 的 max-step terminal semantics 仍有一个已知外部依赖缺口，见第 15 节。在该缺口解决前，最终可实施的 Promptpile React 版本不在本文冻结。

由于 `resolvePromptpileBoundariesV1()` 从 `@dayloom/draft` 自身依赖位置解析 packaged binary，最终采用兼容版本时 MUST 同步更新并 pin `@dayloom/draft` 的 `promptpile-react` 依赖；不能只在 `draft-assistant` 增加不同版本。

其余 Promptpile / MCP 依赖沿用 `@dayloom/draft` 当前已验证组合，除非实现所需 API 明确要求升级；任何这类升级都必须保持现有 Draft 回归测试通过。

---

## 12. 实现结构

V1 保持扁平，不预先建立子系统目录：

```text
packages/draft-assistant/src/
├── index.ts
├── main.ts
├── run.ts
├── react.ts
├── prompts.ts
└── runtime.ts        # 仅放对 @dayloom/draft runtime 的薄调用；可并入 run.ts
```

如果某文件没有足够独立逻辑，应直接合并；不以“每个概念一个文件”为目标。

职责：

```text
run.ts
= 顶层顺序编排

react.ts
= Dialogue / Sync argv + process wiring

prompts.ts
= 两条 React 的 prompt contracts + command 分支

runtime.ts
= 对 @dayloom/draft startFileRuntimeV1 的薄调用（若有必要）
```

不新增 `stage/`、`dialogue/`、`sync/`、`services/`、`session/` 等目录，除非实现后的真实代码量证明有必要。

Prompts V1 使用 TypeScript 字符串，不增加 package 内 Markdown prompt loader。

Frozen 文档不限制 private function 名、私有类型拆分、文件行数或 prompt 的非语义措辞。

---

## 13. Complete acceptance matrix

V1 只有在下列测试组全部通过后才算完整实现。

### CLI compatibility

- `init / plan / play / revise` 显式 command；
- command 自动推导；
- unavailable explicit command；
- required / duplicate / unknown argv；
- repeated `--draft`；
- `--draft-dir`；
- `--draft` / `--draft-dir` 互斥；
- `terminal`；
- `stream-json`；
- help / version / packaging bin 可运行。

### Dialogue

- 四个 command 均有正常无 drift turn；
- 四个 command 均能识别 phase drift；
- Observe `true` → carryover → Thought repair；
- repair 后 Observe `false`；
- max-step exhaustion 失败；
- Final 与 approved `[USER_REPLY]` 逐字相等；
- Final 不产生 post-check drift；
- `init` 且 World 不存在时 Dialogue 无 MCP runtime / 无 file tools 仍可正常工作。

### Play authority

- 用户行动主权不被 Assistant 夺取；
- NPC reaction 允许；
- environment reaction 允许；
- direct consequence 允许；
- 新 material decision point 前停止；
- Assistant-invented user action 被 Observe repair；
- accepted NPC / environment outcome 可进入 Draft；
- invented user action 不进入 Draft；
- play outcome 不升级成 canon/profile revision permission。

### Draft Sync

- 四个 command 的 projection matrix；
- initial projection；
- incremental projection；
- user changed mind；
- explicit negation；
- replacement；
- “可以 / 第二个 / 就这样”等上下文确认；
- Assistant suggestion 未确认时不进入 Draft；
- play accepted outcome 进入 Draft；
- 已收敛 Draft 重跑语义幂等。

### Authority

- Dialogue tool set 不存在任何 `mcp__draft__*`；
- Dialogue World write fail-closed；
- Draft Sync World write fail-closed；
- Draft file-set authority；
- Draft directory authority；
- path escape；
- symlink escape；
- delete / create / write 边界；
- `worldRoot != null + draft == null` 只导出 World RO tools；
- `worldRoot == null + draft == null` 不启动 MCP runtime、不生成 tool binding；
- no-tool config 不包含 `tools_file` / `after_hook`；
- `draft != null` 不破坏现有 `dayloom-draft` 行为。

### Failure

- pre-Dialogue setup failure 不 append User；
- append-user failure；
- Dialogue child failure；
- Dialogue max-step failure；
- Draft Sync runtime / config setup failure 保留已提交 Dialogue Final；
- Draft Sync child failure；
- Draft Sync partial write failure 不 rollback Conversation；
- Dialogue MCP runtime startup failure；
- Draft Sync MCP runtime startup failure；
- authority violation；
- cleanup / child shutdown。

### Process / output

- Dialogue terminal output 正常转发；
- Dialogue stream-json 正常转发；
- Sync stdout 不可见；
- Sync event 不进入用户 Conversation；
- Sync setup / execution failure 后 Dialogue Final 仍保留；
- Dialogue runtime 在 Sync runtime 启动前关闭；
- Dialogue 运行期间不存在 Draft RW runtime；
- success 仅在两条 React 都成功时 exit 0。

### Real E2E

必须使用真实 packaged Promptpile / Promptpile MCP / filesystem MCP 覆盖：

- `init` 多轮 Conversation → Draft，其中至少一次 World 尚不存在；
- `plan` 多轮 Conversation → Draft；
- `play` 多轮叙事 → Draft；
- `revise` 多轮 Conversation → Draft；
- Promptpile React 的 `observe_carryover=1` repair；
- 连续 invocation 使用同一 `--conversation` / Draft；
- Linux/macOS/Windows 可由现有 CI 能力覆盖的 path / process 行为。

同时必须保持现有 `@dayloom/draft` build 与完整测试集通过。

---

## 14. 非目标

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
- 复制现有 `@dayloom/draft` runtime；
- empty / noop MCP runtime；
- 同时预启动 Dialogue 与 Draft Sync 两套 runtime；
- 删除或替换现有 `@dayloom/draft`。

---

## 15. Frozen V1

Dayloom-side V1 已闭环并冻结：CLI、Conversation / Draft / World authority、双 React 顺序、无工具 init、runtime 生命周期、command 语义、play policy、Draft projection、failure / output 与 package contract 均不再需要产品或架构选择。

唯一已知未闭环项属于 Promptpile React 外部依赖：当前 carryover baseline 的 max-step terminal semantics 与本设计要求的“repair / sync 未完成时 max-step 必须失败”不一致。本文保留该行为要求与 acceptance case，但不在本次 Dayloom-side 修订中规定 Promptpile React 的具体修复方式。

在该外部依赖解决后，实现可以调整内部代码组织与 prompt 非语义措辞，但 MUST 保持本文所有规范性 contract。

以下变化需要先修改本设计再实施：

- CLI surface；
- Conversation / Draft / World authority；
- Dialogue → Conversation → Draft Sync 的顺序；
- command 语义；
- play agency / narrative / canon policy；
- Observe / Check / Final contract；
- React persistence 与 exact invocation semantics；
- runtime 的 optional Draft / no-tool authority 模型；
- runtime 按阶段顺序持有的生命周期；
- failure / output semantics；
- Complete acceptance matrix 的行为要求。

完整实现的判断标准是：Promptpile React 外部依赖满足本文 terminal behavior 后，另一名工程师无需再做产品或架构选择，只需完成代码层面的实现选择，并使第 13 节全部通过。
