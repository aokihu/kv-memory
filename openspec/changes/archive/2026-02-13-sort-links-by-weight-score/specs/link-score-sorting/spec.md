# link-score-sorting Specification

## Purpose
提供基于link weight和memory score的综合排序算法，优化记忆关联检索的质量。通过将链接权重与记忆得分相乘，系统能够优先展示更相关、更重要的记忆链接，提升Agent在关联回忆时的决策质量。

## ADDED Requirements

### Requirement: Links array sorting by combined score
The system SHALL sort the Links array in memory responses by the combined score calculated as `link weight × memory score`, in descending order (highest combined score first).

#### Scenario: Basic link sorting
- **WHEN** a memory is retrieved with multiple links
- **THEN** the Links array is sorted by `link weight × memory score` in descending order
- **AND** links with higher combined scores appear first in the array

#### Scenario: Equal combined scores
- **WHEN** two or more links have the same combined score
- **THEN** they are sorted by link weight in descending order as tie-breaker
- **AND** if link weights are also equal, they are sorted by memory key alphabetically

#### Scenario: Memory without score
- **WHEN** a linked memory does not have a score value (e.g., score is null or undefined)
- **THEN** the system uses a default score of 50 for sorting calculations
- **AND** the link is included in the sorted array with the calculated combined score

### Requirement: Sorting algorithm performance
The sorting algorithm SHALL be efficient and not significantly impact query performance.

#### Scenario: Sorting small link sets
- **WHEN** a memory has fewer than 100 links
- **THEN** sorting completes in less than 10 milliseconds
- **AND** query response time is not noticeably affected

#### Scenario: Sorting large link sets
- **WHEN** a memory has 1000 or more links
- **THEN** sorting completes in less than 100 milliseconds
- **AND** system remains responsive during sorting operations

### Requirement: Backward compatibility
The sorting feature SHALL maintain backward compatibility with existing clients.

#### Scenario: Existing client without awareness
- **WHEN** an existing client retrieves a memory with links
- **THEN** the Links array is automatically sorted by combined score
- **AND** the client receives the sorted array without any configuration changes

#### Scenario: Optional sorting control
- **WHEN** a client includes `sortLinks=true` parameter in the request
- **THEN** the system applies the combined score sorting
- **WHEN** a client includes `sortLinks=false` parameter
- **THEN** the system returns links in their original order (if available) or unsorted

### Requirement: Combined score calculation
The system SHALL correctly calculate the combined score using floating-point arithmetic with appropriate precision.

#### Scenario: Normalized weight and score
- **WHEN** link weight is 0.75 and memory score is 80
- **THEN** combined score is calculated as 0.75 × 80 = 60.0
- **AND** the result is stored with at least 2 decimal places precision

#### Scenario: Edge case values
- **WHEN** link weight is 0.0
- **THEN** combined score is 0.0 regardless of memory score
- **WHEN** memory score is 0
- **THEN** combined score is 0.0 regardless of link weight
- **WHEN** link weight is 1.0 and memory score is 100
- **THEN** combined score is 100.0 (maximum possible value)

### Requirement: Integration with search results
When search results include memories with links, the system SHALL apply the same sorting logic to links within search results.

#### Scenario: Search result with linked memories
- **WHEN** a search returns memories that have links
- **THEN** the Links array in each memory is sorted by combined score
- **AND** search relevance ranking is not affected by link sorting

#### Scenario: Search with link filtering
- **WHEN** a client searches for memories and filters by link properties
- **THEN** the filtering is applied before link sorting
- **AND** the returned links within each memory are still sorted by combined score