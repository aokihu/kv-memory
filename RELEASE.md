# kvdb-mem 安装和使用指南

本文档说明如何安装和使用 kvdb-mem 项目。

## 1. 安装方法

### 从源码安装
```bash
# 克隆仓库
git clone https://github.com/aokihu/kv-memory.git
cd kv-memory

# 安装依赖
bun install

# 构建项目
bun run build
```

### 作为依赖使用
由于项目是私有包，无法从 npm 安装。你可以：
1. 将仓库添加为 git submodule
2. 或直接复制源码到你的项目中

本地可手动校验最近一次提交：

```bash
bun run commitlint
```

## 2. 发布流程说明

### 2.1 触发条件

发布工作流文件：`.github/workflows/release.yml`

- `pull_request` 到 `main`：执行完整测试和构建，然后执行 `semantic-release --dry-run`
- `push` 到 `main`：执行完整测试和构建，然后执行真实 `semantic-release`

### 2.2 执行阶段

每次触发都按以下顺序执行：

1. Checkout（`fetch-depth: 0`，保证版本计算历史完整）
2. 安装 Node.js 与 Bun
3. 恢复缓存
4. 安装依赖（`bun install --frozen-lockfile`）
5. 运行测试（`bun test`）
6. 构建产物（`bun run build`）
7. 运行 semantic-release（PR 为 dry-run，main 为真实发布）

### 2.3 semantic-release 配置要点

配置文件：`.releaserc.json`

- 发布分支：`main`
- changelog：写入 `CHANGELOG.md`
- GitHub Release：由 `@semantic-release/github` 生成
- Git 提交：自动提交 `CHANGELOG.md` 与 `package.json`
- NPM 发布：当前设置为 `npmPublish: false`（项目为私有包）

## 3. 使用说明

### 3.1 开发者日常流程

1. 在功能分支提交符合规范的 commit
2. 发起 PR 到 `main`
3. 等待 Release Pipeline 通过（此时为 dry-run 验证）
4. 合并 PR 到 `main`
5. `main` 上工作流自动执行真实发布并更新 changelog/release

### 3.2 必需 Secrets

在 GitHub 仓库 Settings -> Secrets and variables -> Actions 中配置：

- `GH_TOKEN`：用于创建 GitHub Release 与推送发布提交
- `NPM_TOKEN`：保留给 npm 插件流程（当前 `npmPublish: false`，仍建议配置以保持流程一致）

## 4. 故障排除指南

| 现象 | 可能原因 | 处理方式 |
|------|----------|----------|
| 工作流失败在 release 分析阶段 | 提交信息不符合 Conventional Commits | 修正 commit message（如 `feat: ...` / `fix: ...`），重新推送 |
| PR 流程没有看到版本发布结果 | PR 路径是 `--dry-run`，不会真实发布 | 检查日志中 semantic-release 分析结果，确认合并到 `main` 后再发布 |
| `main` 合并后未生成新版本 | 本次提交不触发 release（例如仅 `docs/chore`） | 使用 `feat`/`fix` 或带 `BREAKING CHANGE` 的提交类型 |
| semantic-release 报 token/权限错误 | `GH_TOKEN` 缺失或权限不足 | 检查仓库 Secret，确保 workflow 权限为 `contents: write`、`packages: read`、`issues: write` |
| changelog 未更新 | 发布步骤未执行成功或无可发布版本 | 查看 `Publish release` 日志，确认 semantic-release 输出 |

## 5. 常用验证命令

在本地排查发布前问题时可执行：

```bash
bun test
bun run build
bun run commitlint
```
