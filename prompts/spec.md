# day-loom 按天存档规范

day-loom 的 **World 存档**通用约定：**一切叙事推进与历史归档均以「天」为单位**。依据 [`../README.md`](../README.md) 第 7～11 节、第 13 节整理；本 spec 随协议演进逐步补全字段 schema。

---

## 1. 范围

| 项 | 说明 |
|---|---|
| 存档类型 | **World**（完整叙事存档） |
| 根目录 | 任意路径，记为 `<world_root>/` |
| **推进与归档单位** | **Day（天）** — 唯一叙事提交粒度 |
| 命名示例 | `world_0001/`、`my_campus/` 等，由 `manifest.yaml` 的 `id` 标识 |

核心原则：

```text
跨天目录存「当前世界长什么样」
days/ 按天存「每一天发生了什么」
```

一句话：以文件系统为状态存储、**按天**推进事件、**按天**结算日记与世界状态。

---

## 2. 核心概念

| 概念 | 说明 |
|------|------|
| **Day** | **核心单位**：今日计划 → 事件 → 日终结算 → **`summary.md`**、日记与补丁；一天 = 一次叙事提交 |
| **Event** | 一天内的互动单元，仅存在于该天的 `days/day_NNNN/events/` 下 |
| **World** | 跨天容器：设定、当前快照、人物/场景/剧情线的**现态** |
| **Character / Scene / Arc** | 跨天**现态**载体；其历史细节以 `days/` 为准，实体侧 memory/timeline 为派生 |
| **Memory** | 对**按天历史**的压缩理解（短期 / 长期 / 结构化事实） |

---

## 3. 按天目录（`days/`）

`days/` 是叙事历史的**唯一按天归档**。已完成的 `day_NNNN/` **原则上不可覆盖**。

**硬性要求**：凡已结算、写入历史的 `day_NNNN/`，**必须**包含根级 `summary.md`。进行中的当天在结算完成前可无此文件。

### 3.1 单日结构

```text
days/
  day_0001/
    meta.yaml                 # 日期元信息、阶段状态
    morning_plan.md           # 用户今日计划（**不可改写**，§8.1）
    day_outline.yaml          # AI 生成的当天事件大纲
    timeline.md               # 当天客观时间线（追加写入）

    events/
      event_001/
        event.yaml            # 元数据：标题、时间、地点、人物、触发原因
        scene.md              # 场景描写
        dialogue.md           # 对话
        choices.yaml          # 行为分支
        user_action.md        # 用户选择或自由输入（**不可改写**）
        result.yaml           # 事件结果
        state_patch.yaml      # 本事件状态补丁

    ending/
      objective_summary.md    # 客观日终总结（结算过程稿，可选）
      diary.md                # 用户视角日记（AI 生成）
      state_patch.yaml        # 日级合并补丁
      next_day_seed.yaml      # 明日事件种子

    summary.md                # **必填**（仅已结算入历史的天）：当天客观摘要，供检索与 memory 压缩
```

目录名：`day_NNNN`，`NNNN` 为从 `0001` 起的四位序号，与 `current.yaml` 中的当前天对齐。

事件目录名：`event_NNN`，三位序号。

### 3.2 `summary.md`

| 项 | 约定 |
|---|---|
| 路径 | `days/day_NNNN/summary.md` |
| 何时必须有 | 该天**已结算**并视为历史（`current.yaml` 已推进到下一天） |
| 内容 | 第三方客观视角的当日摘要：关键事件、人物变化、未解决线索 |
| 与 `diary.md` | `diary.md` 为用户视角日记；`summary.md` 为结构化检索用的客观摘要 |
| 与 `ending/objective_summary.md` | 结算时可先在 `ending/` 起草；**定稿须落盘为根级 `summary.md`** |

校验：加载历史存档时，缺少 `summary.md` 的已完成 `day_NNNN/` 视为**不完整存档**。

### 3.3 单日事务流程

