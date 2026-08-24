# Dayloom TUI：React 过程流透明展示改造草案

> 状态：Implemented / CoreEvent v1 闭环落地
> 日期：2026-08-23
> 所有者：`dayloom/packages/tui`
> 上游契约：`dayloom/packages/core/REACT_PROCESS_PILE_ADAPTER_PLAN.md`

## 1. 目标

TUI 在用户与 AI 对话期间按需展示 Thought、Observe、Check 实时过程；过程完成后原位收束为简短状态，再独立流式展示 Final。

```text
用户输入
→ Thought / Observe / Check 临时过程流
→ 原位收束为 React 临时工作目录地址
→ Final 独立流式输出
```

TUI 只消费 CoreEvent v1，不读取 Process Pile。它只显示 Core 转发的临时路径字符串，不主动读取目录内容。

## 2. 职责边界

TUI 负责：

- 订阅 Core 的 `work.*` 和 `output.*`；
- 将一个 operation 的过程显示为一个可更新 presentation item；
- 按 phase 更新标题并追加正文；
- 在完成、失败或取消时原位收束；
- 将 Final 显示为独立 assistant message；
- 用 generation 防止迟到事件串入新 operation。

TUI 不负责：

- 理解 Process Pile schema、sequence 或 React FSM；
- 启动、取消或清理 child process；
- 创建、读取或删除 React 工作目录；
- 将 `workPath` 持久化或写入 transcript；
- 将过程信息写入 transcript、Conversation、Archive 或 World；
- 根据过程正文推断业务状态。

## 3. 不变量

### 3.1 Presentation 不等于 transcript

```text
working item = 临时 UI presentation
assistant message = 正式 Final transcript
```

- Thought/Observe/Check 不得伪装成 assistant message；
- working item 不进入 transcript DTO 或导出；
- Final 始终使用独立 messageId；
- 收束按 `sessionId + operationId` 精确原位更新，不能删除“最后一条消息”。

### 3.2 临时路径契约

- TUI 接收 `workPath`，但不接收 `workId` 或 React processId；
- `workPath` 是 opaque presentation metadata，不是持久状态；
- TUI 不根据路径推断 operation、phase 或业务结果；
- 路径只保证在 React operation 运行期间可能有效；
- `output.completed`、`output.failed` 或 `work.failed` 后将路径标记为 expired；
- 调试文件生命周期和清理由 Promptpile React 独立负责。

### 3.3 明确标签

过程块必须显示：

```text
临时过程 · 非最终内容 · 不进入存档
```

避免用户把可见过程误认为正式回答、已接受事实或 World mutation。

## 4. 输入契约

```ts
type TuiCoreEventV1 =
  | { type: 'state.changed'; state: CoreState }
  | { type: 'work.started'; sessionId: string; operationId: string; workPath: string }
  | {
      type: 'work.delta';
      sessionId: string;
      operationId: string;
      phase: 'thought' | 'observe' | 'check';
      stepIndex: number;
      text: string;
    }
  | { type: 'work.completed'; sessionId: string; operationId: string; workPath: string }
  | { type: 'work.failed'; sessionId: string; operationId: string; status: 'failed' | 'cancelled'; message: string; workPath: string | null }
  | { type: 'output.started'; sessionId: string; operationId: string; messageId: string }
  | { type: 'output.delta'; sessionId: string; operationId: string; messageId: string; text: string }
  | { type: 'output.completed'; sessionId: string; operationId: string; messageId: string }
  | { type: 'output.failed'; sessionId: string; operationId: string; messageId: string; message: string };
```

TUI 信任 Core 已完成上游协议验证，只验证自身 presentation 状态。遇到不可能事件时忽略 mutation 并记录受限 diagnostic，不尝试修复上游时序。

## 5. View model

```ts
type TuiPresentationItem = WorkingItem | TuiMessage;

interface WorkingItem {
  kind: 'working';
  id: `operation:${string}:${string}`;
  sessionId: string;
  operationId: string;
  phase: 'thought' | 'observe' | 'check' | null;
  stepIndex: number | null;
  text: string;
  status: 'streaming' | 'completed' | 'failed' | 'cancelled';
  workPath: string | null;
  pathStatus: 'live' | 'expired';
  detail: string | null;
}

interface TuiMessage {
  id: string;
  operationId?: string;
  role: 'user' | 'assistant' | 'system' | 'error' | 'warn';
  text: string;
  status: 'streaming' | 'complete' | 'error';
}
```

