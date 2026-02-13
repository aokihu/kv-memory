# Memory Decay 配置指南

本文档说明记忆衰退算法在 `src/libs/decay/config.ts` 中的配置项、默认值、热重载方式与调试方法。

## 1. 配置参数总览

算法主配置类型为 `DecayAlgorithmConfig`，按职责分组：

- `minScore` / `maxScore`: 全局分数边界
- `thresholds`: 状态分类阈值
- `timeDecay`: 时间衰退参数
- `usageBoost`: 使用频率提升参数
- `structureBoost`: 结构重要性提升参数
- `scheduler`: 调度器参数

默认配置（`DEFAULT_DECAY_ALGORITHM_CONFIG`）：

```json
{
  "minScore": 0,
  "maxScore": 100,
  "thresholds": {
    "activeMinScore": 70,
    "coldMinScore": 30
  },
  "timeDecay": {
    "minFactor": 0.95,
    "maxFactor": 1,
    "fullDecayHours": 720
  },
  "usageBoost": {
    "maxBoost": 10,
    "saturationAccessCount": 20
  },
  "structureBoost": {
    "maxBoost": 5,
    "saturationLinkCount": 10,
    "minLinkWeight": 0,
    "maxLinkWeight": 1
  },
  "scheduler": {
    "intervalMs": 900000,
    "batchSize": 100
  }
}
```

## 2. 时间衰减参数配置说明

`timeDecay` 用于控制分数随时间衰减的强度：

- `minFactor` (默认 `0.95`): 最低衰减因子，值越小衰减越快
- `maxFactor` (默认 `1`): 最高衰减因子，通常保持为 `1`
- `fullDecayHours` (默认 `720`): 衰减窗口（30 天）

建议：

- 高频更新业务：提高 `minFactor`（如 `0.97`）避免分数过快下降
- 冷数据清理导向：降低 `minFactor`（如 `0.9-0.94`）加快沉底

## 3. 使用频率提升参数配置说明

`usageBoost` 反映访问行为对分数的正向影响：

- `maxBoost` (默认 `10`): 使用行为可提供的最大提升
- `saturationAccessCount` (默认 `20`): 达到提升上限所需访问次数

建议：

- 访问分布离散时，降低 `saturationAccessCount` 可更快区分热点
- 防止热点记忆长期锁定高分时，降低 `maxBoost`

## 4. 结构重要性提升参数配置说明

`structureBoost` 基于链接规模与权重提升分数：

- `maxBoost` (默认 `5`): 结构贡献上限
- `saturationLinkCount` (默认 `10`): 链接数量达到上限的参考值
- `minLinkWeight` (默认 `0`): 最小链接权重
- `maxLinkWeight` (默认 `1`): 最大链接权重

建议：

- 链接噪声较高时，适当降低 `maxBoost`
- 链接质量稳定时，可提高 `saturationLinkCount` 避免小规模链接过拟合

## 5. 状态分类阈值配置说明

`thresholds` 决定分数到状态的映射边界：

- `activeMinScore` (默认 `70`)
- `coldMinScore` (默认 `30`)

默认分类：

- `active`: `[70, 100]`
- `cold`: `[30, 69]`
- `deprecated`: `[0, 29]`

约束：

- `coldMinScore` 必须小于等于 `activeMinScore`
- 阈值必须落在 `[minScore, maxScore]` 范围内

## 6. 调度器参数配置说明

`scheduler` 控制定时衰退任务：

- `intervalMs` (默认 `900000`): 调度间隔，默认 15 分钟
- `batchSize` (默认 `100`): 每批处理的记忆数量

建议：

- 数据规模大时，先降低 `batchSize` 观察数据库压力
- 低峰可缩短 `intervalMs`，高峰可拉长 `intervalMs`

## 7. 配置热重载使用方法

支持三种常用路径：

### 7.1 API 输入重载

```ts
import { reloadRuntimeDecayAlgorithmConfig } from "../src/libs/decay/config";

await reloadRuntimeDecayAlgorithmConfig(
  {
    timeDecay: { minFactor: 0.96 },
    scheduler: { intervalMs: 10 * 60 * 1000 }
  },
  "api"
);
```

### 7.2 从 JSON 文件重载

```ts
import { reloadRuntimeDecayConfigFromFile } from "../src/libs/decay/config";

await reloadRuntimeDecayConfigFromFile("./config/decay.json", "api");
```

### 7.3 文件监听自动热重载

```ts
import {
  startDecayConfigFileWatch,
  stopDecayConfigFileWatch,
  subscribeDecayConfigChanges,
} from "../src/libs/decay/config";

const unbind = subscribeDecayConfigChanges((event) => {
  if (event.type === "config_reload_failed") {
    console.error("decay config reload failed", event.error);
  }
});

startDecayConfigFileWatch("./config/decay.json");

// 需要停用监听时
stopDecayConfigFileWatch();
unbind();
```

## 8. 配置验证和调试技巧

### 8.1 启动前验证

使用 `validateDecayAlgorithmConfig` 在启动阶段做 fail-fast：

```ts
import {
  resolveDecayAlgorithmConfig,
  validateDecayAlgorithmConfig,
} from "../src/libs/decay/config";

const config = resolveDecayAlgorithmConfig(userInput);
const errors = validateDecayAlgorithmConfig(config);

if (errors.length > 0) {
  throw new Error(`Invalid decay config: ${errors.join("; ")}`);
}
```

### 8.2 运行时观测

- 订阅 `subscribeDecayConfigChanges` 追踪重载成功/失败
- 关注事件类型：`config_reloaded`、`config_reload_failed`
- 失败时优先检查 JSON 格式、数值范围、阈值顺序

### 8.3 异常定位优先级

1. `scheduler.intervalMs` / `scheduler.batchSize` 是否为正数
2. `timeDecay.minFactor <= timeDecay.maxFactor` 是否成立
3. `structureBoost.minLinkWeight <= structureBoost.maxLinkWeight` 是否成立
4. 阈值是否落在分数边界范围内

## 9. 常见配置场景示例

### 场景 A: 高频交互系统（保留热点）

```json
{
  "timeDecay": { "minFactor": 0.97, "fullDecayHours": 1080 },
  "usageBoost": { "maxBoost": 12, "saturationAccessCount": 15 },
  "scheduler": { "intervalMs": 600000, "batchSize": 100 }
}
```

适用：知识库助手、客服问答等高重复访问场景。

### 场景 B: 冷数据治理（加快沉底）

```json
{
  "timeDecay": { "minFactor": 0.92, "fullDecayHours": 360 },
  "usageBoost": { "maxBoost": 8, "saturationAccessCount": 25 },
  "thresholds": { "activeMinScore": 75, "coldMinScore": 40 }
}
```

适用：长期运行且历史记忆增长快的系统。

### 场景 C: 强关系图谱（重视结构）

```json
{
  "structureBoost": {
    "maxBoost": 8,
    "saturationLinkCount": 20,
    "minLinkWeight": 0,
    "maxLinkWeight": 1
  },
  "usageBoost": { "maxBoost": 8, "saturationAccessCount": 20 }
}
```

适用：依赖 links 组织知识上下文的记忆网络。

## 10. 最佳实践建议

- 每次只调整一个配置分组，并记录变更前后指标
- 在预发环境先执行 `resolve + validate + reload` 全流程演练
- 结合业务峰谷调节 `intervalMs` 和 `batchSize`，优先保证稳定性
- 通过事件订阅统一上报 `config_reload_failed`，避免静默失败
- 保留一份可回滚的稳定配置文件，并在发布流程中固定版本
