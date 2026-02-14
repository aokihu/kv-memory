# KVDB-MEM CLI 打包与可移植性指南

本文档全面介绍 kvdb-mem CLI 的二进制分发、打包配置、部署策略和开发工作流。适用于需要构建、分发或部署 kvdb-mem CLI 的开发者和运维人员。

---

## 目录

1. [架构设计](#架构设计)
2. [CLI命令参考](#cli命令参考)
3. [构建和打包](#构建和打包)
4. [部署和使用](#部署和使用)
5. [开发工作流](#开发工作流)
6. [故障排除](#故障排除)
7. [最佳实践](#最佳实践)

---

## 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    kvdb-mem CLI 架构                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐   │
│  │   backup     │    │    repair    │    │    check     │   │
│  │   命令        │    │    命令       │    │    命令       │   │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘   │
│         │                   │                   │           │
│         └───────────────────┼───────────────────┘           │
│                             │                               │
│                    ┌─────────┴─────────┐                    │
│                    │    CLI 通用层      │                    │
│                    │  (common.ts)      │                    │
│                    └─────────┬─────────┘                    │
│                              │                              │
│                    ┌─────────┴─────────┐                    │
│                    │   KV 数据库核心    │                    │
│                    │  (libs/kv/db.ts)  │                    │
│                    └─────────┬─────────┘                    │
│                              │                              │
│                    ┌─────────┴─────────┐                    │
│                    │   SQLite 数据库    │                    │
│                    └───────────────────┘                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 打包架构

```
┌──────────────────────────────────────────────────────────────┐
│                    打包流程                                   │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│   源代码                        Bun.build                    │
│  ┌──────────────┐              ┌─────────────┐               │
│  │ src/cli/     │─────────────▶│   编译阶段   │               │
│  │   index.ts   │   解析依赖    │   打包优化   │               │
│  │   backup.ts  │─────────────▶│   Tree Shake │               │
│  │   repair.ts  │   ESM 转换    │   Minify     │               │
│  │   check.ts   │─────────────▶│   Sourcemap  │               │
│  │   common.ts  │   静态分析    │   (可选)     │               │
│  └──────────────┘              └──────┬──────┘               │
│                                      │                        │
│                                      ▼                        │
│                               ┌──────────────┐                 │
│                               │   编译输出    │                │
│                               │   (bytecode) │                │
│                               └──────┬───────┘                │
│                                      │                        │
│                                      ▼                        │
│                               ┌──────────────┐                 │
│                               │  Bun 嵌入器   │                │
│                               │  (嵌入运行时)  │               │
│                               └──────┬───────┘                │
│                                      │                        │
│                                      ▼                        │
│                               ┌──────────────┐                 │
│                               │  可执行二进制   │                │
│                               │  ./dist/kvdb-mem│               │
│                               └──────────────┘                 │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

### 模块化设计

| 模块 | 职责 | 对应文件 |
|------|------|----------|
| CLI 入口 | 命令解析、路由分发 | `src/cli/index.ts` |
| 备份模块 | 数据库备份逻辑 | `src/cli/backup.ts` |
| 修复模块 | FTS5 索引重建 | `src/cli/repair.ts` |
| 检查模块 | 完整性验证 | `src/cli/check.ts` |
| 通用工具 | 日志、参数解析 | `src/cli/common.ts` |
| KV 核心 | 数据库操作 | `src/libs/kv/db.ts` |

---

## CLI命令参考

### 命令概览

| 命令 | 描述 | 退出码 |
|------|------|--------|
| `backup` | 备份数据库和附属文件 | 0=成功, 1=失败 |
| `repair` | 重建 FTS5 索引并验证 | 0=成功, 1=失败 |
| `check` | 运行完整性检查 | 0=通过, 1=失败 |
| `help` | 显示帮助信息 | 0 |

### backup 命令

备份 SQLite 数据库及其附属文件（WAL、SHM）。

**用法**
```bash
kvdb-mem backup [options]
```

**选项**

| 选项 | 环境变量 | 默认值 | 描述 |
|------|----------|--------|------|
| `--db <path>` | `KVDB_SQLITE_FILE` | `kv.db` | 数据库文件路径 |
| `--backup-dir <path>` | `KVDB_BACKUP_DIR` | `backups` | 备份输出目录 |

**示例**
```bash
# 使用默认配置
kvdb-mem backup

# 指定数据库文件
kvdb-mem backup --db /data/myapp.db

# 指定备份目录
kvdb-mem backup --backup-dir /backups/kvdb

# 完整配置
kvdb-mem backup --db /data/myapp.db --backup-dir /backups/kvdb
```

**输出格式**
```json
{
  "backupFile": "/project/backups/kv.db.backup-20260214123456.db",
  "timestamp": "2026-02-14T12:34:56.789Z",
  "originalSize": 1048576,
  "backupSize": 1048576
}
```

### repair 命令

重建 FTS5 全文搜索索引，执行完整性检查并验证搜索功能。

**用法**
```bash
kvdb-mem repair [options]
```

**选项**

| 选项 | 环境变量 | 默认值 | 描述 |
|------|----------|--------|------|
| `--db <path>` | `KVDB_SQLITE_FILE` | `kv.db` | 数据库文件路径 |
| `--keyword <value>` | - | 自动提取 | 验证搜索的关键词 |

**示例**
```bash
# 使用默认配置
kvdb-mem repair

# 指定数据库文件
kvdb-mem repair --db /data/myapp.db

# 使用特定关键词验证
kvdb-mem repair --keyword "important"

# 完整配置
kvdb-mem repair --db /data/myapp.db --keyword "search-term"
```

**输出格式**
```json
{
  "databaseFile": "/project/kv.db",
  "startedAt": 1707912896789,
  "finishedAt": 1707912897123,
  "integrityBefore": {
    "quick": { "ok": true, "messages": [] },
    "full": { "ok": true, "messages": [] }
  },
  "integrityAfter": {
    "quick": { "ok": true, "messages": [] },
    "full": { "ok": true, "messages": [] }
  },
  "rebuild": { "ok": true },
  "verification": {
    "ok": true,
    "keyword": "memory",
    "hits": 5,
    "inspectedKey": "mem-abc123"
  }
}
```

### check 命令

运行 FTS5 完整性检查，模拟启动时的验证流程。

**用法**
```bash
kvdb-mem check [options] [mode]
```

**参数**

| 参数 | 描述 | 默认值 |
|------|------|--------|
| `mode` | 检查模式：`QUICK` 或 `FULL` | `QUICK` |

**选项**

| 选项 | 环境变量 | 默认值 | 描述 |
|------|----------|--------|------|
| `--db <path>` | `KVDB_SQLITE_FILE` | `kv.db` | 数据库文件路径 |
| `--mode <QUICK\|FULL>` | - | `QUICK` | 完整性检查深度 |
| `--init` | - | `false` | 检查前初始化 schema |

**示例**
```bash
# 快速检查（默认）
kvdb-mem check

# 指定检查模式
kvdb-mem check QUICK
kvdb-mem check FULL

# 使用选项指定模式
kvdb-mem check --mode FULL

# 指定数据库文件
kvdb-mem check --db /data/myapp.db

# 初始化 schema 后检查
kvdb-mem check --init

# 完整配置
kvdb-mem check --db /data/myapp.db --mode FULL --init
```

**输出格式**
```json
{
  "databaseFile": "/project/kv.db",
  "shouldInit": false,
  "ok": true,
  "mode": "QUICK",
  "messages": [],
  "fts5Stats": {
    "memoryCount": 1000,
    "fts5RowCount": 1000,
    "triggerCount": 3
  }
}
```

---

## 构建和打包

### 构建配置详解

项目的构建配置位于 `build.ts`，使用 Bun 的构建 API。

**build.ts 配置说明**

```typescript
const result = await Bun.build({
  entrypoints: ["./src/cli/index.ts"],  // CLI 入口文件
  target: "bun",                         // 目标平台：Bun 运行时
  format: "esm",                         // 输出格式：ES 模块
  sourcemap: "none",                       // 不生成 source map
  minify: true,                          // 启用代码压缩
  compile: {
    outfile: OUTFILE,                    // 输出文件路径
  },
});
```

**配置参数说明**

| 参数 | 类型 | 说明 |
|------|------|------|
| `entrypoints` | `string[]` | 入口文件路径数组 |
| `target` | `"bun" \| "node" \| "browser"` | 目标运行环境 |
| `format` | `"esm" \| "cjs"` | 模块格式 |
| `sourcemap` | `"none" \| "inline" \| "external"` | Source map 生成策略 |
| `minify` | `boolean` | 是否启用代码压缩 |
| `compile.outfile` | `string` | 输出文件路径 |

### 构建命令

**开发构建**
```bash
# 使用 npm script 构建
bun run build

# 或使用完整命令
bun run ./build.ts
```

**构建输出**
构建完成后，会在 `dist/` 目录生成可执行文件：
```
dist/
└── kvdb-mem          # 可执行二进制文件 (~100MB)
```

### 交叉编译支持

当前 Bun 的 `compile` 功能支持以下目标平台：

| 宿主平台 | 目标平台 | 支持状态 |
|----------|----------|----------|
| Linux x64 | Linux x64 | ✅ 支持 |
| macOS x64 | macOS x64 | ✅ 支持 |
| macOS ARM64 | macOS ARM64 | ✅ 支持 |
| Windows | Windows | ✅ 支持 |

**注意**：交叉编译（如从 Linux 构建 macOS 可执行文件）需要对应平台的工具链支持。

### 打包优化选项

**体积优化**
```typescript
// build.ts 中启用更激进的优化
const result = await Bun.build({
  // ... 其他配置
  minify: {
    whitespace: true,
    identifiers: true,
    syntax: true,
  },
  splitting: false,  // 禁用代码分割，单文件输出
});
```

**启动时间优化**
- 使用 `--smol` 标志减少内存占用（开发环境）
- 生产构建启用 `minify: true`
- 避免动态导入，保持依赖静态可分析

---

## 部署和使用

### 部署前准备

**系统要求**

| 组件 | 最低版本 | 说明 |
|------|----------|------|
| 操作系统 | Linux 3.10+ / macOS 10.15+ / Windows 10+ | 64位系统 |
| 内存 | 512MB | 建议 1GB 以上 |
| 磁盘空间 | 100MB | 二进制文件 + 数据库 |
| SQLite | 3.35+ | FTS5 支持必需 |

**权限要求**
- 读取数据库文件的权限
- 写入备份目录的权限
- 创建临时文件的权限（WAL 模式需要）

### 二进制部署

**步骤 1：获取二进制文件**
```bash
# 从构建产物复制
scp dist/kvdb-mem user@server:/usr/local/bin/

# 或从 CI/CD 产物下载
wget https://artifacts.example.com/kvdb-mem-linux-x64
```

**步骤 2：安装二进制文件**
```bash
# 移动到系统 PATH
sudo mv kvdb-mem /usr/local/bin/
sudo chmod +x /usr/local/bin/kvdb-mem

# 验证安装
kvdb-mem --help
```

**步骤 3：配置环境**
```bash
# 创建配置文件目录
sudo mkdir -p /etc/kvdb-mem

# 创建环境变量文件
sudo tee /etc/kvdb-mem/env << 'EOF'
KVDB_SQLITE_FILE=/data/kvdb/kv.db
KVDB_BACKUP_DIR=/backups/kvdb
EOF

# 加载环境变量
source /etc/kvdb-mem/env
```

### Docker 部署

**Dockerfile 示例**
```dockerfile
FROM oven/bun:1.0-alpine

# 安装运行时依赖
RUN apk add --no-cache sqlite-libs

# 复制二进制文件
COPY dist/kvdb-mem /usr/local/bin/kvdb-mem
RUN chmod +x /usr/local/bin/kvdb-mem

# 创建数据目录
RUN mkdir -p /data /backups

# 设置环境变量
ENV KVDB_SQLITE_FILE=/data/kv.db
ENV KVDB_BACKUP_DIR=/backups

# 默认命令
ENTRYPOINT ["kvdb-mem"]
CMD ["--help"]
```

**构建和运行**
```bash
# 构建镜像
docker build -t kvdb-mem:latest .

# 运行检查
docker run -v $(pwd)/data:/data -v $(pwd)/backups:/backups kvdb-mem check

# 运行备份
docker run -v $(pwd)/data:/data -v $(pwd)/backups:/backups kvdb-mem backup
```

### 定时任务部署

**Cron 配置示例**
```bash
# 编辑 crontab
crontab -e

# 每天凌晨 2 点执行备份
0 2 * * * /usr/local/bin/kvdb-mem backup --db /data/kv.db --backup-dir /backups/kvdb >> /var/log/kvdb-backup.log 2>&1

# 每周日凌晨 3 点执行检查
0 3 * * 0 /usr/local/bin/kvdb-mem check --db /data/kv.db --mode FULL >> /var/log/kvdb-check.log 2>&1

# 每月 1 号凌晨 4 点执行修复检查
0 4 1 * * /usr/local/bin/kvdb-mem repair --db /data/kv.db --keyword maintenance >> /var/log/kvdb-repair.log 2>&1
```

---

## 开发工作流

### 环境准备

**1. 安装 Bun**
```bash
# macOS/Linux
curl -fsSL https://bun.sh/install | bash

# Windows PowerShell
powershell -c "irm bun.sh/install.ps1|iex"

# 验证安装
bun --version  # 应显示 1.0.0 或更高版本
```

**2. 克隆项目**
```bash
git clone https://github.com/your-org/kvdb-mem.git
cd kvdb-mem
```

**3. 安装依赖**
```bash
bun install
```

### 开发模式

**启动开发服务器**
```bash
# 主服务开发模式
bun run dev

# MCP 服务开发模式
bun run dev:mcp

# 同时启动两个服务
bun run dev:all
```

**CLI 开发测试**
```bash
# 直接运行 CLI（TypeScript 源码）
bun run ./src/cli/index.ts --help

# 测试备份命令
bun run ./src/cli/index.ts backup --db ./test.db

# 测试检查命令
bun run ./src/cli/index.ts check --mode FULL

# 测试修复命令
bun run ./src/cli/index.ts repair --keyword test
```

### 构建流程

**开发构建**
```bash
# 构建二进制文件（开发版本，无压缩）
bun run build

# 构建输出
ls -lh dist/
# -rwxr-xr-x  1 user  group    98M Feb 14 12:00 dist/kvdb-mem
```

**生产构建优化**
```bash
# 使用 NODE_ENV=production 优化构建
NODE_ENV=production bun run build

# 验证构建结果
./dist/kvdb-mem --help
./dist/kvdb-mem check --mode FULL
```

**构建验证**
```bash
# 运行测试套件验证构建
bun test

# 运行特定测试
bun test tests/kv.sqlite.test.ts
bun test tests/db.schema.test.ts
```

### 发布工作流

**版本管理**
```bash
# 1. 更新版本号
# 编辑 package.json
# "version": "1.7.0" → "version": "1.8.0"

# 2. 更新 CHANGELOG.md
# 记录所有变更

# 3. 提交变更
git add package.json CHANGELOG.md
git commit -m "chore: bump version to 1.8.0"
```

**构建发布产物**
```bash
# 清理旧构建
rm -rf dist/

# 生产构建
NODE_ENV=production bun run build

# 验证构建
./dist/kvdb-mem --help
./dist/kvdb-mem check

# 压缩打包
tar -czvf kvdb-mem-v1.8.0-linux-x64.tar.gz -C dist kvdb-mem
```

**多平台构建**
```bash
#!/bin/bash
# scripts/build-all-platforms.sh

VERSION=$(node -p "require('./package.json').version")
PLATFORMS=("linux-x64" "darwin-x64" "darwin-arm64")

for platform in "${PLATFORMS[@]}"; do
  echo "Building for $platform..."
  
  # 这里需要对应平台的 Bun 版本或交叉编译支持
  # 目前 Bun 的 compile 功能有限制
  
  OUTPUT="kvdb-mem-v${VERSION}-${platform}"
  tar -czvf "${OUTPUT}.tar.gz" -C dist kvdb-mem
done
```

---

## 故障排除

### 构建问题

**问题：构建失败，提示找不到 Bun**
```
error: command not found: bun
```

**解决方案**
```bash
# 检查 Bun 是否安装
which bun

# 未安装则安装
curl -fsSL https://bun.sh/install | bash

# 添加到 PATH
export PATH="$HOME/.bun/bin:$PATH"
```

**问题：构建成功但二进制文件无法运行**
```
./dist/kvdb-mem: cannot execute binary file: Exec format error
```

**解决方案**
```bash
# 检查架构匹配
uname -m  # 显示本机架构
file ./dist/kvdb-mem  # 检查二进制架构

# 如果在 x64 机器上构建了 arm64 二进制，需要重新构建
rm -rf dist/
bun run build
```

**问题：构建输出文件过大**
```bash
ls -lh dist/
# -rwxr-xr-x  1 user  group   500M Feb 14 12:00 kvdb-mem
```

**解决方案**
```bash
# 启用压缩
NODE_ENV=production bun run build

# 检查是否有不必要的依赖
cat package.json | grep dependencies

# 考虑使用 UPX 压缩（可选）
upx --best dist/kvdb-mem
```

### 运行时问题

**问题：找不到数据库文件**
```
[cli:backup] error: command failed
  [Error: ENOENT: no such file or directory, open './kv.db']
```

**解决方案**
```bash
# 检查文件是否存在
ls -la kv.db

# 使用绝对路径
kvdb-mem backup --db $(pwd)/kv.db

# 或设置环境变量
export KVDB_SQLITE_FILE=/path/to/kv.db
kvdb-mem backup
```

**问题：权限不足**
```
[cli:backup] error: command failed
  [Error: EACCES: permission denied, mkdir '/backups']
```

**解决方案**
```bash
# 检查目录权限
ls -ld /backups

# 创建目录并设置权限
sudo mkdir -p /backups/kvdb
sudo chown $(whoami):$(whoami) /backups/kvdb

# 或使用当前用户目录
kvdb-mem backup --backup-dir ~/backups
```

**问题：WAL 模式相关错误**
```
[cli:check] error: command failed
  [Error: database is locked]
```

**解决方案**
```bash
# 确保没有其他进程正在使用数据库
lsof kv.db
lsof kv.db-wal

# 等待 WAL 检查点
sqlite3 kv.db "PRAGMA wal_checkpoint(TRUNCATE);"

# 检查 WAL 文件大小
ls -lh kv.db-wal
```

### 环境配置问题

**问题：环境变量未生效**
```bash
kvdb-mem backup
# 仍然使用默认路径，而非环境变量设置的值
```

**解决方案**
```bash
# 检查环境变量是否正确设置
echo $KVDB_SQLITE_FILE
echo $KVDB_BACKUP_DIR

# 确保导出环境变量
export KVDB_SQLITE_FILE=/data/kv.db
export KVDB_BACKUP_DIR=/backups

# 或在一行中执行
KVDB_SQLITE_FILE=/data/kv.db KVDB_BACKUP_DIR=/backups kvdb-mem backup
```

**问题：Windows 系统路径问题**
```
[cli:backup] error: command failed
  [Error: ENOENT: no such file or directory, open 'C:\path\to\kv.db']
```

**解决方案**
```powershell
# 使用正斜杠或双反斜杠
kvdb-mem backup --db "C:/path/to/kv.db"
kvdb-mem backup --db "C:\\path\\to\\kv.db"

# 使用原始字符串
kvdb-mem backup --db 'C:\path\to\kv.db'
```

---

## 最佳实践

### 开发最佳实践

**1. 代码组织**
```
src/cli/
├── index.ts      # CLI 入口和命令路由
├── backup.ts     # 备份命令实现
├── repair.ts     # 修复命令实现
├── check.ts      # 检查命令实现
└── common.ts     # 共享工具函数

# 每个命令文件专注于单一职责
```

**2. 错误处理模式**
```typescript
// 使用统一的错误处理
export function runCommandSafely(scope: string, run: (logger: CliLogger) => number): number {
  const logger = createCliLogger(scope);
  try {
    return run(logger);
  } catch (error) {
    logger.log("error", "command failed", error);
    return 1;
  }
}
```

**3. 环境配置管理**
```typescript
// 优先级：显式参数 > 环境变量 > 默认值
const databaseFile = options.databaseFile ?? process.env.KVDB_SQLITE_FILE ?? "kv.db";
const backupDir = options.backupDir ?? process.env.KVDB_BACKUP_DIR ?? "backups";
```

### 构建最佳实践

**1. 版本管理**
```bash
# package.json 版本语义化
{
  "version": "1.7.0",  # 主版本.次版本.修订号
  # 主版本：破坏性变更
  # 次版本：功能添加
  # 修订号：Bug 修复
}
```

**2. 自动化构建流程**
```bash
#!/bin/bash
# scripts/build-release.sh

set -e

VERSION=$(node -p "require('./package.json').version")

echo "Building version $VERSION..."

# 清理
rm -rf dist/

# 构建
NODE_ENV=production bun run build

# 验证
./dist/kvdb-mem --help
./dist/kvdb-mem check

# 打包
tar -czvf "kvdb-mem-v${VERSION}-$(uname -s)-$(uname -m).tar.gz" -C dist kvdb-mem

echo "Build complete!"
```

**3. 构建缓存优化**
```typescript
// build.ts 中使用增量构建
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";

async function needsRebuild(source: string, output: string): Promise<boolean> {
  if (!existsSync(output)) return true;
  
  const sourceStat = await stat(source);
  const outputStat = await stat(output);
  
  return sourceStat.mtime > outputStat.mtime;
}

// 使用时
if (await needsRebuild("./src/cli/index.ts", OUTFILE)) {
  // 执行构建
}
```

### 部署最佳实践

**1. 生产环境配置**
```bash
# /etc/kvdb-mem/production.env
KVDB_SQLITE_FILE=/var/lib/kvdb/production.db
KVDB_BACKUP_DIR=/var/backups/kvdb

# 文件权限设置
chmod 600 /etc/kvdb-mem/production.env
chown root:root /etc/kvdb-mem/production.env
```

**2. 部署脚本**
```bash
#!/bin/bash
# scripts/deploy.sh

set -e

ENVIRONMENT=${1:-production}
VERSION=${2:-latest}

echo "Deploying version $VERSION to $ENVIRONMENT..."

# 下载二进制文件
wget -O /tmp/kvdb-mem "https://artifacts.example.com/kvdb-mem/$VERSION/kvdb-mem-linux-x64"
chmod +x /tmp/kvdb-mem

# 停止现有服务（如果使用 systemd）
# systemctl stop kvdb-mem || true

# 部署新版本
mv /tmp/kvdb-mem /usr/local/bin/kvdb-mem

# 验证部署
/usr/local/bin/kvdb-mem --help
/usr/local/bin/kvdb-mem check

# 重启服务
# systemctl start kvdb-mem

echo "Deployment complete!"
```

**3. 健康检查脚本**
```bash
#!/bin/bash
# scripts/health-check.sh

KVDB_SQLITE_FILE=${KVDB_SQLITE_FILE:-"./kv.db"}

# 运行检查
OUTPUT=$(kvdb-mem check --db "$KVDB_SQLITE_FILE" --mode QUICK 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo "HEALTH_CHECK_FAILED: kvdb-mem check returned exit code $EXIT_CODE"
  echo "Output: $OUTPUT"
  exit 1
fi

# 解析 JSON 输出
OK=$(echo "$OUTPUT" | grep -o '"ok": *true' | wc -l)

if [ "$OK" -eq 0 ]; then
  echo "HEALTH_CHECK_FAILED: Database check did not return ok: true"
  exit 1
fi

echo "HEALTH_CHECK_PASSED: Database is healthy"
exit 0
```

### 监控和日志

**1. 日志配置**
```bash
# 使用 logger 记录 CLI 输出
kvdb-mem backup 2>&1 | logger -t kvdb-mem

# 使用 systemd journal
kvdb-mem check | systemd-cat -t kvdb-mem
```

**2. 结构化日志输出**
```typescript
// 启用 JSON 日志格式
export function createJsonLogger(scope: string): CliLogger {
  return {
    log(level, message, payload) {
      const entry = {
        timestamp: new Date().toISOString(),
        scope,
        level,
        message,
        payload,
      };
      console.log(JSON.stringify(entry));
    },
  };
}
```

---

## 向后兼容性

### 版本兼容性矩阵

| CLI 版本 | Bun 版本 | SQLite 版本 | 兼容性 |
|----------|----------|-------------|--------|
| 1.7.0+ | 1.0.0+ | 3.35+ | ✅ 完全兼容 |
| 1.6.x | 1.0.0+ | 3.35+ | ✅ 兼容 |
| < 1.6.0 | 0.x | 3.30+ | ⚠️ 部分兼容 |

### API 兼容性

**命令参数变更**
- v1.7.0: 新增 `--init` 标志到 `check` 命令
- v1.6.0: `backup` 命令新增 `--backup-dir` 选项（替代环境变量单一方式）
- v1.5.0: 所有命令统一使用 `--db` 选项

**JSON 输出格式**
```typescript
// v1.7.0+ 新增字段
interface CheckResult {
  databaseFile: string;
  shouldInit: boolean;      // v1.7.0 新增
  ok: boolean;
  mode: string;
  messages: string[];
  fts5Stats?: {             // v1.7.0 新增
    memoryCount: number;
    fts5RowCount: number;
    triggerCount: number;
  };
}
```

### 迁移指南

**从 v1.6 迁移到 v1.7**
```bash
# 1. 检查当前版本
kvdb-mem --help | head -5

# 2. 备份现有数据库
kvdb-mem backup --db ./old.db --backup-dir ./migration-backups

# 3. 更新二进制文件
sudo cp dist/kvdb-mem /usr/local/bin/

# 4. 验证新版本
kvdb-mem check --init  # 如果需要初始化 schema

# 5. 运行测试
kvdb-mem check --mode FULL
```

**环境变量迁移**
```bash
# v1.6 环境变量
export KV_SQLITE_FILE=./kv.db

# v1.7 环境变量（保持兼容）
export KVDB_SQLITE_FILE=./kv.db  # 优先使用新名称
# KV_SQLITE_FILE 仍然被支持（向后兼容）
```

### 弃用功能

| 功能 | 弃用版本 | 移除版本 | 替代方案 |
|------|----------|----------|----------|
| `KV_SQLITE_FILE` | v1.7.0 | v2.0.0 | `KVDB_SQLITE_FILE` |
| `--quick` 标志 | v1.6.0 | v1.7.0 | `check QUICK` 或 `--mode QUICK` |
| JSON 输出中的 `status` 字段 | v1.7.0 | v2.0.0 | `ok` 字段 |

---

## 附录

### 环境变量参考

| 变量名 | 默认值 | 说明 | 适用命令 |
|--------|--------|------|----------|
| `KVDB_SQLITE_FILE` | `kv.db` | SQLite 数据库文件路径 | 所有命令 |
| `KVDB_BACKUP_DIR` | `backups` | 备份输出目录 | backup |
| `NODE_ENV` | - | 运行环境 | 构建时 |

### 退出码参考

| 退出码 | 含义 | 处理建议 |
|--------|------|----------|
| 0 | 成功 | - |
| 1 | 一般错误 | 检查错误日志 |
| 2 | 误用命令 | 检查参数用法 |
| 126 | 命令不可执行 | 检查文件权限 |
| 127 | 命令未找到 | 检查 PATH 设置 |
| 130 | 用户中断 (Ctrl+C) | - |

### 相关文档

- [README.md](../README.md) - 项目概览
- [API.md](../API.md) - API 参考
- [MCP-README.md](../MCP-README.md) - MCP 集成指南
- [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) - 部署指南

---

**文档版本**: 1.0.0  
**最后更新**: 2026-02-14  
**维护者**: KVDB-MEM 开发团队
