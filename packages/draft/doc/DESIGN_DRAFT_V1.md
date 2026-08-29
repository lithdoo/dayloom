# Dayloom Draft V1 — 实施契约

状态：**implementation-ready**

本文定义 `@dayloom/draft` V1 的实施契约。V1 的目标不是建立新的 Agent Runtime，而是提供一个足够薄、可直接被未来 TUI 调用的 Dayloom Draft primitive。

---

## 1. 定位与不变量

`@dayloom/draft` 的定义是：

```text
@dayloom/draft
=
promptpile-react
+ Dayloom command policy
+ Dayloom business prompts
+ Dayloom MCP authority wiring
```

V1 **MUST** 保持以下不变量：

1. 一次 invocation 对应一条用户消息和一次 Promptpile React turn；
2. Conversation 完全属于 Promptpile；
3. World 对 Agent 永远只读；
4. Draft 的可写范围完全由 `--draft` / `--draft-dir` 决定；
5. Dayloom 只注入业务 prompt、command policy 与 MCP authority；
6. React 的 orchestration、Conversation persistence、event protocol 与 stdout/stderr ownership 不由 Dayloom 重定义；
7. V1 **MUST NOT** 引入第二套有状态 Session / Conversation / Agent Runtime。

唯一主路径：

```text
dayloom-draft [command] [options]
        ↓
解析参数
        ↓
分类 World
        ↓
校验或推导 command
        ↓
规范化并校验 World / Draft authority
        ↓
append 一条 user message 到 Promptpile Conversation
        ↓
准备 Dayloom prompts + MCP capabilities
        ↓
运行 promptpile-react
        ↓
原样转发输出并返回退出状态
```

---

## 2. CLI 契约

语法：

```text
dayloom-draft [command] [options]
```

`command` 可选，V1 仅支持：

```text
init | plan | play | revise
```

参数：

```text
--world <dir>

--draft <file>          # 可重复
        OR
--draft-dir <dir>

--conversation <dir>
--llm-config <file>
--message <text>

--output-format <terminal|stream-json>

--help
--version
```

普通 invocation 中：

```text
--world          MUST 恰好一次
--conversation   MUST 恰好一次
--llm-config     MUST 恰好一次
--message        MUST 恰好一次
```

Draft 输入 **MUST** 恰好选择一种形式：

```text
一个或多个 --draft
```

或：

```text
一个 --draft-dir
```

`--draft` 与 `--draft-dir` **MUST** 互斥。

`--output-format` 默认值为：

```text
terminal
```

其值与 Promptpile React 原生 CLI 保持一致，不再引入 `text`、`pipe` 或 `channel` 等别名。

未知参数、重复 singleton 参数或非法值 **MUST** 在启动 React 前失败。

---

## 3. Command resolution

### 3.1 显式 command

显式传入的 command 表示调用方的业务意图，但 **MUST** 与当前 World 状态校验。

```text
显式 command 可用
→ 使用该 command

显式 command 不可用
→ fail before React
```

实现 **MUST NOT** 自动替换成其他 command。

### 3.2 省略 command

command 省略时：

```text
available = 当前 World 可用命令
            ∩
            { init, plan, play, revise }
```

规则固定为：

```text
available.length == 1
→ 推导唯一 command

available.length == 0
→ fail

available.length > 1
→ fail: ambiguous command
```

V1 **MUST NOT** 为歧义状态定义默认 command。

例如：

```text
uninitialized → init
planned       → play
idle          → plan | revise → ambiguous
```

### 3.3 权威来源

`@dayloom/draft` **SHOULD** 复用 Dayloom 已有的 World classification / command availability 纯业务逻辑，不复制第二套状态机。

如果共享逻辑需要从 `@dayloom/cli` 中抽出，只允许抽取完成该判断所需的最小无副作用逻辑；不得因此恢复新的 Dayloom Core。

---

## 4. World classification 与 authority

至少 **MUST** 区分：

```text
missing / uninitialized
valid World
invalid World
```

规则：

```text
missing / uninitialized
→ MAY 使 init 成为唯一候选

valid World
→ 使用 Dayloom 权威规则计算 available commands

invalid World
→ fail closed
→ MUST NOT 当成 uninitialized
→ MUST NOT 自动推成 init
```

对 React Agent 暴露的 World capability **MUST** 始终只读：

```text
World
  read  = allowed
  write = forbidden
```

Agent 可以读取 command 所需的 canon、control、plan、entity、day artifacts 等内容，但不能通过任何工具修改 World。

只读约束 **MUST** 在 MCP/tool boundary 上执行，不能只写在 prompt 中。

