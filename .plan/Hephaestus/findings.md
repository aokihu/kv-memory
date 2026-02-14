# Findings & Decisions

## Requirements
- 仅修复 `src/libs/decay/processor.ts` 中 `withTimeout` 的 `Infinity` 超时处理。
- 当 `timeoutMs` 为 `Infinity` 时，必须直接返回原 Promise，不调用 `setTimeout`。
- 不修改其他文件，不新增依赖。

## Research Findings
- 当前实现仅在 `timeoutMs <= 0` 时直返 Promise。
- `Infinity` 满足 `> 0`，会进入 `setTimeout(..., Infinity)`，触发 Node/Bun 的超时溢出警告。
- 最小修复点是 `withTimeout` 入口分支，增加 `!Number.isFinite(timeoutMs)` 的直返条件。
- 该改动不会改变已有 `timeoutMs <= 0` 行为，也不会影响 timeout reject 与 `clearTimeout` 清理路径。

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| 使用 `if (timeoutMs <= 0 || !Number.isFinite(timeoutMs)) return promise;` | 同时覆盖 `Infinity` 与其他非有限值，保持最小行为变更 |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| planning skill 的 `session-catchup.py` 脚本路径不可用 | 使用现有 `.plan/Hephaestus` 文件继续执行 |

## Resources
- `src/libs/decay/processor.ts`
