
# day-loom 项目设计文档

## 1. 项目概述

**day-loom** 是一个以“天”为推进单位的 AI 生活模拟与日记生成项目。

用户每天输入“今天想做什么”，系统根据当前世界状态、人物关系、场景记忆、长期剧情线和随机事件规则，生成当天的事件流程。用户在事件中通过选择或自由输入行为参与推进。一天结束后，AI 根据当天发生的事件生成日记，并更新人物、场景、事件、剧情线和世界状态，然后进入下一天。

它不是传统聊天机器人，也不是普通日记软件，而是一个由 AI 驱动的 **日常生活叙事模拟器**。

一句话定位：

> day-loom 是一个以文件系统为状态存储、以每日事件为推进单位、以日记为结算结果的 AI 生活模拟引擎。

---

## 2. 核心理念

day-loom 的核心不是“聊天”，而是“按天推进的叙事状态机”。

用户不是持续和 AI 对话，而是每天给出一个意图：

```text
今天我要做什么？
```

系统根据这个意图生成一天中的事件、对话、行为分支和结果。一天结束后，系统会沉淀出：

* 用户视角的日记
* 客观事件记录
* 人物关系变化
* 场景记忆变化
* 长期剧情推进
* 明日事件种子

核心循环如下：

```text
用户今日计划
  ↓
AI 生成当天事件大纲
  ↓
用户参与事件选择或自由行动
  ↓
AI 推进对话、行为和结果
  ↓
当天结束
  ↓
AI 生成日记
  ↓
更新人物、场景、事件、剧情线和世界状态
  ↓
进入下一天
```

---

## 3. 项目目标

day-loom 的目标是构建一个长期可推进、状态可追溯、人物关系连续、事件因果稳定的 AI 叙事系统。

核心目标包括：

1. **以天为单位推进世界**

   每一天都是一个完整的叙事循环，有开始、事件、选择、结果和结算。

2. **让用户低成本参与叙事**

   用户不需要写长篇剧情，只需要输入当天计划，并在关键事件中做选择或输入行为。

3. **保持长期状态连续性**

   人物关系、场景记忆、主线进度、未解决事件和世界状态都需要跨天延续。

4. **以文件系统作为状态存储**

   所有重要状态都以 Markdown、YAML、JSONL 等可读文件保存，方便查看、编辑、回滚、同步和版本控制。

5. **让日记成为叙事结算结果**

   日记不是用户手写的输入，而是 AI 根据当天事件生成的人类可读存档。

---

## 4. 非目标

day-loom 第一阶段不追求成为完整游戏引擎，也不追求复杂图形界面。

暂不作为核心目标的内容：

* 大型开放世界地图
* 实时多人联机
* 高复杂数值战斗系统
* 复杂动画或 3D 表现
* 完整视觉小说编辑器
* 面向所有题材的通用 RPG 引擎
* 强制绑定某一个大模型服务

day-loom 的优先级应该是：

```text
状态连续性 > 事件推进质量 > 日记沉淀质量 > UI 表现
```

---

## 5. 与同类项目的区别

### 5.1 与 SillyTavern 的区别

SillyTavern 的中心是角色聊天。

day-loom 的中心是每日推进。

SillyTavern 的基本单位是：

```text
一轮对话
```

day-loom 的基本单位是：

```text
一天
```

SillyTavern 更适合角色扮演聊天；day-loom 更适合长期生活模拟、事件推进和日记式存档。

### 5.2 与 AI Dungeon 的区别

AI Dungeon 偏向即时冒险叙事。

day-loom 更强调：

* 每日结构
* 日记结算
* 人物关系连续性
* 场景状态积累
* 文件系统存档
* 可回放的状态变更

day-loom 不是无限向前生成文本，而是每天完成一次可追踪的状态提交。

### 5.3 与普通 AI 日记的区别

普通 AI 日记通常是用户写日记，AI 帮助总结或分析。

day-loom 中，用户输入的是“今日计划”，AI 负责把这一天演化为事件。日记是一天结束后的生成结果。

```text
普通 AI 日记：用户记录生活，AI 总结生活。
day-loom：用户输入意图，AI 推演生活，并生成日记。
```

