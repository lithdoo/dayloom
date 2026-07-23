# TODO：手动上滚时勿被 stickToBottom 拽回

> **状态**：待做  
> **范围**：`@dayloom/tui-old` MessageList / ViewModel；依赖 ScrollView `onOffsetYChange` / `stickToBottom`  
> **约束**：独立跟踪，不改正文其它 `TODO*.md`  
> **日期**：2026-07  
> **相关**：流式 `appendStream` throttle（已落地）；[`TODO-user-message-history.md`](./TODO-user-message-history.md)

---

## 1. 问题

`appendStream` 发布内容时会 `stickToBottom.set(true)`。用户若正在 **向上翻看历史**，新的流式 chunk / 写消息仍强制贴底，**阅读被打断**。

现状：

- `stickToBottom` 默认 `true`
- `publishPendingStream` 每次发布都 `stickToBottom.set(true)`
- MessageList：`stickToBottom={vm.stickToBottom}`，箭头滚动由 `scrollOnArrow` 控制
- 未根据「用户是否已离开底部」关闭 stick

---

## 2. 目标

1. 用户手动滚离底部 → **暂停**自动贴底  
2. 用户滚回底部（或显式「回到底部」）→ **恢复** stick  
3. 用户新提交一条输入（未来 `[YOU]` echo）→ 建议重新 stick（跟对话）  
4. 不改变 `scrollOnArrow` 与 `inputMode` 的既有关系

---

## 3. 非目标

- 不做完整「未读分隔线 / 新消息角标」（可列二期）
- 不改 bindtty ScrollView 核心算法（优先用现有 props）
- 不禁用流式 throttle

---

## 4. 设计

### 4.1 状态

```ts
// ViewModel 已有
stickToBottom: Signal<boolean>;
setStickToBottom(value: boolean): void;

// 可选内部
userPinnedAwayFromBottom: boolean; // 或仅靠 stickToBottom=false 表达
```

### 4.2 规则

| 事件 | 行为 |
|------|------|
| 用户 ↑ / PageUp / 滚轮导致 `offsetY < max`（离底） | `setStickToBottom(false)` |
| 用户 ↓ 回到 `offsetY >= max - ε`（贴底） | `setStickToBottom(true)` |
| `appendStream` 发布 | **仅当** `stickToBottom === true` 时保持 stick；**不要**无条件 `set(true)` |
| `appendMessage` / 用户 echo / `write` | 若希望跟对话：可 `setStickToBottom(true)`；或仅用户提交时打开 |
| `flushStream` 落盘 | 同上，尊重当前 stick 标志 |

关键修复：去掉（或收窄）`publishPendingStream` 里无条件的 `stickToBottom.set(true)`。

### 4.3 如何知道「离底」

ScrollView 已支持 `onOffsetYChange`。受控模式：

```tsx
const offsetY = createSignal(0);

<ScrollView
  offsetY={offsetY}
  onOffsetYChange={(y) => {
    offsetY.set(y);
    // 与 content 高度 / viewport 比较 → 是否在底部
    if (isNearBottom(y, layout)) vm.setStickToBottom(true);
    else vm.setStickToBottom(false);
  }}
  stickToBottom={vm.stickToBottom}
  ...
/>
```

若 widgets 在 `stickToBottom===true` 时仍通过 layout 拉到底，则 `onOffsetYChange` + 手动判断即可。

需查阅 / 实测：`stickToBottom` 为 true 时用户 ↑ 是否立刻被拉回；若会被拉回，必须在第一次离底时先 `setStickToBottom(false)`（在同一次 key 处理路径上）。

### 4.4 可选 UX

- 离底时 Footer 或消息标题旁显示 `↓ new`（二期）
- End 键：强制 `setStickToBottom(true)`（ScrollView 若已支持 End→max，对齐即可）

---

## 5. 任务清单

- [ ] 梳理 ScrollView：`stickToBottom` + 箭头键 + `onOffsetYChange` 交互（可写最小复现）
- [ ] 移除流式路径上「无条件 stick=true」
- [ ] 离底 → stick false；回底 → stick true
- [ ] （推荐）用户提交 / `io.write` 后 stick true
- [ ] 单测：mock offset 离底后 appendStream 不强制改 stick；回底后恢复
- [ ] 手工：上滚看旧消息时流式输出不抢视口；滚到底后继续跟流

---

## 6. 验收

1. 历史较长时，↑ 离开底部，AI 仍在流式输出 → **视口不动**  
2. 再 ↓ / End 到顶部底部 → 后续 chunk **继续跟底**  
3. 新提交命令后 → 跟到底看到 `[YOU]` + 回复（与 user-history TODO 配合）

---

## 7. 参考

| 路径 | 说明 |
|------|------|
| `packages/tui-old/src/view-model.ts` | `publishPendingStream` / `setStickToBottom` |
| `packages/tui-old/src/components/message-list.tsx` | ScrollView 绑定 |
| `bindtty/packages/widgets/src/scroll/scroll-view.ts` | `stickToBottom` / `onOffsetYChange` |

---

*独立跟踪「stickToBottom 与手动滚动冲突」。*