command 只改变业务 prompt / context policy，不改变 `World RO / Draft RW` 这一基础 authority model。

---

## 5. Draft authority

Draft 参数同时定义：

1. 本轮 semantic input；
2. Agent 的精确可写 authority。

### 5.1 单文件 / 多文件

```bash
--draft ./draft.md
```

或：

```bash
--draft ./intent.md \
--draft ./notes.md
```

权限 **MUST** 精确等于显式文件集合。

```text
selected file
→ read / create / modify

unselected sibling
→ no authority
```

显式 Draft 文件 **MAY** 尚不存在；此时：

- 其父目录 **MUST** 已存在；
- Agent **MAY** 创建这个精确文件；
- 文件不存在不得扩大为父目录写权限。

已存在的 `--draft` path **MUST** 是普通文件。

### 5.2 Draft 目录

```bash
--draft-dir ./draft
```

`--draft-dir` 指定的目录 **MUST** 已存在。

权限为：

```text
read/write: ./draft/**
```

V1 可以在该子树内创建、修改或删除普通文件，但不得越过该 subtree。

### 5.3 canonical path 与 symlink

Filesystem authority **MUST** 基于 canonical path / real path 进行校验。

实现 **MUST** 防止：

- `..` path traversal；
- symlink 导致的 authority escape；
- 通过别名路径绕过 file-set 或 subtree 边界。

若目标无法安全 canonicalize 或其实际路径越界，**MUST** fail closed。

### 5.4 World / Draft 不得重叠

World authority 与 Draft authority **MUST NOT** 重叠。

以下情况均 **MUST** 拒绝：

```text
Draft file 位于 World 内
Draft dir 位于 World 内
World 位于 Draft dir 内
canonical path 相同
通过 symlink 形成上述任一关系
```

这样不存在“同一路径同时被 World RO 与 Draft RW 授权”的冲突。

---

## 6. Conversation 契约

`--conversation <dir>` 是 Promptpile 原生 Conversation 的唯一 writable layer。

`@dayloom/draft` **MUST NOT** 定义自己的 Conversation 格式、Session 数据库、turn id 或重复消息历史。

Conversation 目录可以不存在；V1 **MUST** 按 Promptpile public CLI 能接受的方式创建/初始化该目录，而不是创建 Dayloom 私有元数据。

一轮调用的 Conversation 写入顺序固定为：

```text
1. 将 --message 作为一条 user message append 到 --conversation
2. 运行一次 promptpile-react
3. Final 通过 React --continue 写回同一个 --conversation
```

User message append **MUST** 使用 Promptpile 的公开 Conversation CLI 语义，例如等价于：

```text
promptpile conversation append-user -d <conversation>
```

消息正文通过 stdin 传给 Promptpile，避免 Dayloom 自己写 Conversation artifact。

React invocation 中，该目录 **MUST** 作为唯一 writable Conversation layer：

```text
--output-dir <conversation>
--continue
```

Dayloom **MUST NOT** 解析或直接写 Promptpile Conversation 内部文件格式。

同一 `--conversation` 被后续 invocation 再次使用时，即自然延续同一上下文。

注意：user message append 成功后，如果后续 React 失败，该已发布 user message不回滚；这一行为沿用 Promptpile React / Promptpile 的原生语义。

---

## 7. Promptpile React invocation

V1 应尽可能接近一次参数化的 `promptpile-react` 子进程调用。

Dayloom 负责准备：

```text
resolved command
Dayloom prompts
World RO tools
Draft RW tools
Promptpile/React config
conversation path
user message
output format
```

Promptpile React 继续负责：

```text
Thought
Observe
Check
Final
iteration control
Agent Event Protocol
Conversation persistence
```

V1 **MUST NOT** 在外层重建这些机制。

V1 不公开 `--max-step`、`--tools-file`、`--work-root`、phase prompt path 等 React 内部 wiring 参数；它们属于 Dayloom 业务封装内部实现。

`--llm-config` 仍是调用方提供的 Promptpile LLM 配置来源。Dayloom 不再定义 provider / model 配置层。

---

## 8. Prompt policy

Prompt 应最大化共享，仅让 command 注入必要的业务差异。

逻辑上保持：

```text
shared React behavior
+
command-specific business appendix
```

不要求固定源码目录或固定 prompt 文件数量。

Dayloom prompt 至少 **MUST** 建立以下不变量：

