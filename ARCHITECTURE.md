# 架构详解 / Architecture Details

## 系统概览 / System Overview

```
┌──────────────┐
│   用户/User   │
└──────┬───────┘
       │ HTTP POST /invoke
       ▼
┌──────────────────────────────────────┐
│  多智能体网关 / Multi-Agent Gateway   │
│  (端口/port 18088)                   │
│  Express + LangGraph.js              │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  LangGraph 调度器 / Supervisor        │
│                                      │
│  ┌─────────┐                         │
│  │ 路由器   │───► 判断任务类型         │
│  │ Router  │   (Route task)          │
│  └────┬────┘                         │
│       │                              │
│       ▼                              │
│  ┌─────────────────┐                 │
│  │ 专业智能体       │ Round 1: 并行    │
│  │ Specialist      │                 │
│  │ Agents          │                 │
│  │ - coding        │                 │
│  │ - research      │                 │
│  │ - finance       │                 │
│  │ - document      │                 │
│  │ - general       │                 │
│  └────┬────────────┘                 │
│       │                              │
│       ▼ (if debateMode/辩论模式)      │
│  ┌─────────────────┐                 │
│  │ 辩论轮次         │ Round 2+: 串行   │
│  │ Debate Rounds   │ 互相辩论/反驳     │
│  │ (see others)    │ (respond)       │
│  └────┬────────────┘                 │
│       │                              │
│       ▼                              │
│  ┌─────────┐                         │
│  │ 批评家   │───► 审查辩论质量          │
│  │ Critic  │   (Review quality)      │
│  └────┬────┘                         │
│       │                              │
│       ▼                              │
│  ┌─────────┐                         │
│  │  裁判    │───► 汇总最终答案          │
│  │  Judge  │   (Synthesize)          │
│  └─────────┘                         │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  LiteLLM (port 4000)                 │
│  模型别名路由 / Model alias routing    │
└──────────────┬───────────────────────┘
               │
    ┌──────────┼──────────┐
    ▼          ▼          ▼
┌────────┐ ┌────────┐ ┌────────┐
│ Qwen   │ │DeepSeek│ │  Kimi  │
│ 3.7    │ │  V4    │ │  K2.5  │
└────────┘ └────────┘ └────────┘
```

## 工作流程 / Flow Patterns

### 简单任务 / Simple Task
```
用户 → 路由器 → 1个智能体 → 裁判 → 响应
User → Router → 1 Agent → Judge → Response
```
示例: `"帮我写个 bash 脚本监控磁盘使用率"`
Example: `"Write a bash script to monitor disk usage"`

### 复杂任务（无辩论）/ Complex Task (No Debate)
```
用户 → 路由器 → 多个智能体（并行）→ 批评家 → 裁判 → 响应
User → Router → Multiple Agents (parallel) → Critic → Judge → Response
```
示例: `"解释 Docker 网络原理"`
Example: `"Explain Docker networking"`

### 复杂任务（辩论模式）/ Complex Task (Debate Mode)
```
用户 → 路由器 → 多个智能体 Round 1（并行，独立分析）
              → 辩论 Round 2（看到彼此观点，回应）
              → 辩论 Round 3（反驳，可选）
              → 批评家（审查辩论质量）
              → 裁判（汇总最终答案）
              → 响应

User → Router → Multiple Agents Round 1 (parallel, independent)
              → Debate Round 2 (see each other's views, respond)
              → Debate Round 3 (rebuttal, optional)
              → Critic (review debate quality)
              → Judge (synthesize final answer)
              → Response
```
示例: `"SATS 股票是否值得持有 6 个月？"`
Example: `"Should I hold SATS stock for 6 months?"`

## 关键设计决策 / Key Design Decisions

### 1. 通过 LiteLLM 使用模型别名 / Model Aliases via LiteLLM
所有智能体使用逻辑模型名称（如 `coding-primary`、`finance-primary`）。
实际模型选择在 LiteLLM 配置中进行。

**好处:** 无需修改智能体代码即可切换模型。
**Benefit:** Swap models without changing agent code.

```yaml
# 今天 / Today
finance-primary: deepseek-v4-pro

# 明天 / Tomorrow
finance-primary: kimi-k2.5
```

### 2. 辩论模式 / Debate Mode
当 `debateMode=true` 时，智能体不仅并行运行——它们会在后续轮次中看到彼此的输出并做出回应。

**好处:** 对主观问题（投资、权衡、战略决策）进行更深入的分析。
**Benefit:** More thorough analysis for subjective questions.

### 3. 批评家 + 裁判分离 / Critic + Judge Separation
- **批评家 / Critic:** 发现缺陷、漏洞、未经挑战的观点 / Find flaws, gaps, unchallenged claims
- **裁判 / Judge:** 将所有辩论轮次综合为最终答案 / Synthesize all debate rounds

**好处:** 质量控制 + 连贯的输出。
**Benefit:** Quality control + coherent output.

### 4. 路由器使用结构化输出 / Router with Structured Output
路由器使用 Zod schema 保证有效的 JSON / Router uses Zod schema for valid JSON:
```typescript
{
  primaryAgent: "finance",
  secondaryAgents: ["research"],
  complexity: "complex",
  requiresMultiAgent: true,
  debateMode: true,
  reason: "..."
}
```

**好处:** 无解析失败，可预测的路由。
**Benefit:** No parsing failures, predictable routing.

## 状态管理 / State Management

LangGraph 在整个工作流程中维护状态 / LangGraph maintains state across workflow:

```typescript
{
  userRequest: string,           // 用户请求 / User request
  threadId: string,              // 线程ID / Thread ID

  primaryAgent: string,          // 主要智能体 / Primary agent
  selectedAgents: string[],      // 选中的智能体 / Selected agents
  complexity: "simple" | "moderate" | "complex",
  requiresMultiAgent: boolean,   // 是否需要多智能体 / Multi-agent needed
  debateMode: boolean,           // 辩论模式 / Debate mode

  currentRound: number,          // 当前轮次 / Current round
  maxRounds: number,             // 最大轮次 / Max rounds

  agentResults: Record<string, string>,
  debateHistory: Record<string, Record<number, string>>,

  critique: string | null,       // 批评意见 / Critique
  needsRevision: boolean,        // 是否需要修改 / Needs revision

  finalAnswer: string | null,    // 最终答案 / Final answer
  errors: string[],              // 错误列表 / Errors
}
```

## 扩展性 / Extensibility

### 添加新的智能体类型 / Add New Agent Type
1. 创建 / Create `src/agents/newtype.ts`
2. 添加到 / Add to `agentConfigs` in `src/nodes.ts`
3. 在 LiteLLM 配置中添加模型别名 / Add model alias in LiteLLM config
4. 更新 / Update `RouterDecisionSchema` in `src/schemas.ts`

### 添加 MCP 工具（未来）/ Add MCP Tools (Future)
```
Agent → MCP Client → Stock Data MCP → Yahoo Finance API
                     → News MCP → NewsAPI
                     → GitHub MCP → GitHub API
```

### 添加检查点（未来）/ Add Checkpointing (Future)
使用 `@langchain/langgraph-checkpoint-postgres` 持久化状态:
- 恢复中断的工作流 / Resume interrupted workflows
- 所有智能体运行的审计跟踪 / Audit trail for all agent runs
- 模拟交易投资组合跟踪 / Paper trading portfolio tracking
