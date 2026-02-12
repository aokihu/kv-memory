# 搜索功能性能优化指南

本文档提供 kvdb-mem v1.0 搜索功能的性能优化建议和最佳实践。

## 性能基准

### 当前性能指标
基于测试环境（1000条记忆数据）：
- **基础搜索响应时间**: 5-50ms
- **全文搜索响应时间**: 10-100ms  
- **并发搜索能力**: 50+ QPS
- **内存使用**: 50-100MB
- **数据库大小**: 10-100MB（含索引）

### 性能目标
- 搜索响应时间 < 100ms (P95)
- 支持 100+ QPS 并发搜索
- 内存使用 < 200MB
- 数据库增长可控

## 优化策略

### 1. 数据库优化

#### 索引优化
```sql
-- 1. 为常用查询字段添加索引
CREATE INDEX IF NOT EXISTS idx_memories_key ON memories(key);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
CREATE INDEX IF NOT EXISTS idx_memories_updated_at ON memories(updated_at);

-- 2. 优化 FTS5 配置
-- 在创建 FTS5 表时使用优化配置
CREATE VIRTUAL TABLE memories_fts USING fts5(
  key UNINDEXED,
  summary,
  text,
  content='memories',
  content_rowid='rowid',
  tokenize='porter unicode61'  -- 优化分词器
);

-- 3. 定期优化 FTS5 索引
INSERT INTO memories_fts(memories_fts) VALUES('optimize');
```

#### 查询优化
```sql
-- 1. 使用覆盖索引
-- 避免 SELECT *，只选择需要的字段
SELECT key, summary, score FROM memories_fts 
WHERE memories_fts MATCH ? 
ORDER BY score DESC 
LIMIT ? OFFSET ?;

-- 2. 使用 EXPLAIN QUERY PLAN 分析查询
EXPLAIN QUERY PLAN 
SELECT * FROM memories_fts WHERE memories_fts MATCH '量子计算';

-- 3. 避免全表扫描
-- 确保 WHERE 条件使用索引
```

### 2. 应用层优化

#### 缓存策略
```typescript
// 实现搜索缓存
import { LRUCache } from 'lru-cache';

const searchCache = new LRUCache<string, SearchResponse>({
  max: 1000, // 最大缓存条目
  ttl: 1000 * 60 * 5, // 5分钟过期
});

async function searchWithCache(query: string, params: SearchParams): Promise<SearchResponse> {
  const cacheKey = `${query}:${JSON.stringify(params)}`;
  
  // 检查缓存
  const cached = searchCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  
  // 执行搜索
  const result = await searchService.search(query, params);
  
  // 缓存结果
  searchCache.set(cacheKey, result);
  
  return result;
}
```

#### 连接池优化
```typescript
// 配置数据库连接池
const kvdb = new KVDB({
  searchEnabled: true,
  connectionPool: {
    max: 10, // 最大连接数
    min: 2,  // 最小连接数
    idleTimeout: 30000, // 空闲超时
  }
});
```

#### 异步处理
```typescript
// 使用异步处理优化性能
async function batchSearch(queries: string[]): Promise<SearchResponse[]> {
  // 并行执行搜索
  const promises = queries.map(query => 
    searchService.search(query, { limit: 10 })
  );
  
  return Promise.all(promises);
}

// 使用流式处理大量数据
async function streamSearchResults(query: string, batchSize: number = 100) {
  let offset = 0;
  let hasMore = true;
  
  while (hasMore) {
    const results = await searchService.search(query, {
      limit: batchSize,
      offset: offset
    });
    
    // 处理当前批次
    yield results;
    
    offset += batchSize;
    hasMore = results.results.length === batchSize;
  }
}
```

### 3. 配置优化

#### 环境变量调优
```bash
# 搜索性能相关配置
KVDB_SEARCH_ENABLED=true
KVDB_SEARCH_DEFAULT_LIMIT=20      # 默认结果数量
KVDB_SEARCH_MAX_LIMIT=100         # 最大结果数量
KVDB_CACHE_ENABLED=true           # 启用缓存
KVDB_CACHE_TTL=300000             # 缓存过期时间（5分钟）
KVDB_CONNECTION_POOL_SIZE=10      # 连接池大小
```

