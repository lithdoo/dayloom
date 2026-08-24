# Archive 格式

**状态**：Archive V2 / Profile V1
**最后核对**：2026-08-24

Archive V2 使用不可变 blob、root tree 和 commit，由 `current.json` 原子指向当前 revision。协议包负责规范路径、canonical bytes/hash、对象关系、staging 与 recovery 事实；Core 负责哪些业务文档可以在某个生命周期动作中改变。

World Profile V1 在 Archive 之上定义 canon、实体状态、计划、事件、总结与审计文档。业务 mutation 不得覆盖 Archive 控制面，也不得原地改写历史。完整布局与完整性规则见 [World Profile V1](/contracts/WORLD_PROFILE_V1)。
