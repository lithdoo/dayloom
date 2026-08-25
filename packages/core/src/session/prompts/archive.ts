export const WORLD_ARCHIVE_GUIDE = `会话 Archive 只暴露经过校验并固定版本的 Published World。
命名空间含义：
- canon/：前提、规则、风格和用户角色解释数据。
- state/：当前已发布的全局状态、进度、日历和变量。
- characters/：角色档案、状态、关系、位置、标签、记忆和时间线。
- locations/：地点档案、状态、标签、触发器、记忆和时间线。
- arcs/：长线叙事状态、阶段、档案和时间线。
- memory/：持久化的 World 事实与记忆；不同于可写 Conversation 摘要。
- story-seeds/：潜在的未来素材，其本身绝不是既定事实。
- days/：已发布的计划、事件、证据、摘要和不可变的已结算历史。
实际存在的路径以工具发现结果为准。`;

export const ARCHIVE_RETRIEVAL_POLICY = `仅在能实质提升正确性时渐进式检索：
- 已知目录：list_directory；
- 已知路径模式：search_files；
- 定位事实或标识：search_files_content；
- 命中后：使用 read_file_lines 读取相关范围；
- 结构未知：先执行有界 directory_tree，再缩小范围。
不要机械枚举根目录，也不要重复读取本轮已经确定的事实。仅在正确性依赖它们时检索精确 ID、当前值和相关历史。错误或截断表示证据尚未解决，绝不表示可以编造。`;

export const ARCHIVE_THOUGHT_POLICY = `${WORLD_ARCHIVE_GUIDE}\n\n${ARCHIVE_RETRIEVAL_POLICY}`;