```text
开始 day_NNNN
  → 写入 morning_plan.md
  → 生成 day_outline.yaml
  → 执行 event_001 … event_N（运行 → user_action → state_patch）
  → 追加 timeline.md
  → ending：diary.md、summary.md、state_patch.yaml、next_day_seed.yaml
  → 应用补丁到跨天现态（state / characters / scenes / arcs / memory）
  → current.yaml 指向下一天
结束 day_NNNN
```

中途失败时从**当前 event** 恢复；已完成 event 目录不应回写。

---

## 4. 跨天目录（`<world_root>/`）

跨天目录描述**世界现态**与设定；不替代 `days/` 中的按天历史。

```text
<world_root>/
  manifest.yaml           # 存档清单：id、协议版本、创建时间
  current.yaml            # 当前天指针、阶段、最后成功提交的 day_NNNN
  config.yaml             # 运行配置

  canon/                  # 世界设定（低频变更）
    premise.md
    rules.md
    style.md
    user_role.md

  state/                  # 当前世界快照
    world.yaml
    calendar.yaml
    progress.yaml
    variables.yaml

  characters/             # 人物现态（§6.1）
    index.yaml
    <char_id>/
      profile.md          # AI 语义上下文
      relationships.md    # AI 语义上下文
      meta.yaml           # 程序字段：id/type/status/tags
      memory.md           # 派生：从 days/ 压缩
      timeline.md         # 派生：按天索引，指向 days/

  scenes/                 # 场景现态（§6.2）
    index.yaml
    <scene_id>/
      profile.md          # AI 语义上下文
      meta.yaml           # 程序字段：id/type/status/tags
      memory.md
      triggers.yaml
      timeline.md

  arcs/                   # 剧情线现态（§6.3）
    index.yaml
    <arc_id>/
      profile.md
      meta.yaml
      progress.yaml
      timeline.md

  days/                   # 按天历史（§3，权威来源）
    day_0001/
      ...

  memory/                 # 跨天压缩记忆（派生，可重算）
    short_term.md         # 最近若干天
    long_term.md
    facts.yaml
    unresolved_threads.yaml
    important_events.yaml

  logs/                   # 追溯
    state_changes.jsonl
    generation_trace.md
    errors.md

  exports/                # 可选
    diaries/
    summaries/
```

`<char_id>`、`<scene_id>`、`<arc_id>` 使用小写 snake_case。

存档协议定义见 day-loom 包 [`prompts/spec.md`](./spec.md)，**不参与** `<world_root>/` 运行时加载。

---

## 5. 三层语义

| 层 | 目录 | 粒度 | 原则 |
|----|------|------|------|
| **按天历史** | `days/` | 天 | 权威叙事记录；已完成天**必有 `summary.md`**；**不可覆盖** |
| **跨天现态** | `state/`、`characters/`、`scenes/`、`arcs/`、`canon/` | 世界 | 反映「现在」；由日终补丁更新 |
| **派生理解** | `memory/`、各 `*/memory.md`、各 `*/timeline.md` | 压缩 / 索引 | **可重算**；须能回溯到 `days/` |
| **追溯** | `logs/` | 变更流水 | 调试与回放 |

---

## 6. 实体现态约定

实体目录只维护**跨天现态**；按天发生了什么，以 `days/day_NNNN/` 为准。

### 6.1 Character

| 文件 | 内容 |
|------|------|
| `profile.md` | 角色语义设定：身份、性格、目标、秘密、口吻等 |
| `relationships.md` | 与主角及其他角色的自然语言关系说明 |
| `meta.yaml` | 程序字段：id、type、status、tags |
| `memory.md` | 长期记忆（**派生**，从 `days/` 重算） |
| `timeline.md` | **按天**事件索引（**派生**），条目应能对应到 `days/day_NNNN/` 及其 **`summary.md`** |

### 6.2 Scene

| 文件 | 内容 |
|------|------|
| `profile.md` | 场景描述、氛围、进入条件、可互动元素 |
| `meta.yaml` | 程序字段：id、type、status、tags |
| `triggers.yaml` | 可触发事件索引 |
| `memory.md` | 场景记忆（**派生**） |
| `timeline.md` | **按天**场景事件索引（**派生**） |

