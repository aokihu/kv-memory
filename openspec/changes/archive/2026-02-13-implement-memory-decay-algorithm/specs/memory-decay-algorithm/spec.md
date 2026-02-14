# memory-decay-algorithm Specification

## Purpose
定义记忆衰退算法的行为和接口，使记忆能够根据使用频率、时间衰减和结构关系动态调整其活跃状态和得分。

## ADDED Requirements

### Requirement: Memory score calculation
The system SHALL calculate a memory score between 0-100 based on usage frequency, time decay, and structural relationships. The score SHALL be stored in the memory's meta field as `score`.

#### Scenario: Initial score assignment
- **WHEN** a new memory is created
- **THEN** the memory's `meta.score` field is set to 50
- **AND** the score is within the valid range of 0-100

#### Scenario: Score update during decay calculation
- **WHEN** the decay algorithm runs
- **THEN** each memory's score is recalculated based on usage statistics and time since last access
- **AND** the updated score is persisted to the database

#### Scenario: Score boundary enforcement
- **WHEN** a calculated score exceeds 100
- **THEN** the score is capped at 100
- **WHEN** a calculated score falls below 0
- **THEN** the score is floored at 0

### Requirement: Decay algorithm factors
The decay algorithm SHALL consider multiple factors when calculating memory scores, including usage frequency, recency of access, and structural relationships.

#### Scenario: Usage frequency impact
- **WHEN** a memory is accessed frequently
- **THEN** its score increases or decays more slowly
- **AND** the algorithm tracks access counts in the memory's meta field

#### Scenario: Time decay impact
- **WHEN** a memory has not been accessed for a long time
- **THEN** its score decreases over time
- **AND** the decay rate is configurable

#### Scenario: Structural relationship impact
- **WHEN** a memory has many links to other memories
- **THEN** its score decays more slowly due to structural importance
- **AND** link weights are considered in the calculation

### Requirement: Configurable decay parameters
The decay algorithm SHALL support configurable parameters to adjust decay rates and factor weights.

#### Scenario: Parameter configuration
- **WHEN** the decay algorithm is initialized
- **THEN** it accepts configuration for decay rates, factor weights, and time constants
- **AND** default values are provided if not specified

#### Scenario: Parameter validation
- **WHEN** invalid parameters are provided
- **THEN** the algorithm uses safe defaults
- **AND** logs a warning about the invalid configuration

### Requirement: Scheduled decay calculation
The system SHALL automatically run the decay algorithm at regular intervals using a configurable scheduler.

#### Scenario: Periodic execution
- **WHEN** the system starts (HTTP or MCP server)
- **THEN** a scheduler is initialized to run the decay algorithm every 15 minutes
- **AND** the interval is configurable

#### Scenario: Scheduler persistence
- **WHEN** the scheduler is running
- **THEN** it continues to execute at the configured interval
- **AND** survives server restarts (reinitializes on startup)

#### Scenario: Concurrent execution safety
- **WHEN** the decay algorithm is running
- **THEN** concurrent memory operations are handled safely
- **AND** the algorithm does not block normal memory operations for extended periods

### Requirement: Performance optimization
The decay algorithm SHALL be optimized for performance when processing large numbers of memories.

#### Scenario: Batch processing
- **WHEN** processing many memories
- **THEN** the algorithm processes memories in configurable batch sizes
- **AND** includes delays between batches to avoid overwhelming the system

#### Scenario: Incremental updates
- **WHEN** updating memory scores
- **THEN** only memories that have changed significantly are written to the database
- **AND** unchanged memories are skipped to reduce I/O

#### Scenario: Memory state caching
- **WHEN** calculating decay
- **THEN** the algorithm caches frequently accessed memory metadata
- **AND** the cache is invalidated when memories are updated