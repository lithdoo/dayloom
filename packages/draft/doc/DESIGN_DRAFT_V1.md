# Dayloom Draft V1 — 冻结实施契约

状态：**frozen-for-implementation**

本文档定义 `@dayloom/draft` V1 的冻结实施契约。除非后续明确修改本契约，否则实现应以本文为准。

---

## 1. 目标

`@dayloom/draft` 是一个刻意保持轻薄的 Dayloom 业务封装，底层直接建立在 `promptpile-react` 之上。

它只负责：

- 根据当前 World 状态校验或推导 Dayloom Draft command；
- 将 World 以只读能力暴露给 React agent；
- 将显式选择的 Draft 文件或 Draft 目录以精确读写能力暴露给 React agent；
- 注入 Dayloom 业务 prompt 与 MCP policy；
- 对一条用户消息执行一次 `promptpile-react`；
- 尽量原样转发 React 的 stdout、stderr 与退出状态。

它 **MUST NOT** 再定义一套 Conversation runtime、Session 模型、Memory 系统、Agent protocol 或第二套 orchestration engine。

V1 的核心等式：

```text
@dayloom/draft
=
promptpile-react
+ Dayloom command policy
+ Dayloom business prompts
+ Dayloom MCP authority wiring
```

---

## 2. 唯一主执行路径

V1 **MUST** 只实现一条主路径：

```text
dayloom-draft [command?] [options]
        ↓
解析 CLI 参数
        ↓
分类 World
        ↓
校验或推导 command
        ↓
解析 Draft authority
        ↓
准备 Dayloom prompts
        ↓
准备 MCP capabilities

  World → read-only
  Draft → read-write
        ↓
调用 promptpile-react
        ↓
转发 stdout / stderr
        ↓
返回 React 退出状态
```

一次 `dayloom-draft` invocation **MUST** 对应一次 Promptpile React turn。

V1 **MUST NOT** 在 React 外层再实现独立 Dayloom agent loop。

---

## 3. CLI 契约

### 3.1 语法

```text
dayloom-draft [command] [options]
```

`command` 可选，V1 仅支持：

```text
init
plan
play
revise
```

以下命令不属于 Draft 生成范围，不由本包处理：

```text
settle
abandon
status
verify
```

### 3.2 参数

```text
--world <dir>

--draft <file>
--draft <file> ...
        OR
--draft-dir <dir>

--conversation <dir>
--llm-config <file>
--message <text>

--output-format <text|stream-json>

--help
--version
```

普通 React invocation 中，以下参数 **MUST** 恰好出现一次：

```text
--world
--conversation
--llm-config
--message
```

Draft 输入 **MUST** 二选一：

```text
一个或多个 --draft
```

或：

```text
一个 --draft-dir
```

`--draft` 与 `--draft-dir` **MUST** 互斥。

重复的非 repeatable 参数、未知参数或非法值 **MUST** 在启动 React 前失败。

---

## 4. Command 语义

### 4.1 显式 command

调用方显式传入：

```text
init | plan | play | revise
```

时，该 command 表示用户的明确业务意图，但仍 **MUST** 与当前 World 状态进行校验。

若当前 World 不允许该 command：

```text
requested command
        ↓
current World classification
        ↓
available Draft-driven commands
        ↓
requested command 不可用
        ↓
fail before React
```

实现 **MUST NOT** 自动替换成其他 command。

### 4.2 省略 command

command 可省略，但只能在唯一可推导时自动决定。

定义：

```text
available = 当前 World 可用命令
            ∩
            { init, plan, play, revise }
```

规则：

```text
available.length == 1
→ 自动使用唯一 command

available.length == 0
→ fail

available.length > 1
→ fail: ambiguous command
```

实现 **MUST NOT** 对歧义状态设默认 command。

例如：

```text
uninitialized World
→ available: init
→ infer init

planned World
→ available: play
→ infer play

idle World
→ available: plan, revise
→ ambiguous
→ 必须显式指定
```

### 4.3 不复制 World 状态机

`@dayloom/draft` **SHOULD** 复用 Dayloom 已有的 World classification 与 command availability 逻辑。

若现有逻辑过度耦合在 `@dayloom/cli` 内，实现 **MAY** 抽出最小纯业务模块，例如：

```ts
classifyWorld(...)
availableCommands(...)
```

但 **MUST NOT** 因此重新引入新的 Dayloom Core / Runtime。

---

## 5. World 分类

至少 **MUST** 区分：

```text
missing / uninitialized
valid World
invalid World
```

### 5.1 missing / uninitialized

