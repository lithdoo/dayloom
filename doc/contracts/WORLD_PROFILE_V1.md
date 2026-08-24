# World Profile V1

**状态**：稳定契约
**最后核对**：2026-08-24

World Profile V1 是 `@dayloom/core` 1.x 在 Archive V2 上使用的唯一读取与写入格式。Archive V2 负责对象、树、commit、current 指针和原子发布；Profile V1 负责业务文档的路径、结构和跨文档约束。

## 标识与布局

Profile 描述符必须声明版本 1。World、Day、Beat、Entity 和 Event 的标识由 Core 分配或按固定输入验证，路径是标识的规范投影，不能由模型自由拼接。Archive 控制面路径不属于业务文档，业务操作不得覆盖 manifest、current、对象库或私有命名空间。

规范信息、实体状态、日计划、事件事实、日总结分别保存；历史日和已发布事实不可原地改写。Planning 只发布下一日计划，Play 只发布固定计划允许的事件与完成证据，Settle 原子应用事件事实并推进控制状态，Revise 通过有类型操作修改允许的当前语义状态。

## 完整性

每次读写都必须验证：

- 描述符、YAML/JSON 结构严格且无未知字段、别名或重复键；
- 引用的实体、Beat、Event 和依赖存在，依赖图无环且顺序合法；
- 当前 phase、day、lastSettledDay 与可见文档一致；
- 已发布历史和受保护命名空间没有被修改；
- mutation 中业务路径唯一，并在一次 Archive 发布中原子提交。

任一条件不满足时 World 为无效或本次操作失败，不得尝试猜测、自动修补或部分发布。

## 版本边界

缺少 Profile V1 描述符、声明其它 Profile 版本或使用非当前日文档结构的 World 均判定为 `WORLD_INVALID`。Core 不猜测格式、不自动升级，也不回退到其它读写路径。
