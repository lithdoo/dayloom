# TODO：消息区获焦改为标题反馈

> **状态**：待做  
> **范围**：`@dayloom/tui` MessageList；可能需小改 `@bindtty/widgets` `ScrollView`  
> **约束**：不修改既有 `TODO.md` / `packages/tui/TODO.md` 正文；本文件为独立跟踪项  
> **日期**：2026-07

---

## 1. 问题

Tab / Shift+Tab 把焦点切到历史消息区（`ScrollView`）时，**缺少清晰视觉反馈**。

现状依赖 bindtty renderer 默认的**整块 focused inverse**：

- 空白区域没有 cell → inverse 几乎看不见
- 有内容时整片反色，阅读差、也不像「区域获焦」
- dayloom 使用 `showScrollbar` 时，`border` / `background` 画在**非焦点**外层，chrome 无法表达获焦

对比 Textarea：已用 `focusStyle="none"` + 自绘 caret；消息区没有对等方案。

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

### 5.1 前置：ScrollView 支持 `focusStyle`

当前 `@bindtty/widgets` `ScrollView` **未**把 `focusStyle` 传到内部 focusable `box`。  
只加标题、不关 inverse → 会出现「标题亮了 + 正文仍反色」。

**必须**：

- 在 `ScrollViewProps` 增加 `focusStyle?: BindingValue<'inverse' | 'none'>`
- 写到内部 scroll box（与 `focusable` / `onKey` 同层）
- 默认行为保持不变（未传则仍默认 inverse）
- widgets 单测：传 `focusStyle="none"` 时 props 落到 focusable box

版本策略（择一）：

1. bindtty 发版后 dayloom  bump（当前基线 `0.1.0-alpha.6`）
2. 开发期 `file:` 链本地 bindtty 打补丁

### 5.2 dayloom `message-list.tsx`

```tsx
const focused = createSignal(false);
const title = computed(() =>
  focused.get() ? vm.t('tui.messages.titleFocused') : vm.t('tui.messages.title'),
);
const titleColor = computed(() => (focused.get() ? 'cyan' : 'gray'));

return (
  <box flexGrow={1} flexShrink={1}>
    <vstack gap={0}>
      <text
        value={title}
        color={titleColor}
        bold={focused}
        wrap="truncate-end"
      />
      <ScrollView
        id="dayloom-message-scroll"
        focusStyle="none"
        onFocusChange={(event) => focused.set(event.focused)}
        width={vm.viewportWidth}
        height={vm.listHeight}   // 见 5.3：高度是否含标题要算清
        border={false}
        padding={0}
        stickToBottom={vm.stickToBottom}
        scrollOnArrow={scrollOnArrow}
        showScrollbar={{ vertical: true, horizontal: false }}
      >
        {/* 既有 for each messages */}
      </ScrollView>
    </vstack>
  </box>
);
```

`focused` 可放 MessageList 本地 signal；无需进 ViewModel，除非别处要读。

### 5.3 高度与 `CHROME_ROWS`

标题多占 **1 行**。

当前 `CHROME_ROWS = 9`，`listHeight = viewportHeight - CHROME_ROWS - inputViewportRows`。

两种算法（选一种写清并测）：

| 方案 | 做法 |
|------|------|
| A（推荐） | `CHROME_ROWS` 改为 `10`；`ScrollView` `height` 仍用 `listHeight`（标题算在 chrome 里） |
| B | `CHROME_ROWS` 不变；`ScrollView` `height={listHeight - 1}`，标题挤占 list 高度 |

验收：底栏 / 输入区不被裁切，消息区不溢出。

### 5.4 焦点与按键（保持）

- Tab 环：MessageList `ScrollView` ↔ Textarea（及 confirm）
- `inputMode === 'hidden'`：`scrollOnArrow === true`
- `inputMode === 'text'`：`scrollOnArrow === false`
- 标题节点 **不**设 `focusable`

---

## 6. 任务清单

### Phase 0 — bindtty

- [ ] `ScrollView` / 如有对称的 `VScrollView`：透传 `focusStyle`
- [ ] 单测：默认无 `focusStyle`；显式 `"none"` 出现在 focusable box props
- [ ] 发版或本地 `file:` 接入 dayloom

### Phase 1 — dayloom UI

- [ ] i18n：`tui.messages.title` / `tui.messages.titleFocused`（en + zh）
- [ ] `message-list.tsx`：标题行 + `onFocusChange` + `focusStyle="none"`
- [ ] 调整 `CHROME_ROWS` 或 `listHeight`（§5.3）
- [ ] 单元测：模板含标题；`onFocusChange(true/false)` 切换文案/颜色（可读 props / signal）

### Phase 2 — 验收

- [ ] Tab 到消息区：标题 cyan/bold（或带 `↑↓`），**正文不反色**
- [ ] Tab 到 Textarea：标题回 gray；caret 可见
- [ ] 消息很少 / 空白时，标题反馈仍清晰
- [ ] 方向键滚动（`inputMode === 'hidden'`）仍可用
- [ ] 全屏布局无裁切

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
| `packages/tui/src/components/message-list.tsx` | 改造点 |
| `packages/tui/src/components/constants.ts` | `CHROME_ROWS` |
| `packages/core/src/i18n/messages.ts` | 文案键 |
| `bindtty/packages/widgets/src/scroll/scroll-view.ts` | 透传 `focusStyle` |
| `bindtty/packages/renderer-terminal/src/paint.ts` | `paintFocusedState` / `focusStyle === "none"` |
| `packages/tui/src/components/text-input.tsx` | Textarea `focusStyle="none"` 对照 |

---

## 9. 完成定义

- [ ] 消息区获焦仅标题反馈，无整区 inverse
- [ ] i18n 齐全；Win / 中英文可读
- [ ] 布局高度校准完成
- [ ] 相关单测或 PTY 手工步骤通过

---

*本文件独立于仓库根 `TODO.md` 与 `packages/tui/TODO.md`，专跟踪「消息区标题获焦」一项。*