Working item 使用稳定 ID `operation:<sessionId>:<operationId>`。Final 使用 Core 提供的 messageId，绝不复用 working item ID。

## 6. Reducer

### 6.1 转换

```text
work.started(operation)
→ append working(streaming)

work.delta(operation, phase, step)
→ 向匹配且 streaming 的 working 追加 text
→ 更新 phase 和 step

work.completed(operation)
→ 原位清空过程正文
→ working(completed, workPath, pathStatus=live)

work.failed(operation, failed)
→ 原位清空过程正文
→ working(failed, safe message)

work.failed(operation, cancelled)
→ 原位清空过程正文
→ working(cancelled, "工作过程已取消")

output.started(messageId)
→ append 独立 assistant message(streaming)

output.delta(messageId)
→ 只追加到匹配且 streaming 的 message

output.completed(messageId)
→ message complete
→ 对应 working pathStatus=expired

output.failed(messageId)
→ message error
→ 对应 working pathStatus=expired
```

Final skipped 时不会出现 `output.*`，TUI 不创建空 assistant message。

### 6.2 防串流

拒绝以下 mutation：

- sessionId 不是当前页面 Session；
- operationId 不属于当前或仍展示的 operation；
- started 重复；
- completed/failed 后仍到达 work delta；
- messageId 不存在或不属于对应 operation；
- output completed/error 后仍到达 delta；
- cancel/dispose 已使 presentation generation 失效。

Reducer 必须是纯函数。订阅、取消请求、滚动和计时属于 driver/effect 层。

### 6.3 内存限制

- active working 和 streaming Final 不参与普通 transcript eviction；
- 过程正文设置 UI 内存上限；
- 超限时在本地折叠最早文本，并显示“部分较早过程已折叠”；
- `work.completed/failed` 后立即释放累积过程正文；
- 内存限制不得影响 Core 或 React 执行；
- working item 不进入 transcript export。

## 7. 展示设计

Streaming：

```text
[WORKING · THOUGHT]
临时过程 · 非最终内容 · 不进入存档

正在检查人物和当前世界状态……
```

Phase 变化时只更新同一块标题：`THOUGHT → OBSERVE → CHECK`。

完成后原位收束：

```text
[WORK · TEMPORARY]
C:\...\promptpile-react-session-...\work
仅在本次处理运行期间有效
```

失败或取消：

```text
[WORKING · FAILED]
工作过程未完成

[WORKING · CANCELLED]
工作过程已取消
```

Final：

```text
[AI]
Final 正在流式输出……
```

Final 是独立 transcript message。TUI 不把过程正文拼入 Final，也不从过程内容生成摘要。

operation 终态后保留地址文本但标记为 `EXPIRED`，不得继续声称目录存在。可提供复制；若提供打开操作，必须由用户明确触发平台安全 API，禁止拼接 shell command。打开失败只更新本地提示，不改变 Core 或 World 状态。

## 8. 页面生命周期

### 8.1 Send

```text
ready
→ work.started/delta
→ work.completed
→ output.started/delta/completed（或 Final skipped）
→ ready
```

同一 Session 的下一次 send 使用新的 operationId。旧 completed item 可以保留在当前页面，但不进入 transcript 数据。

### 8.2 Submit

```text
working stream
→ working path reference
→ Final JSON stream
→ output completed
→ Core strict parse/publication
→ invalidate presentation generation
→ Hub
```

Hub、submission receipt、Archive 和 World 不保存 working item。

### 8.3 Failure

- Final 前失败：working 原位标记 failed，不创建空 assistant message；
- Final streaming 后失败：working 路径标记 expired，Final message通过 `output.failed` 标记 error；
- publication failure：不改变过程的临时属性，不把过程写入 Archive。

### 8.4 Cancel

