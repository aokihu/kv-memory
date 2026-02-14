# Findings & Decisions

## Task FIX-1 Requirements
- 目标是修复 `.github/workflows/release.yml` 的语法错误：`Unrecognized named-value: 'secrets'`。
- 修改范围仅限 `.github/workflows/release.yml`。
- 需要修复第 117 行并检查是否存在其他同类错误。

## Task FIX-1 Context Findings
- 第 117 行当前写法为 `if: ${{ secrets.RELEASE_WEBHOOK_URL != '' }}`。
- GitHub Actions `if` 条件不允许直接引用 `secrets` 上下文，会触发 named-value 解析错误。
- 当前工作流内仅发现这一处 `if` 直接引用 `secrets`。

## Task FIX-1 Technical Decisions
| Decision | Rationale |
|----------|-----------|
| 在 `notify` job 级别声明 `env.RELEASE_WEBHOOK_URL` 并在 `if` 中使用 `env` | 兼容 GitHub Actions 语法约束，且不改变 webhook 步骤的触发语义 |

## Task 6.4 Requirements
- 目标是在 `.github/workflows/release.yml` 中增加发布通知机制。
- 通知机制需要覆盖成功与失败状态。
- 修改边界仅限工作流文件，禁止修改业务逻辑代码。

## Task 6.4 Context Findings
- 当前工作流只有 `release` 单一 job，失败时不会执行后置通知步骤。
- 使用独立 `notify` job + `needs: release` + `if: always()` 可覆盖成功与失败。
- 通过可选 secret `RELEASE_WEBHOOK_URL` 可实现 webhook 通知，未配置时可写入 Job Summary 作为 GitHub 内置通知补充。

## Task 6.4 Technical Decisions
| Decision | Rationale |
|----------|-----------|
| 新增 `notify` job 放在 `release` job 之后 | 不影响现有发布流程，且统一读取 `needs.release.result` |
| 在 `notify` 中分别处理 success/failure | 明确满足“支持成功和失败状态通知”验收标准 |
| webhook 发送失败不阻塞工作流 | 防止通知链路影响发布主链路稳定性 |

## Task 5.2 Requirements
- 目标是在 `README.md` 添加 GitHub Actions 状态徽章。
- 徽章必须指向 `release.yml` 工作流。
- 修改范围仅限 `README.md`，禁止改动业务逻辑代码。

## Task 5.2 Context Findings
- `README.md` 当前无 CI/CD badge，文件顶部为 `# kvdb-mem` 标题。
- `git remote get-url origin` 返回 `git@github.com:aokihu/kv-memory.git`。
- 徽章 URL 应使用 `https://github.com/aokihu/kv-memory/actions/workflows/release.yml/badge.svg`。

## Task 5.2 Technical Decisions
| Decision | Rationale |
|----------|-----------|
| 徽章插入到主标题下方 | 位置显著且不影响后续章节结构 |

## Task 5.1 Requirements
- 目标是创建发布流程文档，指导如何使用自动化发布系统。
- 文档必须覆盖：提交规范说明、发布流程说明、故障排除指南。
- 修改边界允许：创建 `RELEASE.md` 或更新 `README.md` 发布部分。
- 明确禁止：修改任何业务逻辑代码。

## Task 5.1 Context Findings
- OpenSpec `tasks.md` 中 5.1 为“创建发布流程文档”。
- `.github/workflows/release.yml` 已实现双路径：PR 使用 `semantic-release --dry-run`，push/main 执行真实 `semantic-release`。
- `.releaserc.json` 发布分支为 `main`，含 changelog、github、git 等插件；npm 发布已禁用（`npmPublish: false`）。
- `commitlint.config.js` 使用 `@commitlint/config-conventional`，提交规范基于 Conventional Commits。

## Task 5.1 Technical Decisions
| Decision | Rationale |
|----------|-----------|
| 新建 `RELEASE.md` | 最小侵入实现，避免扩展 README 非任务必需内容 |
| 文档包含命令示例与故障排查表格 | 满足“使用说明和示例”与“格式清晰易读”的验收标准 |

## Task 4.3 Requirements
- 目标是在 `.github/workflows/release.yml` 增加 dry-run 测试模式。
- PR 验证时必须自动启用 `semantic-release --dry-run`。
- 实际发布时必须禁用 dry-run，保持真实 `semantic-release`。
- 修改范围仅限工作流文件，不修改业务逻辑代码。

## Task 4.3 Context Findings
- 当前发布步骤 `Publish release` 仅在 `push && refs/heads/main` 时执行，PR 不执行 semantic-release。
- 当前发布命令固定为 `bunx semantic-release`，尚未支持条件 dry-run。
- 工作流已监听 `pull_request` 到 `main`，可直接利用事件上下文切换参数。

## Task 4.3 Technical Decisions
| Decision | Rationale |
|----------|-----------|
| 将发布步骤触发条件扩展为 `push/main` 或 `pull_request` | 让 PR 进入 dry-run 验证路径，且不影响主分支发布路径 |
| 在同一 `run` 脚本里按 `github.event_name` 分支执行 `--dry-run` | 最小改动并复用现有 token/env 配置 |

## Task 4.2 Requirements
- 目标是在 `.github/workflows/release.yml` 配置 GitHub token 最小权限。
- 输入要求最小权限包含：`contents: write`、`packages: read`、`issues: write`。
- 需保证 semantic-release 创建 release/tag 的能力不受影响。

