---
layout: home
hero:
  name: Dayloom
  text: 以“天”为单位推进的 AI 生活模拟与日记生成引擎
  tagline: 用明确的 World 状态机、可恢复 Session 和不可变存档，组织长期叙事。
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/GETTING_STARTED
    - theme: alt
      text: TUI 指南
      link: /guide/TUI
    - theme: alt
      text: 文档索引
      link: /README
features:
  - title: 以天推进
    details: 从计划、行动到结算，每一步都由可验证的 World phase 管理。
  - title: 显式会话提交
    details: AI 对话不会自动改变 World；只有明确 submit 才发布业务产物。
  - title: 原子存档
    details: current pointer 引用不可变 commit 和 revision，失败操作不污染已发布状态。
---

## 安装与构建

```bash
npm install
npm run build -w @dayloom/core -w @dayloom/tui
```

## 启动 TUI

```bash
npm run tui -- ./path/to/world
```

未传入 World 路径时使用当前工作目录。真实 AI 对话默认通过 Promptpile 调用 DeepSeek：

```bash
export DEEPSEEK_API_KEY=your-key
```

## World 的一天

```text
idle → planning → planned → playing → awaiting-settle → idle
          submit                submit              settle
```

- `daily`：和 AI 制定当日计划。
- `play`：推进当日事件和行动。
- `settle`：发布结算并进入下一天。
- `revise`：在稳定边界修订 World 设定。

## 下一步

- [快速开始](/guide/GETTING_STARTED)
- [World 生命周期](/guide/WORLD_LIFECYCLE)
- [TUI 使用指南](/guide/TUI)
- [Core 包文档](/packages/CORE)
- [完整文档索引](/README)

