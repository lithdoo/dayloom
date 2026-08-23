# Dayloom TUI：React 临时过程透明展示改造草案

> 状态：Draft / 可在 CoreEvent v2 冻结后实施  
> 日期：2026-08-23  
> 所有者：`dayloom/packages/tui`  
> 上游契约：`dayloom/packages/core2/REACT_PROCESS_PILE_ADAPTER_PLAN.md`

## 1. 职责与目标

TUI 只消费 CoreEvent v2，不读取 Promptpile process pile，也不理解 React 内部协议：

```text
CoreEvent work.started/delta/ready
→ 同一个 WORKING presentation item
→ ready 时原位替换为临时 work directory reference

CoreEvent output.started/delta/completed
→ 独立 AI message
```

用户体验：

```text
用户输入
→ Thought / Observe / Check 临时过程实时显示
→ 临时过程块被 work directory 地址原位替换
→ Final 独立流式显示
```

TUI 不负责：

- process-pile schema、sequence 或 React FSM 校验；
- child process、FD、work root 或清理实现；
-读取、tail 或解析 work directory；
- 将过程信息写入 Conversation、Archive 或 World；
-长期保存、恢复或 GC work path。

## 2. 不变量

### 2.1 Presentation 不等于 transcript

```text
working / work-reference
= 临时 session presentation

assistant Final
= 正式 transcript message
```

- Thought/Observe/Check 不得伪装为 assistant message。
- work reference 不得进入正式 transcript DTO。
- Final 必须使用独立 messageId。
- ready 时只替换匹配 workId，不能“删除最后一条消息”。

### 2.2 生命周期

- work path 只保证在当前 session 调试生命周期内有效。
- dispose 后必须显示 cleaned/expired 或移除 session presentation。
- TUI 不承诺重启恢复。
- Hub、submission receipt 和 Archive 不保存 work path。
- cancel/dispose/terminal 后迟到事件不能复活旧 item。

### 2.3 透明标签

工作过程必须明确标注：

```text
临时过程
非最终内容
不进入存档
```

避免用户把可见过程误认为已接受事实或正式回答。

## 3. 输入契约

TUI 只处理以下 CoreEvent v2：

```ts
type TuiCoreEvent =
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

TUI 信任 Core2 已完成协议与 path ownership 验证，只做自身 presentation state 验证。出现不可能事件时忽略 mutation、记录 diagnostic，不尝试修复上游顺序。

## 4. View model

```ts
type TuiPresentationItem =
  | {
      kind: 'working';
      id: `work:${string}`;
      sessionId: string;
      workId: string;
      phase: 'thought' | 'observe' | 'check';
      stepIndex: number;
      text: string;
      status: 'streaming';
    }
  | {
      kind: 'work-reference';
      id: `work:${string}`;
      sessionId: string;
      workId: string;
      status: 'checked' | 'failed' | 'cancelled' | 'cleaned';
      workPath: string | null;
      detail: string | null;
    }
  | TuiMessage;

interface TuiMessage {
  kind: 'message';
  id: string;
  role: 'user' | 'assistant' | 'system' | 'error' | 'warn';
  text: string;
  status: 'streaming' | 'complete' | 'error';
}
```

`working` 与 `work-reference` 使用同一个 presentation ID：

```text
work:<workId>
```

因此替换是类型状态转换，不是删除和重建不相关 item。

## 5. Reducer

### 5.1 转换

```text
work.started(workId)
→ append working(workId)

work.delta(workId, phase, step)
→ 只追加到匹配且 streaming 的 working
→ 更新 phase 和 step

work.ready(workId)
→ 原位 replace 为 work-reference(checked)
→ 丢弃屏幕上的过程正文

work.failed(workId)
→ 原位 replace 为 work-reference(failed|cancelled)

output.started(messageId)
→ append 独立 assistant message(streaming)

output.delta(messageId)
→ 只追加到匹配 message

output.completed(messageId)
→ message complete
```

Final skipped 时不会出现 output events，TUI 不创建空 assistant message。

### 5.2 防串流条件

拒绝 mutation：

- sessionId 不是当前 presentation generation；
- workId/messageId 不存在或不是 live 状态；
-重复 started/ready/completed；
- ready/failed 后仍到达 work delta；
- completed/error 后仍到达 output delta；
- cancel intent 或 dispose 已使 generation 失效。

Reducer 必须是纯函数；打开目录、复制 path、取消 child 等副作用放在 driver/effect 层。

### 5.3 内存与 transcript 限制

- active working 和 streaming Final 不参与普通 transcript eviction；
- work.ready 后立即释放累积过程正文，只保留 path/status；
-过程正文设置仅用于 UI 防失控的内存上限，超限时可折叠旧文本但不得伪造丢失内容；
-该上限不影响 Core2 或 React 执行；
- work/reference 不进入导出 transcript。

## 6. 展示设计

### 6.1 Working

```text
[WORKING · THOUGHT · 临时过程 · 不进入存档]
正在检查人物和当前世界状态……

[WORKING · OBSERVE · 临时过程 · 不进入存档]
当前场景中……

