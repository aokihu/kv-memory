# Task Plan: FIX_INFINITY_TIMEOUT_003

## Goal
修复 `src/libs/decay/processor.ts` 中 `withTimeout` 对 `Infinity` 超时值的处理，避免触发 `setTimeout` 的 `TimeoutOverflowWarning`。

## Current Phase
Phase 3 (complete)

## Phases
### Phase 1: 任务校准与修改点确认
- [x] 读取 `withTimeout` 当前实现并确认溢出触发路径
- [x] 确认只修改允许文件与函数范围
- [x] 记录实现步骤与校验策略
- **Status:** complete

### Phase 2: 代码修复
- [x] 在 `withTimeout` 中新增非有限正数超时保护（`Infinity` 场景）
- [x] 保持原有 `timeoutMs <= 0` 直返行为
- [x] 保持现有错误语义与 Promise 清理逻辑不变
- **Status:** complete

### Phase 3: 验证与交付
- [x] 运行编译检查
- [x] 运行相关测试
- [x] 输出 execute-code-protocol 结果
- **Status:** complete

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| 仅在 `withTimeout` 入参分支增加 `Number.isFinite` 守卫 | 最小改动直接覆盖 `Infinity` 触发路径 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `session-catchup.py` missing in planning skill assets | 1 | Continue with existing `.plan/Hephaestus` artifacts |

## Notes
- 严格限制到单文件 `src/libs/decay/processor.ts`。
- 按 Phase 顺序执行，不跨步。
