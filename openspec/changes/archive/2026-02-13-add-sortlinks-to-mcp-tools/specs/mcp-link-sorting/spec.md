# mcp-link-sorting Specification

## Purpose
为MCP工具添加链接排序能力，支持通过参数控制返回的links数组是否按 `link weight × memory score` 综合得分排序。

## ADDED Requirements

### Requirement: MCP tools support link sorting
MCP工具SHALL支持可选的 `sortLinks` 参数，控制返回的记忆链接数组是否排序。默认情况下SHALL启用排序功能。

#### Scenario: MemoryGet tool with sortLinks parameter
- **WHEN** 客户端使用MemoryGet工具并指定 `sortLinks: true`
- **THEN** 返回的记忆中的links数组按综合得分从高到低排序
- **AND** 排序算法使用 `link weight × memory score` 计算综合得分

#### Scenario: MemoryGet tool with sortLinks disabled
- **WHEN** 客户端使用MemoryGet工具并指定 `sortLinks: false`
- **THEN** 返回的记忆中的links数组保持原始顺序
- **AND** 不应用任何排序算法

#### Scenario: MemoryGet tool without sortLinks parameter
- **WHEN** 客户端使用MemoryGet工具但不指定 `sortLinks` 参数
- **THEN** 默认启用排序功能
- **AND** 返回的记忆中的links数组按综合得分从高到低排序

#### Scenario: MemorySearch tool with sortLinks parameter
- **WHEN** 客户端使用MemorySearch工具并指定 `sortLinks: true`
- **THEN** 所有搜索结果中的记忆links数组按综合得分从高到低排序
- **AND** 排序应用于每个记忆的links数组

#### Scenario: MemoryFulltextSearch tool with sortLinks parameter
- **WHEN** 客户端使用MemoryFulltextSearch工具并指定 `sortLinks: true`
- **THEN** 所有搜索结果中的记忆links数组按综合得分从高到低排序
- **AND** 排序应用于每个记忆的links数组

### Requirement: Parameter validation for sortLinks
MCP工具SHALL验证 `sortLinks` 参数值，支持boolean类型和字符串类型。

#### Scenario: Boolean parameter value
- **WHEN** 客户端指定 `sortLinks: true` 或 `sortLinks: false`
- **THEN** 参数被接受并正确处理
- **AND** 相应的排序行为被应用

#### Scenario: String parameter value
- **WHEN** 客户端指定 `sortLinks: "true"` 或 `sortLinks: "false"`
- **THEN** 参数被转换为boolean值并正确处理
- **AND** 相应的排序行为被应用

#### Scenario: Invalid parameter value
- **WHEN** 客户端指定无效的 `sortLinks` 参数值（如 `sortLinks: "yes"`）
- **THEN** 返回验证错误
- **AND** 错误消息指导客户端使用正确的值

### Requirement: Sorting algorithm consistency
MCP工具SHALL使用与HTTP API相同的排序算法，确保行为一致性。

#### Scenario: Same sorting logic as HTTP API
- **WHEN** 通过MCP工具和HTTP API获取同一记忆
- **AND** 两者都启用链接排序
- **THEN** 返回的links数组顺序完全相同
- **AND** 综合得分计算方式一致

#### Scenario: Tie-breaking rules
- **WHEN** 多个links具有相同的综合得分
- **THEN** 按link weight降序排序
- **AND** 如果link weight也相同，按memory key字母顺序排序

#### Scenario: Missing score handling
- **WHEN** 记忆缺少score字段
- **THEN** 使用默认值50进行计算
- **AND** 排序算法正常处理