真正缺失或未初始化的 World **MAY** 使 `init` 成为唯一候选，因此允许自动推导为 `init`。

### 5.2 valid World

有效 World **MUST** 使用 Dayloom 权威规则计算当前可用 command。

### 5.3 invalid World

损坏、不一致或非法 World **MUST** fail closed。

特别是：

```text
invalid World
≠
uninitialized World
```

非法 World **MUST NOT** 被自动推导成 `init`。

---

## 6. Draft 输入与写权限

Draft 参数同时定义：

1. 本轮业务语义输入；
2. Agent 可写的精确 authority boundary。

### 6.1 单文件

```bash
--draft ./draft.md
```

权限：

```text
read:  ./draft.md
write: ./draft.md
```

### 6.2 多文件

```bash
--draft ./intent.md \
--draft ./notes.md \
--draft ./constraints.md
```

`--draft` 可重复。

权限 **MUST** 精确等于显式文件集合：

```text
read/write:
  ./intent.md
  ./notes.md
  ./constraints.md
```

若选择：

```text
draft/intent.md
draft/notes.md
```

则 **MUST NOT** 自动获得：

```text
draft/other.md
draft/secret.md
```

的访问权限。

### 6.3 Draft 目录

```bash
--draft-dir ./draft
```

权限：

```text
read/write: ./draft/**
```

若 MCP 能力允许，V1 **MAY** 在该子树内创建或删除文件，但所有写操作 **MUST** 被限制在该目录子树内。

任何 path traversal 或越界访问 **MUST** fail closed。

---

## 7. World authority

`--world <dir>` 指定当前 Dayloom World，同时也是 command 校验 / 推导的依据。

向 React agent 暴露的 World 能力 **MUST** 为只读：

```text
World
  read  = allowed
  write = forbidden
```

Agent 可按 command 需要检查 canon、control、plan、entity、day artifacts 等内容，但不能修改 World。

只读限制 **MUST** 在实际 MCP/tool boundary 上执行，不能只依赖 prompt。

---

## 8. 与 @dayloom/cli 的边界

两个包刻意保持相反 authority：

```text
@dayloom/draft
  World → RO
  Draft → RW

@dayloom/cli
  Draft → RO semantic input
  World → controlled mutation
```

`@dayloom/draft` 生成或维护的 Draft **MUST** 能直接传给 `@dayloom/cli`，不应存在格式转换步骤。

例如：

```bash
dayloom-draft play \
  --world ./world \
  --draft ./intent.md \
  --draft ./constraints.md \
  --conversation ./conversation \
  --llm-config ./promptpile.toml \
  --message "不要主动攻击守卫"
```

之后可以直接：

```bash
dayloom play ./world \
  --draft ./intent.md \
  --draft ./constraints.md \
  --llm-config ./promptpile.toml
```

目录模式同理。

---

## 9. Conversation ownership

`--conversation <dir>` 指向本轮使用的 Promptpile Conversation。

Conversation 的格式、持久化和生命周期完全属于 Promptpile。

`@dayloom/draft` **MUST NOT** 定义：

- 平行 Conversation 格式；
- Dayloom Session 数据库；
- 重复消息历史；
- Dayloom 私有 turn id；
- 另一套 persistence protocol。

对同一个 Conversation 目录重复调用，应通过 Promptpile 原生语义自然延续上下文。

```bash
dayloom-draft play ... \
  --conversation ./conversation \
  --message "先调查酒馆"

dayloom-draft play ... \
  --conversation ./conversation \
  --message "还是先不要找老板"
```

未来的 compression、archive search、fork 等能力仍应直接组合 Promptpile 生态，而不是被 Dayloom 重新封装。

---

## 10. 用户消息

V1 一次 invocation 接受且只接受一条新消息：

```text
--message <text>
```

Wrapper **MUST NOT** 将一条消息拆成多个隐藏 Dayloom turn，也 **MUST NOT** 额外制造隐藏 user message。

stdin / message-file 暂不属于冻结 V1 CLI；若未来需要，应单独修改本契约。

---

## 11. LLM 配置

```text
--llm-config <file>
```

直接使用 Promptpile / Promptpile React 的 LLM 配置。

Dayloom **MUST NOT** 再定义 provider / model 配置层。

以下继续由 Promptpile 管理：

- provider；
- model；
- base URL；
- API key 环境变量；
- temperature；
- 其他模型参数。

---

## 12. Output 契约

V1 使用：

```text
--output-format <text|stream-json>
```

默认：

```text
text
```

### 12.1 text