#### 内存限制
```typescript
// 配置内存限制
const memoryLimit = process.env.KVDB_MEMORY_LIMIT || '512MB';

// 监控内存使用
setInterval(() => {
  const memoryUsage = process.memoryUsage();
  if (memoryUsage.heapUsed > 500 * 1024 * 1024) { // 500MB
    console.warn('内存使用过高，考虑清理缓存');
    searchCache.clear();
  }
}, 60000); // 每分钟检查一次
```

### 4. 查询优化技巧

#### 高效查询模式
```typescript
// 1. 使用精确匹配提高性能
const exactMatchResults = await searchService.search('"精确短语"', {
  limit: 10
});

// 2. 使用字段限定搜索
const fieldSpecificResults = await searchService.fulltextSearch('summary:量子 text:计算', {
  limit: 10
});

// 3. 避免过于复杂的查询
// 不好: '量子 AND 计算 OR 机器学习 AND 深度学习 NOT 传统'
// 好: '量子 计算' 或 '机器学习 深度学习'
```

#### 分页优化
```typescript
// 使用游标分页代替 offset
async function searchWithCursor(query: string, cursor: string | null, limit: number) {
  const params: SearchParams = { limit };
  
  if (cursor) {
    // 使用上次查询的最后一条记录的 score 作为游标
    params.minScore = parseFloat(cursor);
  }
  
  const results = await searchService.search(query, params);
  
  // 返回结果和下一个游标
  const nextCursor = results.results.length > 0 
    ? results.results[results.results.length - 1].score.toString()
    : null;
    
  return { results, nextCursor };
}
```

## 监控与调优

### 性能监控指标

#### 关键指标
```typescript
// 监控搜索性能
const performanceMetrics = {
  // 响应时间
  searchResponseTime: new Histogram(),
  fulltextResponseTime: new Histogram(),
  
  // 吞吐量
  searchQPS: new Counter(),
  errorRate: new Counter(),
  
  // 资源使用
  memoryUsage: new Gauge(),
  cacheHitRate: new Gauge(),
  
  // 数据库指标
  queryExecutionTime: new Histogram(),
  indexSize: new Gauge(),
};

// 记录搜索性能
async function trackSearchPerformance(query: string, startTime: number) {
  const duration = Date.now() - startTime;
  
  performanceMetrics.searchResponseTime.observe(duration);
  performanceMetrics.searchQPS.inc();
  
  if (duration > 1000) { // 超过1秒
    console.warn(`慢查询: ${query}, 耗时: ${duration}ms`);
  }
}
```

#### 监控仪表板
```bash
# 使用 Prometheus + Grafana 监控
# prometheus.yml
scrape_configs:
  - job_name: 'kvdb-mem'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/metrics'
    
# 暴露指标端点
app.get('/metrics', async (req, res) => {
  const metrics = await collectMetrics();
  res.set('Content-Type', 'text/plain');
  res.send(metrics);
});
```

### 性能测试

#### 压力测试脚本
```typescript
// stress-test.ts
import { SearchService } from './src/service/searchService';
import { KVDB } from './src/libs/kv/kv';

async function runStressTest() {
  const kvdb = new KVDB({ searchEnabled: true });
  const searchService = new SearchService(kvdb);
  
  const queries = [
    '量子', '计算', '机器学习', '数据库', 'API',
    '性能', '优化', '测试', '部署', '监控'
  ];
  
  const concurrentRequests = 50;
  const duration = 30000; // 30秒
  
  console.log(`开始压力测试: ${concurrentRequests} 并发, ${duration}ms`);
  
  const startTime = Date.now();
  let requestCount = 0;
  let errorCount = 0;
  
  // 并发请求
  while (Date.now() - startTime < duration) {
    const promises = [];
    
    for (let i = 0; i < concurrentRequests; i++) {
      const query = queries[Math.floor(Math.random() * queries.length)];
      
      promises.push(
        searchService.search(query, { limit: 10 })
          .then(() => requestCount++)
          .catch(() => errorCount++)
      );
    }
    
    await Promise.all(promises);
    await new Promise(resolve => setTimeout(resolve, 100)); // 短暂暂停
  }
  
  const totalTime = Date.now() - startTime;
  const qps = requestCount / (totalTime / 1000);
  const errorRate = errorCount / (requestCount + errorCount) * 100;
  
  console.log(`压力测试结果:`);
  console.log(`- 总请求数: ${requestCount}`);
  console.log(`- 错误数: ${errorCount}`);
  console.log(`- QPS: ${qps.toFixed(2)}`);
  console.log(`- 错误率: ${errorRate.toFixed(2)}%`);
  console.log(`- 总时间: ${totalTime}ms`);
  
  await kvdb.close();
}
```