```text
request Core cancel
→ Core work.failed(cancelled)
→ reducer 原位收束
→ generation 失效
→ ignore late events
```

TUI 不自行 kill child，也不等待或删除 React 文件。

### 8.5 Dispose

```text
invalidate generation
→ unsubscribe observer
→ await Core dispose
→ discard session presentation
```

dispose 幂等；迟到事件不能复活页面状态。

## 9. 可选监听

CoreEvent v1 提供完整过程流，TUI 可以按调用方配置选择展示级别：

```ts
type WorkVisibility = 'hidden' | 'thought' | 'thought-observe' | 'all';
```

- `hidden` 仍消费生命周期事件，但不渲染过程正文；
- 其他模式仅影响展示，不影响 Core 验证、取消和 Final；
- 切换可见性不写 Conversation 或 Archive；
- 默认策略由产品配置决定，不改变事件协议。

## 10. 分阶段实施

### Phase 0：冻结契约

- 锁定 CoreEvent v1 和 Core 最低版本；
- 冻结 operationId/messageId、Final skipped、failure、cancel fixtures；
- 明确 presentation generation 生命周期。

### Phase 1：纯 reducer

- working/message 类型；
- operationId/messageId 精确归属；
- 原位收束与正文释放；
- late/duplicate guards；
- property-style sequence tests。

### Phase 2：Runtime driver

- CoreEvent v1 subscription；
- visibility filter；
- cancel/dispose generation token；
- effect 与 reducer 分离。

### Phase 3：UI

- phase labels、临时/非归档提示；
- completed/failed/cancelled 收束状态；
- 中文宽字符、resize、滚动、快速 delta；
- 屏幕阅读器和低动态模式。

### Phase 4：真实 E2E

```text
packaged Promptpile React
→ Core Process Pile adapter
→ TUI driver
→ presentation reducer/view
```

最终 E2E 不能由同一个 fake 同时模拟 producer 和 consumer。

## 11. 必测矩阵

Reducer：Thought/Observe/Check 更新同一 item；completed 原位收束并释放正文；Final 是独立 message；连续 send 不串身份；duplicate/late 不污染当前 generation；Final skipped 无空 message；failure/cancel 各有唯一终态。

Lifecycle：cancel 后迟到 delta 不复活；dispose 后无新 presentation；hidden 模式不影响 operation；Hub/receipt/export 不含过程正文；TUI 不访问 React work path 或文件系统。

Rendering/E2E：中文宽字符、快速 delta、resize、滚动；各阶段 cancel；Check/Final/publication failure；多次 send 后 submit 不串流；Archive/World 只包含正式内容。

## 12. 完成定义

1. TUI 只消费 CoreEvent v1，不理解 Process Pile 或 React FSM。
2. Thought、Observe、Check 显示为一个明确标注的临时 working item。
3. work.completed 后原位显示临时目录地址，operation 终态后明确标记 expired。
4. Final 使用独立 messageId 和正式 transcript message。
5. 过程正文不进入 transcript export、Conversation、Archive 或 World。
6. cancel、dispose、重复和迟到事件不能串流或复活旧 UI。
7. reducer 纯净，副作用由 driver/effect 层负责。
8. TUI 不创建、读取或删除 React 临时文件；路径打开只能由用户明确触发安全平台 API。
9. 真实 Promptpile React → Core → TUI E2E 在 Windows/Linux 通过。

## 13. 实施结果

- `presentation-reducer.ts` 提供纯 reducer、精确身份归属、终态关闭和 64K 过程正文上限；
- `TuiDriverState.messages` 只包含正式 transcript，`presentationItems` 保存有序 UI presentation；
- `workVisibility` 支持 `hidden`、`thought`、`thought-observe`、`all`，默认 `all`；
- working 与 Final 分别使用 operation ID 和 Core message ID，不复用 UI 身份；
- driver 在 cancel、dispose、页面切换和新 operation 时关闭或丢弃旧 generation；
- UI 明示过程为临时、非最终、不归档内容，并在终态将路径标记为 expired；
- reducer、driver、PTY 和真实 Promptpile React → Core → TUI 集成测试共同覆盖正常、失败、取消、迟到和容量路径。
