---
layout: home
hero:
  name: Dayloom
  text: 以天为单位推进的 AI 叙事运行时
  tagline: 单一 Core、显式会话提交、Archive V2 原子发布
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/GETTING_STARTED
    - theme: alt
      text: Runtime 契约
      link: /contracts/CORE_RUNTIME_V1
    - theme: alt
      text: World 契约
      link: /contracts/WORLD_PROFILE_V1
features:
  - title: 完整生命周期
    details: Init、Planning、Play、Settle、Revise 与 Abandon 由同一个 Runtime 管理。
  - title: 显式提交
    details: 对话不会自行改变 World，只有通过 schema 和 revision 验证的 submit 才发布。
  - title: 原子存档
    details: current 指向不可变 commit；失败操作不会污染已发布事实。
---

## 启动 TUI

```bash
npm install
npm run build
node packages/tui/dist/main.js ./world --llm-config ./llm.toml
```

