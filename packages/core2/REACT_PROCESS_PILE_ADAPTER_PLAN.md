# Dayloom Core2：React Process Pile 适配与临时工作目录改造草案

> 状态：Draft / 可在上游协议冻结后实施  
> 日期：2026-08-23  
> 所有者：`dayloom/packages/core2`  
> 上游规范：`promptpile/packages/promptpile-react/PROCESS_PILE_STREAMING_PLAN.md`  
> 下游规范：`dayloom/packages/tui/REACT_TRANSPARENT_WORK_STREAMING_PLAN.md`

## 1. 职责

Core2 是 Promptpile React 与 Dayloom 应用之间唯一的反腐层：

```text
Promptpile React process-pile
→ transport owner
→ schema/FSM validator
→ temporary work owner
→ authority firewall
→ CoreEvent v2
```

Core2 负责：

- 启动、终止和 drain Promptpile React；
- 单流读取 process pile；
- 校验 schema、全局时序和 terminal 完整性；
- 创建并清理 caller-owned 临时 work root；
- 将合法事实投影为稳定 CoreEvent；
- 保证过程信息不能进入 Conversation、Archive 或 World。

Core2 不负责：

- 生成或修改 Thought/Observe/Check 正文；
- 读取 work 文件推断 React phase 或决策；
- 复制 Promptpile React 的业务 FSM；
- 决定 TUI 如何布局、替换或着色；
- 长期保存、归档、GC 或恢复临时 work。

## 2. 不变量

### 2.1 单一事实来源

启用 process pile 后：

```text
process-pile = 唯一 React 机器事件源
stdout       = drain only
stderr       = capped diagnostic only
child exit   = transport witness，不单独证明业务成功
```

禁止合并 stdout Agent Event v1 与 process pile；两个物理流之间不存在可验证的全局顺序。

### 2.2 Authority firewall

```text
temporary process information
= work.started / work.delta / work.ready / work.failed
+ workPath
+ Thought / Observe / Check text

authoritative information
= accepted user input
+ validated Final
+ submission result
+ Archive/World publication
```

- 前一组永远不能成为后一组的输入。
- Final delta 可展示，但只有合法 terminal Final 才能成为完成结果。
- Core2 不根据过程正文决定 World mutation。

### 2.3 Ownership

- 每个 operation 有唯一 `sessionId`、`processId`、`workId`。
- Final 有独立 `messageId`。
- 临时目录由 Core2 创建 root、React 创建 session child、Core2 最终清理。
- cancel/dispose/terminal 后迟到事件不能产生新的应用状态。

## 3. 启动与 transport

### 3.1 参数

Core2 为本次 runtime 创建专属临时 root，并启动：

```text
promptpile-react
  --work-root <runtimeTemp>/react-work
  --work-lifecycle caller
  --process-pile-fd <inheritedFd>
  --process-pile-format json
```

要求：

- process pile FD 与 child stdout/stderr 分离；
- Windows 使用明确的 inherited stdio slot，不依赖 shell 重定向；
- stdout 始终 drain，stderr capped；
- Core2 dispose 前必须结束 reader 和 child；
- argv、cwd、root identity 记录在 diagnostic，不写 Archive。

### 3.2 联合终态

Core2 同时观察：

```text
protocol terminal
process-pile EOF
child exit status
cancel/dispose intent
```

判定规则：

| 条件 | Core2 结论 |
| --- | --- |
| 合法 `process.completed` + EOF + exit 0 | React completed |
| 合法 `process.failed` + EOF + nonzero/zero | React failed，以协议错误为主 |
| EOF 前没有 terminal | `PROCESS_PILE_TRUNCATED` |
| terminal 后还有事件 | `PROCESS_PILE_INVALID` |
| completed 但 child nonzero | `PROCESS_EXIT_MISMATCH` |
| cancel intent 后 transport 关闭 | `CANCELLED`，不接受迟到业务事件 |

协议已断裂时不要求上游继续写 `process.failed`；Core2 自己形成 transport failure。

