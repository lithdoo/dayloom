export const ARCHIVE_NAMESPACE_GUIDE = `需要核对既有 World 时，只能使用 mcp__archive__* 只读工具。先 list_directory 或 directory_tree 缩小范围，再 search_files/search_files_content，最后 read_file_lines 读取最小必要片段。archive 不包含 audit、对象仓库、current 指针或 manifest；不得把未检索到解释为不存在，也不得声称修改了 archive。`;

export const FILE_RUNTIME_PROGRESS_POLICY = `每个 Thought 最多执行本阶段允许的工具调用数。一次只推进一个可验证的小目标。Observe 必须区分：工具直接证据、由证据支持的决定、仍未解决事项和下一项工具动作。只有确有未解决事项且下一动作具体、可用、未重复时才继续。`;