---

## 6. 核心体验

day-loom 的核心体验分为四步。

### 6.1 晨间计划

用户输入今天想做什么。

示例：

```text
今天上午去上课，下午去图书馆复习，晚上想找林雨聊一下。
```

系统读取当前状态后，生成当天事件大纲。

### 6.2 当天事件

系统将一天拆成多个事件。

示例：

```text
事件 1：上午课程
事件 2：课后老师提醒考试范围变化
事件 3：下午图书馆复习
事件 4：林雨出现
事件 5：晚上回宿舍复盘
```

每个事件包含场景、人物、对话、选项和可能的状态变化。

### 6.3 用户行动

用户可以通过两种方式参与事件：

1. 选择系统给出的行为分支
2. 自由输入自己的行为

示例：

```text
我走到林雨旁边，把自己的笔记推给她，说如果不介意可以一起看。
```

系统根据用户行为推演人物反应、事件结果和状态变化。

### 6.4 日终结算

所有事件完成后，系统生成当天日记，并更新状态。

日终结算包括：

* 今日客观总结
* 用户视角日记
* 人物状态更新
* 场景记忆更新
* 剧情线进度更新
* 未解决线索更新
* 明日事件种子生成

---

## 7. 核心概念

### 7.1 World：世界

一个 World 是一个完整的叙事存档。

每个 World 拥有独立的：

* 世界设定
* 当前日期
* 人物列表
* 场景列表
* 剧情线
* 历史事件
* 日记记录
* 长期记忆

用户可以创建多个世界，例如：

* 校园生活世界
* 职场成长世界
* 末日生存世界
* 恋爱模拟世界
* 奇幻冒险世界

### 7.2 Day：天

Day 是 day-loom 的核心推进单位。

每一天包含：

* 用户今日计划
* AI 生成的事件大纲
* 当天事件列表
* 当天时间线
* 日终总结
* 日记
* 状态补丁
* 明日种子

每一天都可以看作一次“叙事提交”。

### 7.3 Event：事件

Event 是一天中的具体互动单元。

一个事件通常包含：

* 事件标题
* 发生时间
* 发生地点
* 参与人物
* 触发原因
* 场景描写
* 对话内容
* 用户选择
* 用户自由行为
* 事件结果
* 状态变化

事件是状态变化的最小来源。

### 7.4 Character：人物

人物是长期状态的核心载体。

每个人物应该拥有：

* 基础信息
* 性格设定
* 当前情绪
* 当前目标
* 与主角的关系
* 与其他人物的关系
* 长期记忆
* 事件时间线
* 隐藏动机

人物不应该每次事件都重新生成，而应该根据自己的状态持续行动。

### 7.5 Scene：场景

场景不是简单背景，而是可以积累记忆的叙事空间。

场景可以拥有：

* 基础描述
* 常出现人物
* 可触发事件
* 场景氛围
* 历史事件
* 进入条件
* 时间限制

例如“图书馆”可以积累主角与林雨多次互动的记忆，从而成为后续关系推进的重要地点。

### 7.6 Arc：剧情线

剧情线用于管理长期目标和长期冲突。

例如：

* 期末考试线
* 和林雨的关系线
* 社团比赛线
* 工作项目线
* 家庭压力线

每条剧情线都应该有当前阶段、进度、风险、下一触发点和历史记录。

### 7.7 Memory：记忆

记忆是对历史事件的压缩理解。

day-loom 中至少需要三类记忆：

1. **短期记忆**

   最近几天发生的事情，用于维持近期连续性。

2. **长期记忆**

   稳定的角色特征、关系模式、重要经历和反复出现的问题。

3. **结构化事实**

   可以被程序和 AI 稳定引用的事实，例如人物身份、考试日期、场景关系等。

---

## 8. 文件系统存储设计

day-loom 使用文件系统作为状态存储。

面向 AI 的人物、场景和剧情线语义上下文使用 Markdown；YAML 只保留索引、状态、补丁和少量机器可读元数据。

推荐目录结构如下：

