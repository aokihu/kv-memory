# SQLite崩溃安全部署指南

## 概述

本文档提供"ensure-sqlite-crash-safety"变更的部署指南，确保SQLite数据库在服务器非正常退出时的数据持久性。

## 部署前提

### 1. 代码变更已合并
确保以下变更已合并到部署分支：
- SQLite配置优化（WAL模式、EXTRA同步级别）
- 事务管理增强
- 安全关闭和崩溃恢复机制
- 相关测试和文档更新

### 2. 环境要求
- Bun运行时环境
- 足够的磁盘空间（考虑WAL文件增长）
- 文件系统支持原子写入（推荐ext4、ZFS等）

## 部署步骤

### 阶段1：开发环境部署验证（7.1）

#### 1.1 构建验证
```bash
# 编译检查
bunx tsc --noEmit

# 运行关键测试
bun test tests/db.config.test.ts tests/db.schema.test.ts tests/db.transaction.test.ts tests/db.crash-recovery.test.ts tests/db.integrity.test.ts tests/http-mcp.concurrent.test.ts
```

#### 1.2 配置验证
```bash
# 验证默认配置
KVDB_SQLITE_SYNCHRONOUS=EXTRA bun test tests/db.config.test.ts

# 验证配置覆盖
KVDB_SQLITE_SYNCHRONOUS=FULL bun test tests/db.config.test.ts
KVDB_SQLITE_JOURNAL_MODE=DELETE bun test tests/db.config.test.ts
```

#### 1.3 功能验证
```bash
# 启动HTTP服务器测试
bun run dev &
SERVER_PID=$!
sleep 2

# 测试API
curl -X POST http://localhost:3030/api/login -H "Content-Type: application/json" -d '{"username":"test"}'
curl -X POST http://localhost:3030/api/memory -H "Content-Type: application/json" -d '{"key":"test-key","summary":"test","text":"test content"}'

# 停止服务器
kill $SERVER_PID
wait $SERVER_PID

# 验证数据持久性
bun run dev &
sleep 2
curl http://localhost:3030/api/memory/test-key
kill %%
```

### 阶段2：测试环境全面测试（7.2）

#### 2.1 压力测试
```bash
# 运行性能基准测试
bun run bench:sqlite-safety

# 并发测试
bun test tests/http-mcp.concurrent.test.ts --repeat=10
```

#### 2.2 崩溃恢复测试
```bash
# 运行崩溃恢复测试
bun test tests/db.crash-recovery.test.ts --repeat=5
```

#### 2.3 完整性检查
```bash
# 验证数据库完整性工具
bun test tests/db.integrity.test.ts
```

### 阶段3：生产环境灰度发布计划（7.3）

#### 3.1 发布策略
1. **金丝雀发布**：先部署到少量实例（10%流量）
2. **监控指标**：观察数据持久性、性能、错误率
3. **逐步扩大**：每24小时增加25%实例，直到100%

#### 3.2 配置管理
```bash
# 生产环境推荐配置
export KVDB_SQLITE_SYNCHRONOUS=EXTRA
export KVDB_SQLITE_JOURNAL_MODE=WAL
export KVDB_SQLITE_BUSY_TIMEOUT_MS=5000
export KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS=300000  # 5分钟
export KVDB_SQLITE_INTEGRITY_CHECK=FULL
```

#### 3.3 回滚准备
1. 备份现有数据库文件
2. 准备回滚脚本
3. 定义回滚触发条件

### 阶段4：监控生产环境数据持久性指标（7.4）

#### 4.1 关键监控指标
| 指标 | 监控方法 | 告警阈值 |
|------|----------|----------|
| WAL文件大小 | 文件系统监控 | > 100MB |
| 检查点频率 | 日志分析 | < 1次/5分钟 |
| 事务提交时间 | 应用日志 | > 100ms |
| 数据库完整性 | 定期检查 | integrity_check != "ok" |
| 崩溃恢复次数 | 启动日志 | > 0次/天 |

