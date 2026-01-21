# MEMORY_ALGORITHM

## Overview

本文档描述 Key–Value 记忆系统的**动态演化算法**，用于定义记忆如何随时间、使用行为和结构关系发生变化。

本文件只关注 **算法与规则**，不涉及：
- Agent 协作协议
- 代码结构或工程细节
- 存储实现（Keyv / Database）

其目标是提供一个 **可解释、可回放、可调参** 的记忆代谢模型。

---

## Design Principles

### 1. 行为驱动（Behavior-Driven）
记忆的价值只来源于真实行为：
- 被访问
- 被引用
- 被经过

### 2. 结构稳定（Structure-Aware）
记忆在网络中的位置（依赖关系）是长期信号。

### 3. 时间衰减（Time-Decay）
不使用的记忆会自然沉底，而不是突然消失。

### 4. 无人工打分
系统不允许人工设置“重要性”，所有分值均由算法派生。

---

## Memory Signals

记忆动态值只使用以下三类信号。

### Structural Signals

来自记忆网络结构：

- in_degree：有多少记忆依赖该节点
- out_degree：该节点解释了多少其他记忆

### Behavioral Signals

来自系统使用行为：

- access_count：被直接查询的累计次数
- traverse_count：作为 link 路径被经过的累计次数

### Temporal Signals

来自时间维度：

- created_at：创建时间
- last_accessed_at：最近一次直接访问
- last_linked_at：最近一次通过 link 访问

---

## Memory Score Definition

记忆动态值（memory_score）是一个连续数值，用于描述：

> 在当前时间点，该记忆仍然“参与系统认知活动”的程度。

它不是重要性判断，而是**活跃度刻画**。

---

## Scoring Formula

memory_score 的总体公式如下：

memory_score =
A * log(1 + in_degree)
+ B * log(1 + out_degree)
+ C * log(1 + access_count)
+ D * log(1 + traverse_count)
+ E * exp(-(now - last_accessed_at) / T_access)
+ F * exp(-(now - last_linked_at) / T_link)
- G * ((now - created_at) / T_age)

---

## Coefficient Guidelines

建议的初始参数（可根据项目调优）：

A = 1.0   // 被依赖程度  
B = 0.8   // 枢纽程度  
C = 1.2   // 直接使用  
D = 0.8   // 间接使用  
E = 1.5   // 近期访问  
F = 1.0   // 近期联想  
G = 0.3   // 年龄惩罚  

时间常数建议：

T_access = 24 hours  
T_link   = 72 hours  
T_age    = 30 days  

---

## Why log and exp

- log(1 + x)  
  防止高频访问导致分值无限增长，体现边际收益递减。

- exp(-Δt / T)  
  平滑表达“最近性”，避免硬阈值跳变。

---

## Lifecycle Mapping

memory_score 只决定**候选状态**，不直接执行删除。

### Active

memory_score ≥ θ_active  

- 参与默认搜索
- 可作为联想起点

### Cold

θ_delete < memory_score < θ_active  

- 不参与默认搜索
- 仅在显式查询或回溯中出现

### Eligible for Delete

memory_score ≤ θ_delete  
且：
- in_degree = 0
- 长期未访问

仅标记为删除候选，不立即删除。

---

## Merge Candidate Detection

当满足以下条件时，记忆可被标记为 merge_candidate：

- memory_score 长期偏低
- in_degree + out_degree 很小
- domain 与 type 相同
- 语义高度重叠（由系统或人工确认）

合并不会自动执行，只生成建议。

---

## Algorithm Tick

记忆代谢通过周期性任务执行（memory tick）。

典型流程：

1. 读取所有记忆节点的 meta
2. 计算 memory_score
3. 更新节点状态（active / cold）
4. 标记 merge_candidate
5. 标记 eligible_for_delete

Tick 周期建议：6h ~ 24h。

---

## Safety Rules

- memory_score 不可持久化存储
- 不允许 Agent 或模型直接修改 meta 统计字段
- 不允许算法自动执行不可逆操作
- 删除与合并必须可回滚或延迟执行

---

## Summary

本算法实现的是一种：

行为驱动  
结构感知  
时间衰减  
完全可解释  

的 **记忆代谢系统**。

它不会“学习”，但会自然地：
- 强化被使用的记忆
- 冷却未使用的记忆
- 提出合并与淘汰建议

这是工程系统中最稳定、最可控的一种记忆演化方式。
