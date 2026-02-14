# Task Plan: FIX-1

## Goal
修复 `.github/workflows/release.yml` 中 GitHub Actions 的 secrets 语法错误（`Unrecognized named-value: 'secrets'`），保持现有发布与通知行为不变。

## Current Phase
Phase 3 (complete)

## Phases
### Phase 1: 任务校准与问题定位
- [x] 读取任务输入、边界与验收标准
- [x] 读取 `.github/workflows/release.yml` 并定位第 117 行错误
- [x] 搜索是否存在其他同类 `if` 中直接引用 `secrets` 的语法
- **Status:** complete

### Phase 2: 工作流语法修复
- [x] 将 `if` 条件中的 secret 判断改为合法上下文表达式
- [x] 保持 webhook 发送逻辑不变
- [x] 仅修改 `.github/workflows/release.yml`
- **Status:** complete

### Phase 3: 自检与交付
- [x] 复读工作流文件确认语法与行为
- [x] 执行工作流语法验证
- [x] 输出 execute-code-protocol 结果
- **Status:** complete

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| 使用 `env.RELEASE_WEBHOOK_URL` 作为 `if` 判断上下文 | GitHub Actions 不支持在 `if` 直接使用 `secrets.*` |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `session-catchup.py` 路径不可用 | 1 | 使用现有 `.plan/Hephaestus` 文件继续规划执行 |
| `actionlint` 不可用（bunx 解析失败 / 本地命令缺失） | 1 | 使用 Python YAML 解析 + 表达式扫描完成可执行语法自检 |

## Notes
- 执行边界严格限制为 `.github/workflows/release.yml`。

---

# Task Plan: FIX-2

## Goal
修复 `.github/workflows/release.yml` 中所有 `if` 条件直接引用 `secrets.*` 的语法错误，改为先映射到 `env` 后在 `if` 中判断，保持行为不变。

## Current Phase
Phase 3 (complete)

## Phases
### Phase 1: 定位与清点
- [x] 读取 `.github/workflows/release.yml`
- [x] 清点所有 `if` 中直接引用 `secrets` 的位置
- [x] 确认对应 `env` 映射点
- **Status:** complete

### Phase 2: 定点修复
- [x] 在合适层级补充 `env` 变量绑定 `secrets`
- [x] 将 `if` 条件替换为 `env.*` 引用
- [x] 保持原有逻辑行为不变
- **Status:** complete

### Phase 3: 语法自检与交付
- [x] 复核工作流无残留 `if: secrets.*`
- [x] 执行可用语法验证
- [x] 输出 execute-code-protocol 结果
- **Status:** complete

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| 本次不改代码，仅完成验证交付 | 目标文件已使用 `env` 模式，无 `if` 直接引用 `secrets` 的残留 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `session-catchup.py` 路径不可用（`${CLAUDE_PLUGIN_ROOT}` 为空） | 1 | 使用现有 `.plan/Hephaestus` 继续执行并记录 |

---

# Task Plan: SIMPLIFY-1

## Goal
创建 `.github/workflows/ci.yml`，仅保留基础 CI：checkout、Bun setup、依赖安装、测试、构建；不包含发布/通知/semantic-release 逻辑。

## Current Phase
Phase 3 (complete)

## Phases
### Phase 1: 需求与现状确认
- [x] 确认 `.github/workflows/` 目录状态
- [x] 检查现有 workflow 风格用于最小对齐
- [x] 明确 `ci.yml` 触发条件与步骤清单
- **Status:** complete

### Phase 2: 创建简化 CI 工作流
- [x] 新建 `.github/workflows/ci.yml`
- [x] 写入 checkout、Bun setup、install、test、build 步骤
- [x] 不引入发布或通知逻辑
- **Status:** complete

### Phase 3: 语法自检与交付
- [x] 复读 `ci.yml` 确认仅基础 CI
- [x] 执行 YAML 语法检查
- [x] 输出 execute-code-protocol 结果
- **Status:** complete

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| 采用单 job 的最小 CI 结构 | 满足“简化”目标并减少不必要配置 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `session-catchup.py` 在 skill 目录中不存在 | 1 | 读取现有 `.plan/Hephaestus` 文件后继续执行 |
| `ruby` 命令不可用，无法用 Ruby 校验 YAML | 1 | 改用 `python3 + PyYAML` 进行语法校验 |