```text
world_0001/
  manifest.yaml
  current.yaml
  config.yaml

  canon/
    premise.md
    rules.md
    style.md
    user_role.md

  state/
    world.yaml
    calendar.yaml
    progress.yaml
    variables.yaml

  characters/
    index.yaml
    char_main/
      profile.md
      relationships.md
      meta.yaml
      memory.md
      timeline.md
    char_lin_yu/
      profile.md
      relationships.md
      meta.yaml
      memory.md
      timeline.md

  scenes/
    index.yaml
    school_library/
      profile.md
      meta.yaml
      memory.md
      triggers.yaml
      timeline.md

  arcs/
    index.yaml
    exam_arc/
      profile.md
      meta.yaml
      progress.yaml
      timeline.md

  days/
    day_0001/
      meta.yaml
      morning_plan.md
      day_outline.yaml
      timeline.md
      events/
        event_001/
          event.yaml
          scene.md
          dialogue.md
          choices.yaml
          user_action.md
          result.yaml
          state_patch.yaml
      ending/
        objective_summary.md
        diary.md
        state_patch.yaml
        next_day_seed.yaml

  memory/
    short_term.md
    long_term.md
    facts.yaml
    unresolved_threads.yaml
    important_events.yaml

  logs/
    state_changes.jsonl
    generation_trace.md
    errors.md

  exports/
    diaries/
    summaries/
```

### 8.1 days 是历史

`days/` 保存已经发生过的事情。

这里的内容是历史事实，原则上不应该随意覆盖。

### 8.2 state 是当前

`state/` 保存当前世界的快照。

它反映“现在世界是什么样”。

### 8.3 memory 是理解

`memory/` 保存 AI 对历史的压缩理解。

它可以被重算、修正和压缩。

### 8.4 logs 是可追溯变更

`logs/` 用于记录状态变化、生成过程和错误信息。

它是调试和回放的重要依据。

---

## 9. 状态更新原则

day-loom 的状态更新应该遵循几个原则。

### 9.1 原始输入不可覆盖

用户输入的今日计划和用户在事件中的自由行为必须保留原文。

例如：

* `morning_plan.md`
* `user_action.md`

这些文件是用户真实输入，不能被 AI 改写。

### 9.2 AI 结果可以修正

AI 生成的摘要、标签、人物记忆、场景记忆可以重算。

例如：

* `memory/short_term.md`
* `characters/*/memory.md`
* `scenes/*/memory.md`

这些是派生结果，不应当和原始历史混为一谈。

### 9.3 状态变化先写补丁

事件结束后，不应该直接修改所有全局文件，而应该先写入事件级 `state_patch.yaml`。

一天结束后，再合并所有事件补丁，生成日级 `state_patch.yaml`。

最后由状态更新器应用这些补丁到人物、场景、剧情线和世界状态中。

这样可以实现：

* 状态变化可追溯
* 事件结果可回滚
* 生成错误可定位
* 历史可以重放

### 9.4 一天是一笔事务

day-loom 中的一天可以看作一次事务。

流程如下：

```text
开始 day_0001
  ↓
写入 morning_plan.md
  ↓
生成 day_outline.yaml
  ↓
执行 event_001
  ↓
执行 event_002
  ↓
执行 event_003
  ↓
生成 ending/diary.md
  ↓
生成 ending/state_patch.yaml
  ↓
应用状态更新
  ↓
current.yaml 指向 day_0002
结束 day_0001
```

如果中途失败，可以从当前事件恢复。

---

## 10. AI 模块设计

day-loom 不应该使用一个 Prompt 处理所有事情，而应该拆成多个 AI 模块。

### 10.1 Day Planner

负责根据用户今日计划和当前状态生成当天事件大纲。

输入：

* 用户今日计划
* 当前世界状态
* 短期记忆
* 活跃剧情线
* 明日事件种子

输出：

* 当天事件列表
* 每个事件的大致时间
* 事件类型
* 参与人物
* 触发原因

### 10.2 Event Runner

负责执行单个事件。

输入：

* 事件设定
* 当前场景状态
* 参与人物状态
* 相关历史事件

输出：

* 场景描写
* 对话
* 行为选项
* 等待用户选择或自由输入

### 10.3 Dialogue Engine

负责生成自然对话。

要求：

