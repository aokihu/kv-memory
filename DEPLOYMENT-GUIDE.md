# 搜索功能部署指南

本文档提供 kvdb-mem v1.0 搜索功能的部署指南。

## 部署前提

### 系统要求
- **Bun**: v1.0.0 或更高版本
- **SQLite**: 3.35.0 或更高版本（支持 FTS5）
- **Node.js**: v16.0.0 或更高版本（可选）

### 环境检查
```bash
# 检查 Bun 版本
bun --version

# 检查 SQLite FTS5 支持
echo "SELECT fts5(?);" | sqlite3 :memory: <<< "test"
```

## 部署步骤

### 1. 备份现有数据
```bash
# 备份数据库文件
cp data/memories.db data/memories.db.backup.$(date +%Y%m%d_%H%M%S)

# 或者使用备份脚本
bash scripts/migration-dry-run.sh
```

### 2. 安装依赖
```bash
# 安装项目依赖
bun install

# 验证依赖安装
bunx tsc --noEmit
```

### 3. 数据库迁移
```bash
# 运行数据库迁移（如果需要）
bun run src/libs/kv/db/migrate.ts

# 或者重置数据库（开发环境）
rm -f data/memories.db
```

### 4. 配置环境变量
创建或更新 `.env` 文件：
```bash
# 必需：启用搜索功能
KVDB_SEARCH_ENABLED=true

# 可选：搜索配置
KVDB_SEARCH_DEFAULT_LIMIT=20
KVDB_SEARCH_MAX_LIMIT=100

# 可选：数据库路径
KVDB_DATABASE_PATH=./data/memories.db
```

### 5. 运行测试
```bash
# 运行搜索功能相关测试
bun test tests/db.fts-migration.test.ts
bun test tests/search.service.test.ts
bun test tests/search.api.integration.test.ts
bun test tests/mcp.search-tools.test.ts
bun test tests/search.performance.test.ts
bun test tests/final-verification.test.ts

# 运行所有测试
bun test
```

### 6. 验证部署
```bash
# 启动服务
bun run dev &

# 等待服务启动
sleep 2

# 测试搜索功能
curl "http://localhost:3000/search?q=test"

# 测试全文搜索
curl "http://localhost:3000/fulltext?q=test+AND+search"

# 测试 MCP 工具
echo '{"tool": "memory_search", "arguments": {"query": "test"}}' | bun run mcp
```

## 自动化部署脚本

### 完整部署脚本
```bash
#!/bin/bash
# deploy-search.sh

set -e

echo "🚀 开始部署搜索功能 v1.0"

# 1. 备份
cp data/memories.db "data/memories.db.backup.$(date +%Y%m%d_%H%M%S)"

# 2. 安装
bun install

# 3. 配置
echo "KVDB_SEARCH_ENABLED=true" >> .env
echo "KVDB_SEARCH_DEFAULT_LIMIT=20" >> .env
echo "KVDB_SEARCH_MAX_LIMIT=100" >> .env

# 4. 测试
bun test tests/db.fts-migration.test.ts \
          tests/search.service.test.ts \
          tests/search.api.integration.test.ts \
          tests/mcp.search-tools.test.ts \
          tests/search.performance.test.ts \
          tests/final-verification.test.ts

# 5. 验证
bun run dev &
SERVER_PID=$!
sleep 3

curl -s "http://localhost:3000/search?q=deployment" | grep -q "total" && echo "✅ 搜索功能正常" || echo "❌ 搜索功能异常"

kill $SERVER_PID

echo "🎉 部署完成"
```

### 快速部署命令
```bash
# 一键部署（开发环境）
bash <(curl -s https://raw.githubusercontent.com/your-repo/kvdb-mem/main/scripts/deploy.sh)

# 或使用 npm 脚本
bun run deploy:verify
```

## 生产环境部署

### Docker 部署
```dockerfile
FROM oven/bun:latest

WORKDIR /app

COPY package.json bun.lockb ./
RUN bun install --production

COPY . .

ENV KVDB_SEARCH_ENABLED=true
ENV KVDB_DATABASE_PATH=/data/memories.db
ENV PORT=3000

VOLUME /data

EXPOSE 3000

CMD ["bun", "run", "dev"]
```

### Kubernetes 部署
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kvdb-mem
spec:
  replicas: 1
  selector:
    matchLabels:
      app: kvdb-mem
  template:
    metadata:
      labels:
        app: kvdb-mem
    spec:
      containers:
      - name: kvdb-mem
        image: your-registry/kvdb-mem:latest
        ports:
        - containerPort: 3000
        env:
        - name: KVDB_SEARCH_ENABLED
          value: "true"
        - name: KVDB_DATABASE_PATH
          value: "/data/memories.db"
        volumeMounts:
        - name: data
          mountPath: /data
      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: kvdb-data-pvc
```

## 故障排除

### 常见问题

#### 1. 搜索功能未启用
**症状**: API 返回 `search_disabled` 错误
**解决**: 确保 `.env` 文件中设置了 `KVDB_SEARCH_ENABLED=true`

#### 2. FTS5 表不存在
**症状**: 搜索时出现 SQL 错误
**解决**: 运行数据库迁移或重置数据库
```bash
rm -f data/memories.db
bun run dev
```

#### 3. 性能问题
**症状**: 搜索响应慢
**解决**:
- 优化数据库索引
- 增加内存缓存
- 使用分页限制结果数量

#### 4. MCP 工具不可用
**症状**: `memory_search` 工具未找到
**解决**: 确保 MCP 服务器已重新启动并加载了新工具

### 诊断命令
```bash
# 检查数据库结构
sqlite3 data/memories.db ".tables"
sqlite3 data/memories.db ".schema memories_fts"

# 检查环境变量
env | grep KVDB

# 检查服务状态
curl -s "http://localhost:3000/search?q=test" | jq .

# 检查日志
tail -f logs/app.log
```

## 回滚步骤

如果部署出现问题，可以回滚到之前版本：

### 1. 停止服务
```bash
pkill -f "bun run dev"
```

### 2. 恢复数据库
```bash
# 找到最新的备份文件
BACKUP_FILE=$(ls -t data/memories.db.backup.* | head -1)

# 恢复数据库
cp "$BACKUP_FILE" data/memories.db
```

### 3. 恢复配置
```bash
# 禁用搜索功能
sed -i 's/KVDB_SEARCH_ENABLED=true/KVDB_SEARCH_ENABLED=false/' .env
```

### 4. 重启服务
```bash
bun run dev
```

## 监控和维护

### 监控指标
- 搜索请求数量
- 平均响应时间
- 错误率
- 内存使用情况

### 维护任务
1. **定期备份数据库**
2. **优化 FTS5 索引**（每月）
3. **清理旧数据**（根据需要）
4. **更新依赖**（每季度）

### 性能优化建议
1. 使用 SSD 存储数据库
2. 增加数据库连接池大小
3. 实现查询缓存
4. 使用 CDN 缓存静态资源

## 支持与联系

如有问题，请：
1. 查看项目文档
2. 检查 GitHub Issues
3. 提交新的 Issue
4. 联系维护团队

---

**部署完成标志**: 当所有测试通过且搜索功能正常响应时，部署完成。

**最后更新**: $(date)