## 4. 严格 reducer

### 4.1 验证层次

按以下顺序验证，任一失败立即关闭 operation：

```text
JSONL framing
→ JSON Schema
→ process identity
→ continuous sequence
→ phase FSM
→ work path ownership
→ terminal consistency
```

必须验证：

- process ID 恒定；
- sequence 从 0 连续递增；
-恰好一个 process started；
-每个 phase 满足 `started → delta* → completed`；
- Thought/Observe/Check step index 合法；
- terminal Check 后 `work.ready` happens-before Final；
- Check 继续下一 step 时不得提前 ready；
- Final skipped 时不得出现 Final phase；
- terminal 唯一且之后无事件；
- aggregated Final delta 等于 terminal Final content。

### 4.2 适配器状态

```ts
type AdapterState =
  | { kind: 'starting' }
  | { kind: 'working'; processId: string; workId: string; step: number; phase: 'thought' | 'observe' | 'check' }
  | { kind: 'work-ready'; processId: string; workId: string; workPath: string }
  | { kind: 'final'; processId: string; workId: string; messageId: string; text: string }
  | { kind: 'completed'; final: string | null }
  | { kind: 'failed'; code: string }
  | { kind: 'cancelled' };
```

该状态机只验证上游事实并管理投影，不重新做 Check decision 或 React loop。

## 5. 临时 work owner

### 5.1 创建

```text
OS temp / caller runtime temp
  dayloom-core2-<runtimeId>/
    owner.json
    react-work/
      promptpile-react-session-<id>/
        .promptpile-react-session.json
        work/      # process event 公开的 workPath
        control/   # React 私有 handoff/Receipt
```

- Core2 创建唯一 runtime root 和 owner marker；
- Promptpile React 只能在 `react-work/` 下创建唯一 session child；
- process event 发布 canonical absolute `session/work/`，不得发布 session root 或 `control/`；
- Core2 验证 path 是本次 root 下合法 marker session 的 `work/` 子目录且真实存在；
-禁止 root escape 和 symlink traversal。

### 5.2 清理

唯一顺序：

```text
invalidate event generation
→ terminate/drain active child
→ close process reader
→ canonicalize exact owned target
→ validate owner marker
→ recursively delete runtime temp root
```

- 不使用未解析环境变量、glob 或模型提供的路径删除；
- 不扫描其他 runtime；
- cleanup failure 只产生 diagnostic，不污染已完成 Final；
- crash/SIGKILL orphan 由 OS temp policy 处理，本期不新增应用级 GC；
- restart 不恢复 work path。

## 6. CoreEvent v2

```ts
export type CoreEventV2 =
  | { type: 'work.started'; sessionId: string; workId: string; workPath: string }
  | {
      type: 'work.delta';
      sessionId: string;
      workId: string;
      phase: 'thought' | 'observe' | 'check';
      stepIndex: number;
      text: string;
    }
  | {
      type: 'work.ready';
      sessionId: string;
      workId: string;
      status: 'checked';
      workPath: string;
    }
  | {
      type: 'work.failed';
      sessionId: string;
      workId: string;
      status: 'failed' | 'cancelled';
      workPath: string | null;
      message: string;
    }
  | { type: 'output.started'; sessionId: string; messageId: string }
  | { type: 'output.delta'; sessionId: string; messageId: string; text: string }
  | { type: 'output.completed'; sessionId: string; messageId: string };
```

投影规则：

```text
process.started                     → work.started
phase.delta(thought|observe|check) → work.delta
work.ready                          → work.ready
phase.started(final)               → output.started
phase.delta(final)                 → output.delta
phase.completed(final)             → output.completed
process.failed                     → work.failed + CoreResult
```

CoreEvent 不暴露 Promptpile sequence、raw protocol error、tool arguments 或 provider metadata。TUI 不需要理解 process-pile schema。

## 7. CoreEvent v2 迁移

现有 `output.delta` 没有 messageId，不能安全承担多流身份。采用显式版本入口：