### 6.3 Arc

| 文件 | 内容 |
|------|------|
| `profile.md` | 目标、冲突、参与人物的语义描述 |
| `meta.yaml` | 程序字段：id、type、status、tags |
| `progress.yaml` | 当前阶段、进度、下一触发点 |
| `timeline.md` | **按天**剧情推进索引（**派生**） |

---

## 7. 状态更新原则

### 7.1 不可覆盖（用户原文）

- `days/*/morning_plan.md`
- `days/*/events/*/user_action.md`

### 7.2 可重算（AI 派生）

- `memory/**`
- `characters/*/memory.md`、`characters/*/timeline.md`
- `scenes/*/memory.md`、`scenes/*/timeline.md`
- `arcs/*/timeline.md`
- `days/*/ending/objective_summary.md`（重生成时保留日志）
- `days/*/summary.md` 在**已结算入历史后**视为当日权威摘要；不应在无日志的情况下覆盖（见 §3.2）

### 7.3 先补丁、后合并（按天）

1. 每个 event 结束 → `events/*/state_patch.yaml`
2. 全天结束 → `ending/state_patch.yaml`
3. 状态更新器应用到跨天现态

### 7.4 补丁覆盖范围

- 人物关系
- `state/variables.yaml`
- 场景 / 剧情线进度
- 新事件种子、未解决线索

---

## 8. 文件格式

| 用途 | 格式 |
|------|------|
| 结构化状态、索引、补丁、短机器字段 | **YAML** |
| 设定、日记、记忆、时间线 | **Markdown** |
| 状态变更流水 | **JSONL** |

UTF-8 编码。

---

## 9. MVP 最小文件集（按天跑通）

**跨天**

- `manifest.yaml`、`current.yaml`
- `canon/premise.md`、`canon/user_role.md`
- `state/world.yaml`、`state/calendar.yaml`
- `characters/index.yaml` + 至少 1 个 NPC

**第一天 `days/day_0001/`**

- `morning_plan.md` → `day_outline.yaml` → 3～5 个 `events/*` → `ending/diary.md` + **`summary.md`** + `ending/state_patch.yaml`

MVP 成功标准：连续推进 **10 天**后，跨天现态无明显「重置感」。

---

## 10. AI 模块与按天读写

| 模块 | 按天读写 |
|------|----------|
| Day Planner | 读跨天现态 + `morning_plan.md` → 写 `day_outline.yaml` |
| Event Runner | 读 `event.yaml` + 现态 → 写 `scene.md`、`dialogue.md`、`choices.yaml` |
| State Resolver | 读 `user_action.md` → 写 `result.yaml`、`state_patch.yaml` |
| Diary Writer | 读当天 `timeline.md`、events → 写 `ending/diary.md` |
| Day Summarizer | 读当天 events、`timeline.md` → 写 **`summary.md`**（结算必填） |
| Memory Updater | 读**当天** events、`summary.md` → 更新 `memory/` 与实体派生文件 |
| Next Day Seeder | 写 `ending/next_day_seed.yaml` → 驱动下一天 `day_{N+1}/` |

运行时 **system 提示词** 自本目录各 `*.system.md` 加载（见 [`README.md`](./README.md)）。

---

## 11. 待定义项

- [ ] `manifest.yaml` / `current.yaml` 字段表
- [ ] `day_NNNN` / `event_NNN` 编号与日历映射规则
- [ ] `state_patch.yaml` 补丁语法与 merge 规则
- [ ] `event.yaml` / `day_outline.yaml` / `choices.yaml` schema
- [ ] `summary.md` 字段结构与最小长度要求
- [ ] 实体 `timeline.md` 按天索引条目格式
- [ ] 协议版本与向后兼容

---

## 12. 参考

- 项目总设计：[`../README.md`](../README.md)
- 早期架构草案：[`../plan.md`](../plan.md)