* 符合人物性格
* 延续人物关系
* 避免每次重新认识
* 不要强行推进关系
* 不要忽略近期冲突

### 10.4 Choice Engine

负责生成行为分支。

行为分支应该包含：

* 保守选项
* 主动选项
* 回避选项
* 自定义输入入口

不要只提供“正确答案”，要让选择有真实代价。

### 10.5 State Resolver

负责根据用户行为和事件结果生成状态变化。

输出包括：

* 人物关系变化
* 变量变化
* 场景记忆变化
* 剧情线进度变化
* 新事件种子
* 未解决线索

### 10.6 Diary Writer

负责在一天结束后生成用户视角日记。

要求：

* 第一人称
* 不要像流水账
* 保留当天关键情绪
* 体现人物关系变化
* 适度文学化，但不要夸张

### 10.7 Memory Updater

负责更新跨天记忆。

它应该从当天事件中提取：

* 重要事实
* 关系变化
* 重复模式
* 未解决线索
* 长期记忆候选

### 10.8 Next Day Seeder

负责生成下一天可能触发的事件种子。

例如：

* 某人物可能主动联系用户
* 某场景可能触发后续事件
* 某条剧情线接近关键节点
* 某个未解决问题可能继续发酵

---

## 11. 单日运行流程

完整的单日运行流程如下：

```text
1. 读取 current.yaml
2. 读取世界状态、人物状态、场景状态、剧情线状态
3. 用户输入 morning_plan.md
4. Day Planner 生成 day_outline.yaml
5. 创建当天 events 目录
6. 执行第一个事件
7. 用户选择或输入行为
8. State Resolver 生成事件结果和 state_patch.yaml
9. 追加当天 timeline.md
10. 执行下一个事件
11. 所有事件完成后进入 ending
12. Diary Writer 生成 diary.md
13. Memory Updater 生成当天状态补丁
14. 应用状态补丁到 state、characters、scenes、arcs、memory
15. Next Day Seeder 生成 next_day_seed.yaml
16. 更新 current.yaml 到下一天
```

---

## 12. 界面设计思路

day-loom 的界面不应该只是一个聊天框。

更适合的布局是：

```text
左侧：日期 / 时间线 / 世界列表
中间：当前事件 / 场景描写 / 对话
右侧：人物状态 / 场景状态 / 今日目标
底部：用户行为输入框 / 行为选项
```

### 12.1 今日页

今日页是主要操作界面。

包含：

* 当前日期
* 今日计划
* 当前事件
* 事件选项
* 自定义行为输入
* 今日进度

### 12.2 日记页

日记页用于查看每天结束后的日记。

包含：

* 用户视角日记
* 客观事件摘要
* 关键人物变化
* 关键场景变化
* 明日伏笔

### 12.3 人物页

人物页用于查看人物状态。

包含：

* 人物资料
* 当前关系
* 最近事件
* 长期记忆
* 与其他人物关系

### 12.4 场景页

场景页用于查看场景记忆。

包含：

* 场景描述
* 常出现人物
* 可触发事件
* 历史事件
* 当前氛围

### 12.5 世界状态页

世界状态页用于调试和管理。

包含：

* 当前日期
* 世界变量
* 活跃剧情线
* 未解决线索
* 明日事件种子
* 状态变更记录

---

## 13. MVP 范围

第一版应该尽量小，只需要跑通 Day Loop。

MVP 功能：

1. 创建一个世界
2. 创建主角和少量 NPC
3. 用户输入今日计划
4. AI 生成 3 到 5 个当天事件
5. 每个事件提供选项和自定义输入
6. 用户完成所有事件
7. AI 生成当天日记
8. AI 生成事件摘要和状态补丁
9. 更新人物关系和世界状态
10. 进入下一天

MVP 不需要：

* 插件系统
* 图像生成
* 语音系统
* 多模型复杂路由
* 可视化关系图
* 大规模场景地图
* 复杂数值系统

MVP 成功标准：

```text
连续推进 10 天后，人物关系、场景记忆和剧情线仍然基本一致，没有明显重置感。
```

---

## 14. 后续扩展方向

### 14.1 多世界支持

用户可以创建多个不同题材的世界。