```ts
runReact({ eventProtocol: 'core-event-v1' | 'core-event-v2' })
```

迁移：

```text
Core2 先支持 v1 + v2
→ TUI 切换到 v2
→ 其他消费者迁移
→ 后续 major 删除 v1
```

- v2 字段不得 optional 化来兼容 v1；
- v1 继续走现有 Agent Event v1 adapter；
- v2 要求支持 process-pile 的 Promptpile React 版本；
-调用方显式选择，禁止运行时静默降级。

## 8. Archive 与 World 防火墙

```text
Archive input
= World state
+ accepted user turns
+ accepted Final
+ submission/publication metadata

Archive input
≠ work CoreEvent
≠ process-pile event
≠ workPath
≠ temporary phase text
```

实现约束：

- Archive DTO 不增加 workId/workPath/phase delta；
- Archive serializer 不依赖 React adapter 或 TUI presentation；
- `work.*` 只能发送给 live application observer；
- debug log 属于 runtime diagnostic，不属于 Archive V2；
-临时目录创建/删除不产生 World commit；
-无论 send、submit、failure 或 cancel，边界都不改变。

## 9. Cancel 与 dispose

### Cancel

```text
record cancel intent
→ invalidate application event generation
→ signal child
→ drain stdout/stderr/process pile
→ settle adapter as cancelled
→ emit at most one work.failed(cancelled)
```

若 cancel intent 与合法 terminal 竞争，以先被 reducer 接受的 terminal boundary 为准；一旦 cancel generation 失效，不再投影迟到 delta。

### Dispose

```text
cancel active operation
→ await terminal/drain
→ unsubscribe observers
→ cleanup owned temp root
→ mark runtime disposed
```

dispose 幂等，重复调用不重复删除或重复发事件。

## 10. 分阶段实施

### Phase 0：依赖冻结

- 锁定 process-pile schema、fixtures 和 Promptpile React 最低版本；
-确定 CoreEvent v2 public types；
-冻结 error code mapping。

### Phase 1：transport 与 validator

- inherited FD、stdout/stderr drain；
- JSONL/schema/sequence/FSM validator；
- EOF/exit/terminal 联合判定；
- truncated/mismatch failure。

### Phase 2：临时目录 owner

- root/marker 创建；
- argv 传递；
- path validation；
- cancel/dispose 精确清理。

### Phase 3：CoreEvent v2 与 authority firewall

-事件投影；
- Final aggregation；
- v1/v2 显式入口；
- Archive/World dependency guards。

### Phase 4：真实集成

- packaged Promptpile React child；
- Core2 E2E；
- Windows/Linux；
-失败、取消、dispose、重复调用。

## 11. 必测矩阵

### Protocol

- malformed JSON、schema error；
- sequence gap/duplicate/reorder；
- phase delta before start/after completed；
- Final before work.ready；
- missing/duplicate terminal；
- EOF/exit/terminal mismatch；
- partial Final 与 terminal content mismatch。

### Ownership

- root escape、symlink、marker mismatch；
-只删除当前 runtime root；
- cleanup failure 不覆盖 primary result；
- dispose/cancel 幂等；
- restart 不恢复临时 path。

### Authority

- work delta 不写 Conversation；
- Archive fixture 无 workId/workPath/phase text；
- failure/cancel 不产生过程归档；
- debug mode 不改变 Archive schema；
-临时目录清理不产生 World commit。

## 12. 完成定义

1. Core2 只消费单一 process pile，不合并双流时序。
2. schema、FSM、sequence、exit、EOF 与 terminal 全部严格验证。
3. 临时目录有唯一 owner，并在 dispose 后精确清理。
4. CoreEvent v2 隐藏上游协议细节并提供稳定身份。
5. v1/v2 迁移显式、无 optional 双义字段、无静默降级。
6. Thought/Observe/Check 和 workPath 不进入 Conversation、Archive 或 World。
7. cancel、failure、dispose 和迟到事件均有唯一可测试终态。
8. packaged Promptpile React → Core2 E2E 在 Windows/Linux 通过。
