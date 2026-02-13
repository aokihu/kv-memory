## ADDED Requirements

### Requirement: Bulk memory reading with depth traversal
The system SHALL support bulk reading of memories with depth-first traversal of associated memories.

#### Scenario: Depth-first traversal of associated memories
- **WHEN** memory A is linked to memories B and C, and memory B is linked to memory D
- **THEN** bulk read of memory A retrieves memories in order: A, B, D, C (depth-first)
- **AND** explores depth before breadth

### Requirement: Weight-based sorting of associated memories
The system SHALL sort associated memories by `link_weight × memory_score` in descending order when selecting which memories to include in bulk reads.

#### Scenario: Sorting by weight and score product
- **WHEN** memory A has links to B (weight=0.8, score=0.9) and C (weight=0.9, score=0.7)
- **THEN** B is selected first (0.8×0.9=0.72) before C (0.9×0.7=0.63)
- **AND** sorting is descending by product value

### Requirement: Depth limitation for bulk reads
The system SHALL limit the depth of memory traversal to a maximum of 6 degrees by default, configurable by the user.

#### Scenario: Depth limit enforcement
- **WHEN** memory chain A→B→C→D→E→F→G exists (7 levels)
- **AND** user requests bulk read with depth=6
- **THEN** traversal stops at memory F (6th level)
- **AND** memory G is not retrieved

### Requirement: Breadth limitation per depth level
The system SHALL limit the number of associated memories retrieved per depth level to a maximum of 20 by default, configurable by the user.

#### Scenario: Breadth limit per level
- **WHEN** memory A has 25 direct associations (depth 1)
- **AND** user requests bulk read with breadth=20
- **THEN** only 20 associations are retrieved at depth 1
- **AND** remaining 5 are skipped

### Requirement: Total memory count limitation
The system SHALL limit the total number of memories retrieved in a bulk read operation to a maximum of 50 by default, configurable by the user.

#### Scenario: Total count limit
- **WHEN** memory graph contains 100 memories
- **AND** user requests bulk read with total=50
- **THEN** traversal stops when 50 memories are retrieved
- **AND** remaining memories are not retrieved

### Requirement: Duplicate prevention by memory key
The system SHALL prevent duplicate memory retrieval by checking memory keys during traversal and skipping already retrieved memories.

#### Scenario: Duplicate prevention in circular references
- **WHEN** memory A links to B, B links to C, and C links back to A
- **THEN** during bulk read of A, each memory is retrieved only once
- **AND** circular reference does not cause infinite loop

### Requirement: Immediate stop on reaching limits
The system SHALL immediately stop traversal when any configured limit (depth, breadth, or total count) is reached.

#### Scenario: Immediate stop on total limit
- **WHEN** traversal reaches configured total limit
- **THEN** retrieval stops immediately
- **AND** no additional memories are processed even if available

#### Scenario: Default bulk read with depth-first traversal
- **WHEN** user requests bulk read of a memory with default parameters
- **THEN** system retrieves the target memory and up to 5 associated memories per depth level
- **AND** traverses up to 3 depth levels
- **AND** stops when total reaches 20 memories
- **AND** sorts associated memories by `link_weight × memory_score` descending
- **AND** prevents duplicate memory retrieval

#### Scenario: Custom depth and breadth limits
- **WHEN** user requests bulk read with depth=4 and breadth=10
- **THEN** system retrieves up to 10 associated memories per depth level
- **AND** traverses up to 4 depth levels
- **AND** stops when total reaches 50 memories (default total limit)

#### Scenario: Custom total limit
- **WHEN** user requests bulk read with total limit of 30
- **THEN** system stops retrieval when total memory count reaches 30
- **AND** respects depth and breadth limits during traversal

#### Scenario: Duplicate memory prevention
- **WHEN** memory A is linked to memory B and memory C, and memory B is also linked to memory C
- **THEN** during bulk read of memory A, memory C is retrieved only once
- **AND** duplicate detection is based on memory key

#### Scenario: Immediate stop on limit reached
- **WHEN** system reaches configured total limit during traversal
- **THEN** traversal stops immediately
- **AND** no additional memories are retrieved even if more associations exist

### Requirement: HTTP API endpoint for bulk memory reads
The system SHALL provide an HTTP API endpoint for bulk memory reading with configurable parameters.

#### Scenario: HTTP bulk read request
- **WHEN** client sends GET request to `/api/memories/{key}/bulk` with query parameters
- **THEN** system returns the target memory and associated memories according to parameters
- **AND** response includes metadata about traversal depth and total count

#### Scenario: HTTP bulk read with custom parameters
- **WHEN** client sends GET request with `depth=5&breadth=8&total=40`
- **THEN** system uses custom parameters instead of defaults
- **AND** validates parameters against maximum limits

### Requirement: MCP tool extension for bulk reads
The system SHALL extend the Memory MCP tool to support bulk read parameters.

#### Scenario: MCP bulk read command
- **WHEN** user calls Memory tool with bulk read parameters
- **THEN** tool returns memories with depth traversal
- **AND** includes configuration options for depth, breadth, and total limits