例如：

* 校园日常
* 职场成长
* 恋爱模拟
* 奇幻冒险
* 末日生存

### 14.2 模型适配层

支持不同模型来源：

* OpenAI
* Claude
* Gemini
* DeepSeek
* OpenRouter
* Ollama
* LM Studio
* 本地 OpenAI-compatible API

### 14.3 插件系统

未来可以扩展：

* 图像生成
* 语音输入
* TTS
* 日历接入
* 待办接入
* Obsidian 导出
* Git 版本控制
* 向量检索

### 14.4 记忆检索

当历史变多后，不应该把所有文件都塞进上下文。

可以引入：

* 关键词搜索
* 语义向量搜索
* 最近事件窗口
* 重要事件索引
* 人物相关记忆检索
* 场景相关记忆检索

### 14.5 状态回滚

因为每个事件都有 `state_patch.yaml`，后续可以支持：

* 回滚某一天
* 回滚某个事件
* 重生成某天日记
* 修正某个人物关系变化
* 重放整个世界状态

---

## 15. 设计风险

### 15.1 AI 胡乱推进

风险：AI 可能忽略用户计划，强行制造剧情。

解决：

* 用户计划优先级高于随机事件
* 随机事件数量可配置
* 事件生成必须说明触发原因
* 重要状态变化必须写入补丁

### 15.2 人物前后不一致

风险：NPC 每天像重新认识用户。

解决：

* 人物拥有独立 profile、memory、timeline
* 事件生成前检索相关人物历史
* 对话生成必须参考人物关系状态

### 15.3 状态污染

风险：AI 总结错误导致长期状态被污染。

解决：

* 原始历史和 AI 派生记忆分离
* 先写 state_patch，再应用状态
* 允许用户审核关键状态变化
* 派生记忆可以重算

### 15.4 上下文过长

风险：天数增加后无法把全部历史放进上下文。

解决：

* 最近几天直接读取
* 远期历史通过摘要和检索读取
* 人物、场景、剧情线各自维护压缩记忆
* 重要事件进入索引

### 15.5 玩法变成流水账

风险：每天只是机械生成事件，没有情绪和因果。

解决：

* 每天必须有至少一个选择点
* 每个事件需要产生轻微状态变化
* 长期剧情线需要有阶段目标
* 未解决线索需要跨天回收

---

## 16. 推荐开发顺序

建议按以下顺序开发：

### 阶段一：文件存档协议

目标：定义世界目录结构和最小状态格式。

内容：

* `manifest.yaml`
* `current.yaml`
* `state/`
* `characters/`
* `days/`

### 阶段二：单日流程跑通

目标：完成从今日计划到日记生成的闭环。

内容：

* 输入今日计划
* 生成事件大纲
* 执行事件
* 生成日记
* 生成状态补丁

### 阶段三：人物与场景连续性

目标：让人物和场景跨天保持一致。

内容：

* 人物 profile
* 人物 memory
* 场景 memory
* 事件时间线

### 阶段四：剧情线与明日种子

目标：让故事具备长期推进感。

内容：

* arc 管理
* unresolved_threads
* next_day_seed
* progress 更新

### 阶段五：检索与压缩记忆

目标：解决长周期上下文问题。

内容：

* 重要事件索引
* 短期记忆
* 长期记忆
* 人物相关检索
* 场景相关检索

### 阶段六：UI 和产品体验

目标：让用户真正愿意玩下去。

内容：

* 今日页
* 事件页
* 日记页
* 人物页
* 世界状态页

---

## 17. 项目一句话介绍

面向用户：

> 每天输入你想做什么，AI 会把这一天演化成事件、对话和选择，并在一天结束后生成日记，持续推进属于你的生活世界。

面向开发者：

> day-loom is a file-based AI life simulation engine that advances narrative state day by day and persists each day as a readable diary and traceable world-state commit.

面向开源 README：

> day-loom 是一个文件系统驱动的 AI 日常叙事引擎。它以“天”为单位推进世界，以事件和选择塑造状态，以日记作为每日结算结果，让人物、场景和剧情线在长期运行中持续演化。

---

## 18. 总结

