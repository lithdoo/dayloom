# TODO：消息区获焦改为标题反馈

> **状态**：已完成  
> **范围**：`@dayloom/tui` MessageList  
> **约束**：不修改既有 `TODO.md` / `packages/tui/TODO.md` 正文；本文件为独立跟踪项  
> **日期**：2026-07

---

## 1. 问题

用户 Tab / Shift+Tab 把焦点切到历史消息区（`ScrollView`）时，**缺少清晰视觉反馈**。

完成前依赖 bindtty renderer 默认的**整块 focused inverse**：

- 空白区域没有 cell → inverse 几乎看不见
- 有内容时整片反色，阅读差、也不像「区域获焦」
- dayloom 使用 `showScrollbar` 时，`border` / `background` 画在**非焦点**外层，chrome 无法表达获焦

对比 Textarea：已用 `focusStyle="none"` + 自绘 caret；消息区现已对等（标题反馈）。

---

## 2. 目标

1. **取消**消息区默认整块反色
2. 在消息列表**上方加一行标题**，只在标题上表达获焦
3. 标题**不**进入焦点环（不增加 Tab 停靠点）
4. 焦点行为不变：仍由 `ScrollView` 接收焦点与方向键滚动

---

## 3. 非目标

- 不做「单条历史消息」选中 / 行级焦点
- 不改 Textarea / confirm 焦点模型
- 不把获焦与 `stickToBottom` 耦合

---

## 4. UI 设计

### 4.1 布局

```text
MessageList
└─ vstack gap={0}
   ├─ 标题行（1 行，纯展示，focusable=false）
   └─ ScrollView（唯一焦点目标，focusStyle="none"）
        └─ 既有 messages <for> …
```

### 4.2 标题视觉

| 状态 | en | zh | 样式 |
|------|----|----|------|
| 未获焦 | `Messages` | `消息` | `color="gray"`，非 bold |
| 获焦 | `Messages  ↑↓` | `消息  ↑↓` | `color="cyan"` + `bold` |

规则：

- 获焦只改文案与样式，**始终占 1 行**（避免布局跳动）
- 不用整行 inverse；与顶栏 `World:` 的 cyan 语言一致
- 后缀 `↑↓` 仅提示方向键可滚；Tab 说明仍放 Footer

可选（非必须）：获焦前缀 `▸ `，未获焦用等宽空格占位，防文字左右跳。

### 4.3 i18n 键（`@dayloom/core` messages）

```text
tui.messages.title
tui.messages.titleFocused
```

en / zh 都要补齐。

---

## 5. 实现要点

### 5.1 前置：ScrollView 支持 `focusStyle`（已完成）

bindtty **`0.1.0-alpha.7`** 已在 `ScrollView` / `VScrollView` / `HScrollView` 透传 `focusStyle`。  
dayloom 已 bump 到该版本；实现 Phase 1 时直接传 `focusStyle="none"` 即可。

### 5.2 dayloom `message-list.tsx`

本地 `focused` signal + 标题 `computed`；`ScrollView` 使用 `focusStyle="none"` 与 `onFocusChange`。

### 5.3 高度与 `CHROME_ROWS`

采用方案 A：`CHROME_ROWS = 10`；`ScrollView` `height` 仍用 `listHeight`（标题算在 chrome 里）。

### 5.4 焦点与按键（保持）

- Tab 环：MessageList `ScrollView` ↔ Textarea（及 confirm）
- `inputMode === 'hidden'`：`scrollOnArrow === true`
- `inputMode === 'text'`：`scrollOnArrow === false`
- 标题节点 **不**设 `focusable`

---

## 6. 任务清单

### Phase 0 — bindtty

- [x] `ScrollView` / `VScrollView` / `HScrollView`：透传 `focusStyle`（`0.1.0-alpha.7`）
- [x] dayloom bump 到 `0.1.0-alpha.7`

### Phase 1 — dayloom UI

- [x] i18n：`tui.messages.title` / `tui.messages.titleFocused`（en + zh）
- [x] `message-list.tsx`：标题行 + `onFocusChange` + `focusStyle="none"`
- [x] 调整 `CHROME_ROWS` 或 `listHeight`（§5.3）
- [x] 单元测：模板含标题；`onFocusChange(true/false)` 切换文案/颜色（可读 props / signal）

### Phase 2 — 验收

- [ ] Tab 到消息区：标题 cyan/bold（或带 `↑↓`），**正文不反色**（手工）
- [ ] Tab 到 Textarea：标题回 gray；caret 可见（手工）
- [ ] 消息很少 / 空白时，标题反馈仍清晰（手工）
- [ ] 方向键滚动（`inputMode === 'hidden'`）仍可用（手工）
- [ ] 全屏布局无裁切（手工）

---

## 7. 不要做

- 给每条消息单独 `focusable`
- 仅靠外层 `border` 当唯一反馈（scrollbar 模式下 border 不在焦点节点上）
- 获焦时改 `stickToBottom`
- 获焦时增删标题行数导致跳动

---

## 8. 参考代码位置

| 路径 | 说明 |
|------|------|
| `packages/tui/src/components/message-list.tsx` | 改造点（`VScrollView`） |
| `packages/tui/src/components/constants.ts` | `CHROME_ROWS` |
| `packages/core/src/i18n/messages.ts` | 文案键 |
| `bindtty/packages/widgets/src/scroll/v-scroll-view.ts` | 纵向滚动 + `focusStyle` |
| `bindtty/packages/renderer-terminal/src/paint.ts` | `paintFocusedState` / `focusStyle === "none"` |
| `packages/tui/src/components/text-input.tsx` | Textarea `focusStyle="none"` 对照 |

---

## 9. 完成定义

- [x] 消息区获焦仅标题反馈，无整区 inverse
- [x] i18n 齐全；Win / 中英文可读
- [x] 布局高度校准完成
- [x] 相关单测通过（Phase 2 手工验收可另做）

---

*本文件独立于仓库根 `TODO.md` 与 `packages/tui/TODO.md`，专跟踪「消息区标题获焦」一项。*
