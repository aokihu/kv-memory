# memory-lifecycle-management Specification

## Purpose
基于记忆得分管理记忆的生命周期状态（active/cold/deprecated），提供状态查询和过滤功能。

## ADDED Requirements

### Requirement: Memory state classification
The system SHALL classify memories into states (active, cold, deprecated) based on their score values.

#### Scenario: Active state assignment
- **WHEN** a memory's score is between 70-100
- **THEN** the memory is classified as "active"
- **AND** appears in default search results

#### Scenario: Cold state assignment
- **WHEN** a memory's score is between 30-69
- **THEN** the memory is classified as "cold"
- **AND** appears only in explicit historical queries

#### Scenario: Deprecated state assignment
- **WHEN** a memory's score is between 0-29
- **THEN** the memory is classified as "deprecated"
- **AND** is excluded from most queries unless explicitly requested

#### Scenario: State threshold configuration
- **WHEN** configuring the lifecycle manager
- **THEN** the score thresholds for each state are configurable
- **AND** default thresholds are provided (active: 70+, cold: 30-69, deprecated: 0-29)

### Requirement: State-based query filtering
The system SHALL support filtering memories by their lifecycle state in queries.

#### Scenario: Filter by active memories
- **WHEN** querying memories without explicit state filter
- **THEN** only active memories are returned by default
- **AND** cold and deprecated memories are excluded

#### Scenario: Include cold memories
- **WHEN** querying with "includeCold" parameter
- **THEN** both active and cold memories are returned
- **AND** deprecated memories remain excluded

#### Scenario: Include all states
- **WHEN** querying with "includeAll" parameter
- **THEN** memories from all states (active, cold, deprecated) are returned
- **AND** results are marked with their state

#### Scenario: Filter by specific state
- **WHEN** querying with "state" parameter (e.g., "state=cold")
- **THEN** only memories in the specified state are returned

### Requirement: State transition tracking
The system SHALL track when memories transition between states and log these transitions.

#### Scenario: State transition detection
- **WHEN** a memory's score crosses a state threshold
- **THEN** the system detects the state transition
- **AND** records the transition in the memory's meta field

#### Scenario: Transition history
- **WHEN** a memory transitions between states multiple times
- **THEN** the transition history is preserved in the meta field
- **AND** includes timestamps and previous/current states

#### Scenario: Transition notification
- **WHEN** a memory transitions to deprecated state
- **THEN** the system may optionally trigger cleanup or archiving processes
- **AND** logs the transition for monitoring purposes

### Requirement: Memory cleanup and archiving
The system SHALL provide mechanisms for cleaning up or archiving deprecated memories.

#### Scenario: Automatic cleanup
- **WHEN** configured for automatic cleanup
- **THEN** memories in deprecated state for a configurable duration are automatically removed
- **AND** removal is logged for audit purposes

#### Scenario: Manual archiving
- **WHEN** user requests to archive deprecated memories
- **THEN** deprecated memories are moved to an archive storage
- **AND** remain accessible through special archive queries

#### Scenario: Cleanup safety
- **WHEN** automatic cleanup is enabled
- **THEN** memories with important links or recent access are exempt from cleanup
- **AND** cleanup can be paused or configured with whitelists

### Requirement: State statistics and monitoring
The system SHALL provide statistics about memory states for monitoring and analysis.

#### Scenario: State distribution statistics
- **WHEN** querying system statistics
- **THEN** the system returns counts of memories in each state (active, cold, deprecated)
- **AND** includes percentage distribution

#### Scenario: State transition statistics
- **WHEN** monitoring system health
- **THEN** the system provides statistics on state transitions over time
- **AND** includes rates of transitions between states

#### Scenario: Score distribution analysis
- **WHEN** analyzing memory health
- **THEN** the system provides histogram of memory scores
- **AND** identifies clusters or anomalies in score distribution