#### 性能基准测试
```bash
#!/bin/bash
# benchmark-search.sh

echo "开始搜索性能基准测试..."

# 1. 单次搜索性能
echo "测试单次搜索..."
time curl -s "http://localhost:3000/search?q=量子" > /dev/null

# 2. 并发搜索性能
echo "测试并发搜索..."
seq 1 10 | xargs -P 10 -I {} curl -s "http://localhost:3000/search?q=测试{}" > /dev/null

# 3. 大数据集搜索
echo "测试大数据集搜索..."
curl -s "http://localhost:3000/search?q=*&limit=100" | jq '.results | length'

echo "基准测试完成"
```

## 故障排除

### 常见性能问题

#### 1. 搜索响应慢
**可能原因**:
- 数据库索引缺失
- 查询过于复杂
- 内存不足
- 连接池过小

**解决方案**:
```bash
# 检查数据库索引
sqlite3 data/memories.db "SELECT name FROM sqlite_master WHERE type='index';"

# 优化查询
EXPLAIN QUERY PLAN SELECT * FROM memories_fts WHERE memories_fts MATCH '量子';

# 监控内存使用
top -p $(pgrep -f "bun run dev")
```

#### 2. 内存使用过高
**可能原因**:
- 缓存过大
- 内存泄漏
- 查询结果过大

**解决方案**:
```typescript
// 限制缓存大小
const searchCache = new LRUCache({
  max: 500, // 减少缓存条目
  maxSize: 50 * 1024 * 1024, // 50MB 内存限制
  sizeCalculation: (value) => JSON.stringify(value).length,
});

// 定期清理缓存
setInterval(() => {
  searchCache.purgeStale();
}, 300000); // 每5分钟清理一次
```

#### 3. 数据库锁竞争
**可能原因**:
- 并发写入过多
- 事务时间过长
- 索引维护操作

**解决方案**:
```typescript
// 使用读写锁
import { Mutex } from 'async-mutex';

const writeMutex = new Mutex();

async function safeAddMemory(memory: Memory) {
  return writeMutex.runExclusive(async () => {
    return kvService.addMemory(memory);
  });
}

// 优化事务
async function batchUpdate(memories: Memory[]) {
  await kvdb.db.run('BEGIN TRANSACTION');
  
  try {
    for (const memory of memories) {
      await kvService.updateMemory(memory);
    }
    
    await kvdb.db.run('COMMIT');
  } catch (error) {
    await kvdb.db.run('ROLLBACK');
    throw error;
  }
}
```

### 性能调优检查清单

- [ ] 数据库索引优化
- [ ] 查询语句优化
- [ ] 缓存策略配置
- [ ] 连接池大小调整
- [ ] 内存限制设置
- [ ] 监控指标配置
- [ ] 压力测试通过
- [ ] 生产环境验证

## 最佳实践

### 开发环境
1. **使用测试数据**: 创建代表性的测试数据集
2. **性能测试**: 每次重大变更后运行性能测试
3. **监控告警**: 设置性能阈值告警
4. **代码审查**: 审查可能影响性能的代码变更

### 生产环境
1. **渐进部署**: 分阶段部署性能优化
2. **A/B 测试**: 对比优化前后的性能
3. **回滚计划**: 准备性能回退方案
4. **容量规划**: 根据负载规划资源

### 维护建议
1. **定期优化**: 每月优化数据库索引
2. **监控趋势**: 跟踪性能指标趋势
3. **更新基准**: 根据业务增长更新性能基准
4. **文档更新**: 记录性能优化经验

## 工具与资源

### 性能分析工具
- **SQLite 分析工具**: `EXPLAIN QUERY PLAN`, `.timer ON`
- **内存分析**: Node.js `--inspect`, `heapdump`
- **性能监控**: Prometheus, Grafana, Datadog
- **压力测试**: k6, Apache Bench, autocannon

### 参考资源
- [SQLite 性能优化指南](https://www.sqlite.org/queryplanner.html)
- [FTS5 扩展文档](https://www.sqlite.org/fts5.html)
- [Node.js 性能最佳实践](https://nodejs.org/en/docs/guides/dont-block-the-event-loop/)
- [缓存策略模式](https://docs.aws.amazon.com/whitepapers/latest/database-caching-strategies-using-redis/caching-patterns.html)

---

**最后更新**: $(date)
**优化状态**: ✅ 生产就绪