1. Draft 是后续 `@dayloom/cli` 的 semantic input；
2. Draft 不是 World mutation DSL；
3. World 可以读取但不能修改；
4. Draft 应反映用户当前有效、权威的意图；
5. 已否定或已取代的旧意图不能仅因仍存在 Conversation 中而继续生效；
6. 模型自身建议不能自动视为用户确认；
7. Agent 只能在授予的 Draft authority 内写入；
8. Draft 修改必须通过工具发生；
9. Final 只负责自然用户回复，不承担“提交 Draft”的职责。

---

## 9. Output 契约

V1 直接暴露 React 原生：

```text
--output-format terminal
--output-format stream-json
```

### terminal

使用 Promptpile React 正常终端输出行为。

### stream-json

```text
stdout
→ Promptpile React Agent Event Protocol v1 JSONL

stderr
→ diagnostics / child stderr

exit status
→ React process result
```

Dayloom **MUST NOT**：

- 重命名 React event；
- 包裹 Dayloom event envelope；
- 暴露隐藏 Thought / Observe / Check 文本；
- 无必要地 parse / reserialize stdout；
- 新增 `--channel` 或另一套 pipe abstraction。

未来 TUI 应能够直接消费 `stream-json`。

---

## 10. Failure semantics

下列确定性错误 **MUST** 在 React 启动前失败：

- CLI syntax / 参数错误；
- 缺少 required option；
- `--draft` 与 `--draft-dir` 同时存在；
- 无 Draft 输入；
- command 非法、不可用或推导歧义；
- invalid World；
- 无效 Draft path / Draft dir；
- World / Draft authority overlap；
- path traversal / symlink authority escape；
- MCP authority 无法安全建立；
- `--llm-config` 无法使用；
- Conversation 无法通过 Promptpile public CLI 初始化或 append user message。

一旦 React 成功启动：

- stdout / stderr 按 React 原生契约处理；
- React 非零退出不得被包装成“成功”；
- Dayloom 不应把具体 React failure 无必要地抹平成一个通用错误。

所有 filesystem authority 错误 **MUST** fail closed。

---

## 11. 最小端到端验收

V1 不能仅靠 unit test 宣告完成，至少 **MUST** 有以下 E2E。

### A. 单文件，可创建

```text
--draft ./new-draft.md
文件初始不存在
父目录存在
```

验证：

- command 正确解析；
- Agent 能读取 World；
- Agent 不能修改 World；
- Agent 能创建并修改 `new-draft.md`；
- sibling 文件不可写；
- user + Final 持久化到 Conversation；
- 成功退出。

### B. 多显式文件

```text
--draft ./a.md
--draft ./b.md
```

验证：

```text
a.md RW
b.md RW
c.md no authority
World RO
```

### C. Draft directory

```text
--draft-dir ./draft
```

验证：

- subtree 内可读写/创建；
- `..` 不可越界；
- symlink 不可逃出 subtree；
- World 仍然只读。

### D. Command ambiguity

World 当前同时允许：

```text
plan, revise
```

且省略 command。

验证：

- React 未启动；
- 返回 ambiguity error；
- 报告可用 command；
- 不偷偷选择默认值。

另外 **MUST** 覆盖：

```text
missing/uninitialized + 唯一 init → infer init
invalid World → fail，不得 infer init
显式 unavailable command → fail before React
World/Draft canonical overlap → fail before React
同一 Conversation 连续两轮 → 第二轮能看到第一轮上下文
stream-json → stdout 仍是原生 React Agent Event Protocol v1 JSONL
```

---

## 12. V1 Done

仅当以下条件全部成立，V1 才视为闭环完成：

1. CLI 契约已实现；
2. command 校验 / 推导确定且复用 Dayloom 权威 World policy；
3. World 在实际 tool boundary 上可证明为只读；
4. Draft authority 精确匹配 `--draft` file set 或 `--draft-dir` subtree，并能阻断 overlap / traversal / symlink escape；
5. 一次 invocation 只 append 一条 user message，并完成一次 Promptpile React turn；
6. Conversation 完全通过 Promptpile public semantics 创建、延续和持久化；
7. `terminal` / `stream-json` 保持 React 原生输出契约，不存在第二套 Dayloom event protocol；
8. 生成的 Draft 可无需转换直接交给 `@dayloom/cli`；
9. 没有引入第二套 Dayloom Session / Conversation / Agent Runtime。

V1 明确不包含：自动 compression、archive search、fork、TUI、Draft schema、Draft-to-World converter、World publication 或 settle。这些能力继续由 Promptpile / `@dayloom/cli` 组合提供，除非未来出现明确业务需求。

到此为止，`@dayloom/draft` V1 的设计应停止扩张，直接进入实现与 E2E 验证。