#### 4.2 监控脚本示例
```bash
#!/bin/bash
# monitor-wal.sh

DB_FILE="${KVDB_SQLITE_FILE:-./kv.db}"
WAL_FILE="${DB_FILE}-wal"

if [ -f "$WAL_FILE" ]; then
    WAL_SIZE=$(stat -c%s "$WAL_FILE")
    echo "WAL文件大小: $((WAL_SIZE / 1024 / 1024))MB"
    
    if [ $WAL_SIZE -gt $((100 * 1024 * 1024)) ]; then
        echo "警告: WAL文件超过100MB"
        # 执行检查点
        sqlite3 "$DB_FILE" "PRAGMA wal_checkpoint(TRUNCATE);"
    fi
fi

# 检查数据库完整性
INTEGRITY=$(sqlite3 "$DB_FILE" "PRAGMA quick_check;")
if [ "$INTEGRITY" != "ok" ]; then
    echo "错误: 数据库完整性检查失败: $INTEGRITY"
fi
```

#### 4.3 日志监控
```bash
# 监控启动日志中的恢复信息
grep -i "wal.*recover\|checkpoint\|integrity" /var/log/kvdb-mem.log

# 监控错误日志
grep -i "error\|fail\|busy\|locked" /var/log/kvdb-mem.log
```

### 阶段5：制定回滚策略和应急方案（7.5）

#### 5.1 回滚触发条件
- 数据丢失或损坏
- 性能下降超过50%
- 崩溃恢复失败
- 监控指标持续异常

#### 5.2 回滚步骤
1. **立即停止新版本实例**
   ```bash
   systemctl stop kvdb-mem
   ```

2. **恢复旧版本配置**
   ```bash
   # 恢复环境变量
   export KVDB_SQLITE_SYNCHRONOUS=FULL
   export KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS=0
   export KVDB_SQLITE_INTEGRITY_CHECK=OFF
   ```

3. **启动旧版本实例**
   ```bash
   systemctl start kvdb-mem
   ```

4. **验证回滚成功**
   ```bash
   systemctl status kvdb-mem
   tail -f /var/log/kvdb-mem.log
   ```

#### 5.3 应急处理
1. **数据库损坏**
   ```bash
   # 1. 停止服务
   systemctl stop kvdb-mem
   
   # 2. 备份损坏文件
   cp kv.db kv.db.corrupted.$(date +%Y%m%d_%H%M%S)
   
   # 3. 尝试修复
   sqlite3 kv.db ".recover" | sqlite3 kv.db.recovered
   
   # 4. 替换数据库文件
   mv kv.db.recovered kv.db
   
   # 5. 重启服务
   systemctl start kvdb-mem
   ```

2. **WAL文件过大**
   ```bash
   # 手动执行检查点
   sqlite3 kv.db "PRAGMA wal_checkpoint(TRUNCATE);"
   
   # 如果检查点失败，重启服务
   systemctl restart kvdb-mem
   ```

3. **性能问题**
   ```bash
   # 临时降低同步级别
   export KVDB_SQLITE_SYNCHRONOUS=FULL
   systemctl restart kvdb-mem
   ```

## 部署验证清单

### 部署前验证
- [ ] 所有测试通过（`bun test`）
- [ ] 性能基准测试结果可接受
- [ ] 文档已更新
- [ ] 配置已备份

### 部署中验证
- [ ] 服务正常启动
- [ ] API功能正常
- [ ] 数据持久性测试通过
- [ ] 监控指标正常

### 部署后验证
- [ ] 24小时运行无异常
- [ ] 数据完整性检查通过
- [ ] 性能指标稳定
- [ ] 错误日志无异常

## 相关文档

1. [配置文档](CONFIGURATION.md) - 详细配置说明
2. [部署指南](DEPLOYMENT_GUIDE.md) - 通用部署指南
3. [WAL监控指南](WAL_MONITORING.md) - WAL文件监控
4. [故障排除指南](SQLITE_CRASH_SAFETY_TROUBLESHOOTING.md) - 问题诊断和解决
5. [API文档](API.md) - API接口说明

## 支持与联系

如遇部署问题，请参考：
1. 检查日志文件：`/var/log/kvdb-mem.log`
2. 验证配置：`env | grep KVDB`
3. 测试数据库连接：`sqlite3 kv.db "PRAGMA journal_mode;"`
4. 联系技术支持团队