```text
--output-format text
```

使用 Promptpile React 正常的人类可读输出行为。

### 12.2 stream-json

```text
--output-format stream-json
```

直接映射 Promptpile React 原生 structured output。

契约：

```text
stdout
→ Promptpile React Agent Event Protocol v1 JSONL

stderr
→ diagnostics / operational errors

exit status
→ React execution status
```

`@dayloom/draft` **MUST NOT** 再定义一层 Dayloom event protocol。

它 **MUST NOT**：

- 重命名 React event；
- 用 Dayloom envelope 包裹 event；
- 暴露隐藏 Thought / Observe / Check 文本；
- 无必要地 parse + reserialize stream。

### 12.3 不提供 channel 参数

V1 **MUST NOT** 增加：

```text
--channel
```

stdout / stderr ownership 已由 Promptpile React 定义。

---

## 13. React 集成

实现 **SHOULD** 尽可能接近一次参数化的 `promptpile-react` invocation。

Dayloom 只提供：

- resolved command；
- Dayloom business prompts；
- World RO capability；
- Draft RW capability；
- caller-provided Conversation；
- caller-provided LLM config；
- caller-provided user message；
- caller-provided output format。

Promptpile React 继续负责：

- Thought；
- Observe；
- Check；
- Final；
- iteration control；
- Agent Event Protocol；
- Conversation persistence behavior。

Dayloom **MUST NOT** 重建这些机制。

---

## 14. Prompt 结构

V1 **SHOULD** 最大化共享 prompt，避免为四个 command 各自复制完整 Thought / Observe / Check / Final。

推荐结构：

```text
prompts/
  thought.md
  observe.md
  check.md
  final.md
  command/
    init.md
    plan.md
    play.md
    revise.md
```

核心组合方式：

```text
shared base behavior
+
command-specific appendix
```

Command-specific 部分可以改变：

- 需要关注的 World context；
- Draft 业务目标；
- completion criteria；
- 业务边界。

但 **SHOULD NOT** 重新定义 React orchestration 语义。

---

## 15. Business prompt 不变量

Dayloom prompt 至少 **MUST** 建立以下规则：

1. Draft 是后续 Dayloom CLI 的 semantic input；
2. Draft 不是 World mutation DSL；
3. World 可以检查但不能修改；
4. Draft 应体现用户当前有效、权威的意图；
5. 已被否定或取代的旧意图不能因为仍存在于 Conversation 中就继续作为权威；
6. 模型自身建议不能自动视为用户确认；
7. Agent 只能修改授予的 Draft authority；
8. Final 是自然的用户回复，而不是内部 reasoning dump；
9. Draft 修改必须通过工具完成，不能依赖 Final 文本来“提交”。

---

## 16. MCP 契约

V1 需要两个逻辑 capability domain。

### 16.1 World MCP

只读。

典型能力可以包括：

```text
list
read
search
tree
```

**MUST NOT** 暴露 write / delete / mutation tool。

### 16.2 Draft MCP

读写。

权限 **MUST** 精确对应：

```text
显式选中的文件集合
```

或：

```text
选中的 Draft 目录子树
```

MCP 的具体实现属于内部 implementation detail，外部契约只有 capability boundary。

---

## 17. 失败语义

所有确定性 setup error **MUST** 在 React 启动前失败。

包括但不限于：

- CLI 语法非法；
- 必填参数缺失；
- 同时提供 `--draft` 与 `--draft-dir`；
- 没有 Draft 输入；
- singleton 参数重复；
- output format 非法；
- World 非法；
- 显式 command 当前不可用；
- 省略 command 但无法唯一推导；
- Draft path 非法；
- authority setup 失败；
- LLM config path 非法。

React 启动后，React 自身错误 **SHOULD** 尽量保留其原始 stderr 与 process status。

Wrapper **SHOULD NOT** 把具体 React error 无意义地统一转换为泛化 Dayloom error。

所有 filesystem authority 错误 **MUST** fail closed。

---

## 18. 实现边界

V1 实现应保持极小。

推荐的最大逻辑拆分：

```text
src/
  main.ts
  argv.ts
  command.ts
  mcp.ts
  react.ts
  prompts/
```

职责：

```text
argv.ts
→ parse CLI
→ validate syntactic constraints

command.ts
→ classify World
→ compute Draft-driven commands
→ validate explicit command
→ infer omitted command

mcp.ts
→ construct World RO capability
→ construct Draft RW capability
→ enforce authority

react.ts
→ prepare promptpile-react invocation
→ connect Conversation / LLM / prompts / tools
→ forward stdio
→ return child process status

main.ts
→ minimal composition only
```