day-loom 的核心不是聊天，不是日记，也不是单纯的游戏。

它真正要做的是：

```text
把用户的每日意图，转化成可互动的事件；
把事件结果，转化成可追溯的状态变化；
把一天的经历，转化成可阅读的日记；
把连续的日记，转化成一个持续演化的个人世界。
```

最终形态可以概括为：

> day-loom 是一个以日记为存档格式的人生模拟器。

---

## revise：AI 辅助维护 World 设定

`revise` 默认启动多轮 AI 对话。AI 通过只读 MCP 工具检索当前 World；只有用户输入 `/apply` 并确认 diff 后，Day Loom 才会备份并写盘。

```bash
day-loom revise -d ./path/to/world
```

会话命令：

```text
/pending   查看待修改意图
/apply     生成最终提案并确认应用
/cancel    放弃并退出
/exit      保留 session 草稿并退出
```

交互模式需要：

- `DEEPSEEK_API_KEY`
- 可用的 `promptpile-mcp` CLI。可设置 `PROMPTPILE_MCP_BIN`，或先在仓库的 `promptpile/packages/promptpile-mcp/` 中安装依赖并构建。
- 默认 MCP Server 使用 `npx -y @modelcontextprotocol/server-filesystem <world_root>`。也可设置 `DAY_LOOM_FILESYSTEM_MCP_BIN` 指向已安装包的 `dist/index.js`，避免每次通过 `npx` 解析。

也可以连接已运行的网关：

```bash
day-loom revise \
  -d ./path/to/world \
  --mcp-base-url http://127.0.0.1:8765
```

自动化测试可绕过 AI：

```bash
day-loom revise \
  -d ./path/to/world \
  --proposal ./proposal.json \
  --dry-run
```

---

## daily：主角视角的当日计划

`daily` 用于制定当前 day 的初步计划。它会通过主角视角投影目录回答用户问题和收集今日意图；AI 不能读取完整 World，只能读取投影后的公开/已知信息。

```bash
day-loom daily -d ./path/to/world
```

会话命令：

```text
/pending   查看当前计划草稿
/start     生成初步 DailyPlan 并写入 days/day_NNNN/
/cancel    放弃并退出
/exit      保留 session 草稿并退出
```

`/start` 成功后会写入：

```text
days/day_NNNN/meta.yaml
days/day_NNNN/plan.user.md
days/day_NNNN/plan.initial.json
days/day_NNNN/dialogue/plan-transcript.md
```

自动化测试可使用 proposal 模式，不依赖 AI 或 MCP：

```bash
day-loom daily \
  -d ./path/to/world \
  --proposal ./daily-plan.json \
  --dry-run
```

第一版只生成方向性 `planned_beats`，不会生成具体事件、日记，也不会修改人物或场景记忆。

---

## play：逐事件执行当日计划

`play` 读取 `daily` 已生成的 `plan.initial.json`，一次只生成并执行一个事件。事件结算后，AI 会依据真实结果完成、取消、修改或插入后续 beat，因此后续事件不会预先写死。

```bash
day-loom play -d ./path/to/world
```

运行条件：

- 当前 World 的 `phase` 必须是 `planned` 或 `playing`
- 已设置 `DEEPSEEK_API_KEY`
- MCP / promptpile 依赖与 `daily` 相同

事件内支持多行自由输入。输入 `/status` 查看当前事件定义，输入 `/end-day` 立即结束当天并进入结算，输入 `/exit` 保存进度并退出；再次运行相同命令会从持久化步骤继续。

主要状态文件：

```text
days/day_NNNN/plan.current.json
days/day_NNNN/play.state.json
days/day_NNNN/runtime.state.json
days/day_NNNN/events/event_NNN/event.json
days/day_NNNN/events/event_NNN/transcript.md
days/day_NNNN/events/event_NNN/result.json
days/day_NNNN/events/event_NNN/replan.json
```

每个事件按 `生成 -> 交互 -> 结算 -> 重排` 推进。状态补丁和重排操作带有 applied 标记，进程中断后恢复时不会重复应用。所有 beat 完成或取消后，World 与当日 phase 会进入 `settling`，等待后续日终结算命令处理。