## Task 4.2 Context Findings
- 当前 `release.yml` 已配置 `permissions`，包含：`contents: write`、`issues: write`、`pull-requests: write`。
- 任务输入未要求 `pull-requests: write`，且强调最小权限。
- 工作流发布步骤通过 `GH_TOKEN/GITHUB_TOKEN` 执行 `semantic-release`。

## Task 4.2 Technical Decisions
| Decision | Rationale |
|----------|-----------|
| 删除 `pull-requests: write` | 不在输入要求的最小权限集合内，避免额外授权 |
| 增加 `packages: read` | 对齐输入要求中的最小读取权限 |

## Task 3.1 Requirements
- 目标是创建 semantic-release 配置文件（`.releaserc.json` 或 `release.config.js`）。
- 需覆盖：分支配置、插件配置、changelog 配置、git 配置。
- 已安装插件必须全部纳入配置：
  - `@semantic-release/commit-analyzer`
  - `@semantic-release/release-notes-generator`
  - `@semantic-release/changelog`
  - `@semantic-release/npm`
  - `@semantic-release/github`
  - `@semantic-release/git`

## Task 3.1 Context Findings
- 当前仓库不存在 `.releaserc*` 或 `release.config.*` 文件，需要新建。
- `.github/workflows/release.yml` 的触发主分支是 `main`，发布步骤也仅在 `refs/heads/main` 运行。
- `package.json` 当前存在 `"private": true`，`@semantic-release/npm` 需要显式关闭 npm 发布以避免私有包发布失败。

## Task 3.1 Technical Decisions
| Decision | Rationale |
|----------|-----------|
| 新建 `.releaserc.json` | 最小实现，避免 JS 配置执行差异 |
| `branches` 使用 `["main"]` | 与现有 release workflow 对齐 |
| `@semantic-release/npm` 配置 `npmPublish: false` | 与私有包状态兼容，同时保留版本更新流水线能力 |
| `@semantic-release/changelog` 输出 `CHANGELOG.md` | 与常规发布记录文件保持一致 |
| `@semantic-release/git` 提交 `CHANGELOG.md` 与 `package.json` | 持久化版本与变更记录 |

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

## Task ARCHIVE-1 Requirements
- 目标是归档已完成变更 `implement-github-actions-release`。
- 归档目标路径必须为 `openspec/changes/archive/2026-02-14-implement-github-actions-release/`。
- 禁止修改任何业务逻辑代码。

## Task ARCHIVE-1 Context Findings
- `openspec/changes/implement-github-actions-release/` 当前存在，可作为移动源目录。
- `openspec/changes/archive/` 当前存在，可直接作为归档父目录。
- 采用目录移动可同时满足“原目录被移动”与“归档结构完整”。

## Task ARCHIVE-1 Technical Decisions
| Decision | Rationale |
|----------|-----------|
| 使用单次 `mv` 执行归档 | 操作简单且可保留目录结构完整性 |

## Task FIX-2 Requirements
- 目标是修复 `.github/workflows/release.yml` 中 `if` 里直接引用 `secrets` 的语法错误。
- 正确模式是先在 `env` 中映射 secret，再在 `if` 中使用 `env`。
- 修改边界仅限 `.github/workflows/release.yml`。

## Task FIX-2 Initial Findings
- `planning-with-files` 要求的 `session-catchup.py` 因环境变量路径缺失不可执行。
- 需要先扫描 `.github/workflows/release.yml` 中所有 `if:` 表达式是否存在 `secrets.` 直接引用。

## Task FIX-2 Verification Findings
- 当前 `.github/workflows/release.yml` 第 119 行为 `if: ${{ env.RELEASE_WEBHOOK_URL != '' }}`，已是正确模式。
- 工作流文件中未发现任何 `if` 条件直接引用 `secrets.*`。
- YAML 语法解析校验通过（`yaml-parse-ok`）。

## Task SIMPLIFY-1 Requirements
- 目标是创建简化 CI 工作流 `.github/workflows/ci.yml`。
- 工作流只保留：checkout、Bun setup、依赖安装、测试、构建。
- 不包含 semantic-release、发布、通知等复杂逻辑。
- 禁止修改业务逻辑代码。

## Task SIMPLIFY-1 Context Findings
- `.github/workflows/` 当前仅有 `release.yml`，`ci.yml` 不存在。
- 现有 `release.yml` 已包含基础 CI 步骤，可复用其 Bun 相关命令风格：`bun install --frozen-lockfile`、`bun test`、`bun run build`。
- 简化 CI 可使用单 job、`ubuntu-latest`，并保留 `push/pull_request` 到 `main` 的基础触发。

## Task SIMPLIFY-1 Technical Decisions
| Decision | Rationale |
|----------|-----------|
| `ci.yml` 使用单 job `ci` | 最小配置即可满足验收功能 |
| 去除缓存、权限细化、发布与通知步骤 | 保持“简化”目标且避免超范围逻辑 |

## Task SIMPLIFY-1 Verification Findings
- `.github/workflows/ci.yml` 仅包含 checkout、setup bun、install、test、build 五类核心步骤。
- 未包含 semantic-release、发布、通知、webhook 或额外复杂逻辑。
- 使用 `python3 + PyYAML` 解析校验通过（`yaml-parse-ok`）。