若更少文件即可保持清晰，则 **SHOULD** 使用更少文件。

---

## 19. V1 禁止的深抽象

V1 **SHOULD NOT** 引入以下或等价抽象：

```text
DraftRuntime
DraftSession
ConversationManager
MemoryManager
TurnCoordinator
AgentEngine
RevisionStore
SessionRepository
```

任何新增 abstraction 都 **MUST** 有具体 V1 requirement 才能存在。

默认选择应是：procedural + compositional，而不是 framework 化。

---

## 20. Promptpile 生态兼容

V1 直接使用 `promptpile-react` 作为 agent orchestration layer，并应保持与以下能力直接组合：

- `promptpile-mcp`；
- `promptpile-compress`；
- `promptpile-compress-grep-search`；
- `promptpile-fork`；
- `promptpile-protocol`。

V1 主路径 **MUST NOT** 自动加入：

```text
compression
archive search
conversation fork
```

这些能力继续作为 Promptpile 原生组合能力存在，除非未来出现明确 Dayloom 业务需求。

---

## 21. 最小端到端验收

仅有 unit test 不足以视为 V1 完成。

至少 **MUST** 验证以下四条 E2E。

### 21.1 单文件 Draft

输入：

```text
valid World
effective command = play
--draft ./draft.md
```

验证：

```text
command 正确解析
World 可读
World 不可写
draft.md 可读
draft.md 可写
Conversation 通过 Promptpile 更新
执行成功
```

### 21.2 多文件 Draft

输入：

```text
--draft ./a.md
--draft ./b.md
```

验证：

```text
a.md writable
b.md writable
未选择 sibling c.md 不可写
World 不可写
```

### 21.3 Draft 目录

输入：

```text
--draft-dir ./draft
```

验证：

```text
./draft 内文件可写
允许的情况下可在 ./draft 内创建文件
不能越过 ./draft 边界
World 始终只读
```

### 21.4 Command ambiguity

输入 World 状态满足：

```text
available Draft commands:
  plan
  revise
```

且省略 command。

验证：

```text
React 启动前失败
错误明确指出 command ambiguity
报告 available commands
不能静默选择 plan 或 revise
```

---

## 22. 补充 command 验收

实现 **SHOULD** 额外验证：

```text
missing/uninitialized World
+ omitted command
+ only init available
→ infer init
```

以及：

```text
invalid World
→ fail
→ MUST NOT infer init
```

以及：

```text
explicit unavailable command
→ fail before React
```

---

## 23. V1 非目标

V1 明确不包含：

- Dayloom-owned Conversation protocol；
- Dayloom Session persistence；
- generic memory system；
- Draft revision / CAS machinery；
- custom Dayloom event protocol；
- custom stdout / stderr channel abstraction；
- second agent orchestration engine；
- Draft schema standardization；
- Draft-to-World converter；
- World publication；
- settle behavior；
- TUI behavior；
- automatic conversation compression；
- automatic archive retrieval；
- automatic conversation fork management；
- 不必要的稳定 library API。

---

## 24. V1 Done

只有以下九条全部满足，V1 才视为闭环完成：

1. **CLI contract 已冻结并实现。**
2. **Command 校验与推导是确定性的，并复用 Dayloom 权威 World policy。**
3. **World 在 tool boundary 上被证明严格只读。**
4. **Draft 写权限精确等于显式 `--draft` 文件集合或 `--draft-dir` 子树。**
5. **一次 invocation 可以端到端完成一次 Promptpile React turn。**
6. **`text` 与 `stream-json` 都直接透传，不定义第二套 Dayloom protocol。**
7. **对同一 Conversation 重复 invocation 可以继续同一 Promptpile Conversation。**
8. **产生的 Draft 可以无需转换直接交给 `@dayloom/cli`。**
9. **没有引入额外 Dayloom Session / Runtime / orchestration abstraction。**

九条全部成立，即认为该 V1 primitive 已经达到“简洁、优雅、闭环、可实施”。

---

## 25. 后续变更判断准则

在向 V1 增加任何新职责前，先问：

> 这个职责真的属于 Dayloom Draft 的业务 policy，还是 Promptpile / `@dayloom/cli` 已经拥有它？

如果 Promptpile 或 `@dayloom/cli` 已经拥有该能力，`@dayloom/draft` **SHOULD** 直接组合它，而不是复制、包裹或重新命名。

本包应持续保持：

```text
low-level
file-native
explicit
composable
thin
```
