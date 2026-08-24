# Dayloom

Dayloom 是以“天”为推进单位的 AI 叙事与生活模拟运行时。当前产品由三个 workspace 组成：

- `@dayloom/archive-protocol`：Archive V2 的纯协议与原子发布原语；
- `@dayloom/core`：完整 World 生命周期、会话与 Promptpile React 适配；
- `@dayloom/tui`：正式全屏终端应用 `dayloom-tui`。

仓库只保留当前产品实现；历史实现与兼容入口不参与源码、构建、测试或发布。

## 开发

要求 Node.js 20 或 22：

```bash
npm install
npm run build
npm test
npm run docs:build
npm run examples:check
```

## 运行示例

复制并填写 `examples/dayloom-tui/llm.example.toml`，然后运行对应平台的 `open-world.sh` 或 `open-world.bat`。等价的直接命令是：

```bash
node packages/tui/dist/main.js ./world --llm-config ./llm.toml
```

运行时契约见 [Core Runtime V1](doc/contracts/CORE_RUNTIME_V1.md)，持久化契约见 [World Profile V1](doc/contracts/WORLD_PROFILE_V1.md)，完整文档入口见 [doc/README.md](doc/README.md)。
