# 迁移到正式 Core

**状态**：适用于 1.0.0-beta.1
**最后核对**：2026-08-24

`@dayloom/core` 现在是唯一产品运行时。实验包的调用方只需把依赖和根入口 import 改为 `@dayloom/core`；`createDayloomCore`、`CoreState`、`CoreResult` 与 `CoreEvent` 的应用语义保持一致。不要增加运行时 backend selector 或兼容 facade。

迁移函数不再从根入口导出。离线工具应改为：

```ts
import { migrateLegacyWorldProfileV1 } from '@dayloom/core/migration';
```

旧文件系统 World 使用独立目标迁移：

```bash
dayloom-core archive migrate-world-profile-v1 \
  --source ./legacy-world \
  --target ./archive-v2-world
```

命令不会修改源目录，拒绝符号链接和源/目标重叠，并在返回成功前重新读取验证目标 World。Profile V0 已存在 World 由隔离兼容分支继续运行，不会在启动时静默升级。

TUI 应依赖同版本的 `@dayloom/core`，并继续从 package root 导入；任何 `src/`、`dist/` 深层导入都不受兼容保证。