[WORKING · CHECK · 临时过程 · 不进入存档]
正在核对是否进入最终回答……
```

- phase 变化更新标题，不创建三个分散 block；
-保留已有正文，用户能看到过程连续性；
-明确区分 WORKING 与 AI Final 的视觉层级；
-光标、滚动和 resize 不应造成正文重复。

### 6.2 Work reference

```text
[WORK · TEMPORARY · CHECKED]
C:\...\react-work\promptpile-react-session-...\work
仅用于当前会话调试；会话结束后删除
```

失败：

```text
[WORK · FAILED]
过程未完成；临时目录仅用于当前会话排查
```

清理后：

```text
[WORK · CLEANED]
临时工作目录已随会话清理
```

### 6.3 Final

```text
[AI]
Final 正在流式输出……
```

Final 必须在 work reference 之后出现，并作为独立 transcript message。TUI 不把 work 文本拼入 Final，也不从 work path生成摘要。

## 7. 交互

- work reference 可聚焦；
- Enter 复制当前真实路径；
- `o` 仅在用户明确触发后调用平台安全打开 API；
-禁止字符串拼接 shell command；
- path 为空或已 cleaned 时禁用复制/打开；
-窄终端可折叠 path，聚焦详情显示完整路径和临时生命周期；
-帮助文本明确 work 不进入存档。

打开目录失败只更新本地提示，不改变 Core2 operation、Final 或 World 状态。

## 8. 页面生命周期

### 8.1 Send

```text
ready
→ working stream
→ work reference
→ Final stream（或 skipped）
→ ready
```

同一 session 内下一次 send 使用新 workId/messageId；旧 reference 可显示到 session dispose。

### 8.2 Submit

```text
working/reference
→ Final JSON
→ strict parse
→ Archive publication
→ invalidate presentation generation
→ Core2 dispose/cleanup
→ Hub
```

Hub 和 submission receipt 不保存 work path。Archive 只包含正式 Final 与 World publication 数据。

### 8.3 Failure

- React/Check failure：working 原位标记 failed，不创建空 Final。
- Final failure：work reference 保留到 dispose，Final 标记 error。
- publication failure：不改变 work 的临时属性，不把过程写入 Archive。

### 8.4 Cancel

```text
record cancel intent
→ invalidate presentation generation
→ request Core2 cancel
→ ignore late deltas
→ settle working as cancelled（若页面仍展示）
```

TUI 不自行 kill child，也不自行删除目录。

### 8.5 Dispose

```text
invalidate generation
→ unsubscribe observer
→ await Core2 dispose
→ mark references cleaned or discard session presentation
```

dispose 必须幂等。TUI 不能在 cleanup 后继续显示路径“可打开”。

## 9. 实施阶段

### Phase 0：契约冻结

- 锁定 CoreEvent v2 类型和 Core2 最低版本；
-冻结 Final skipped、failure、cancel fixtures；
-明确 presentation generation 生命周期。

### Phase 1：纯 reducer

- working/reference/message 类型；
- workId/messageId 精确归属；
-原位替换；
- late/duplicate event guards；
- property-style reducer sequence tests。

### Phase 2：Runtime driver

- CoreEvent v2 subscription；
- cancel/dispose generation token；
- effect 与 reducer 分离；
- active item eviction guard。

### Phase 3：UI 与交互

- phase labels 和临时/非归档提示；
-复制、安全打开、cleaned 状态；
-中文宽字符、resize、滚动和窄屏。

### Phase 4：真实 E2E

```text
packaged Promptpile React
→ Core2 process adapter
→ TUI runtime driver
→ presentation reducer/view
```

最终 E2E 不能由同一个 fake 同时模拟 producer 和 consumer。

## 10. 必测矩阵

### Reducer

- working 原位替换为 reference；
- Final 始终是新 message；
- Thought/Observe/Check phase 更新不创建重复 block；
-多次 send 不串 workId/messageId；
- duplicate/late events 不污染当前 generation；
- Final skipped 不产生空 message；
- failure/cancel 有唯一 presentation state。

### Lifecycle

- active working/Final 不被 transcript eviction；
- dispose 后 path 不再显示可用；
- cancel 后迟到 delta 不复活；
- Hub/receipt/export transcript 不含 work path；
-打开目录失败不改变业务结果。

### Rendering/E2E

- Windows/Linux path；
-中文宽字符、快速 delta、resize、滚动；
-各 phase cancel；
- Check/Final/publication failure；
- session 调试期 path 可打开，dispose 后被清理；
- Archive/World 只包含正式权威内容。

## 11. 完成定义

1. TUI 只消费 CoreEvent v2，不理解 process-pile 或 React FSM。
2. Thought、Observe、Check 显示为同一个明确标注的临时工作块。
3. work.ready 通过 workId 将工作块原位替换为临时目录地址。
4. Final 使用独立 messageId 和正式 transcript message。
5. 工作正文和路径不进入 transcript export、Archive 或 World。
6. cancel、failure、dispose、重复和迟到事件不能串流或复活旧 UI。
7. reducer 纯净，副作用由 driver/effect 层负责。
8.真实 Promptpile React → Core2 → TUI E2E 在 Windows/Linux 通过。
