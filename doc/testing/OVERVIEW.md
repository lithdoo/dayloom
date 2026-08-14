# 测试概览

> **类型**：testing  
> **状态**：implemented  
> **最后核对**：2026-07

## Core

```bash
npm run test -w @dayloom/core
```

Core 测试包含：

- archive 原子发布、失败注入、冲突、inspection、GC 和恢复；
- phase/command availability 矩阵和纯 transition；
- Runtime 事件顺序、mutation lock、dispose 和失败边界；
- schema/validator 的 valid/invalid fixture；
- SessionManager 的 prepare/activate、input task、submit/cancel 和 listener 隔离；
- natural-language Session 和 Promptpile stream；
- 公共 TypeScript 导出的编译 smoke test。

## TUI

```bash
npm run test -w @dayloom/tui
```

TUI 测试先构建 TypeScript，再串行运行 Runtime driver/ViewModel 测试和真实 PTY 场景。详见 [TUI E2E](/testing/TUI_E2E)。

## 全部活跃包

针对本文档站覆盖的当前实现：

```bash
npm run build -w @dayloom/core -w @dayloom/tui
npm run test -w @dayloom/core
npm run test -w @dayloom/tui
```

## 测试原则

- Domain 测试不创建文件、Session 或 AI client。
- Archive 测试每次使用唯一临时 World。
- 不以 mock 文本快照取代 TUI 焦点、键盘和 resize 的真实 PTY 验证。
- 公开 schema、event 或 command 变更时，必须同步 reference/package 文档。

