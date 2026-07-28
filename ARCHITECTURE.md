# Architecture Details / 架构详解

## System Overview / 系统概览

```
                    +-----------+
                    |   User    |
                    +-----+-----+
                          |
                          | POST /invoke
                          v
+--------------------------------------------------+
|  Multi-Agent Gateway (:18088)                    |
|  Express + LangGraph.js                          |
+--------------------------------------------------+
                          |
                          v
+--------------------------------------------------+
|  LangGraph Supervisor                            |
|                                                  |
|  +----------+                                    |
|  | Router   | ----> Classify task type           |
|  +----------+                                    |
|       |                                          |
|       v                                          |
|  +----------+                                    |
|  | Agents   | ----> Parallel independent         |
|  | (5 types)|       analysis per agent           |
|  +----------+                                    |
|       |                                          |
|       v (debate mode only)                       |
|  +----------+                                    |
|  | Debate   | ----> Sequential rounds            |
|  | Rounds   |       agents see each other        |
|  +----------+                                    |
|       |                                          |
|       v                                          |
|  +----------+                                    |
|  | Critic   | ----> Find flaws, gaps             |
|  +----------+                                    |
|       |                                          |
|       v                                          |
|  +----------+                                    |
|  | Judge    | ----> Synthesize final answer      |
|  +----------+                                    |
+----------------------+---------------------------+
                       |
                       v
+--------------------------------------------------+
|  LiteLLM (:4000)                                 |
|  Unified model routing via aliases               |
+----------------------+---------------------------+
                       |
          +------------+------------+
          v            v            v
      [Qwen]     [DeepSeek]     [Kimi] ...
```

> **Node Descriptions / 节点说明:**
> - **Router / 路由器:** Classifies task complexity, selects agents, decides debate mode
> - **Agents / 智能体:** 5 specialist types (coding, research, finance, document, general). Round 1 runs in parallel with independent analysis.
> - **Debate Rounds / 辩论轮次:** Only when `debateMode=true`. Round 2+ runs sequentially — each agent sees all previous outputs and responds/rebuts.
> - **Critic / 批评家:** Reviews debate quality, finds unchallenged claims, identifies gaps.
> - **Judge / 裁判:** Synthesizes all debate rounds into a coherent final answer.

## Flow Patterns / 工作流程

### Simple Task / 简单任务

```
User --> Router --> 1 Agent --> Judge --> Response
```

> Example: "Write a bash script to monitor disk usage"
> 示例: "帮我写个 bash 脚本监控磁盘使用率"

### Complex Task (No Debate) / 复杂任务（无辩论）

```
User --> Router --> N Agents (parallel) --> Critic --> Judge --> Response
```

> Example: "Explain Docker networking"
> 示例: "解释 Docker 网络原理"

### Complex Task (Debate Mode) / 复杂任务（辩论模式）

```
User --> Router
         |
         v
    Round 1: N Agents (parallel, independent)
         |
         v
    Round 2: Agents see R1 outputs, respond (sequential)
         |
         v
    Round 3: Rebuttal (optional, sequential)
         |
         v
    Critic: Review debate quality
         |
         v
    Judge: Synthesize final answer
         |
         v
    Response
```

> Example: "Should I hold SATS stock for 6 months?"
> 示例: "SATS 股票是否值得持有 6 个月？"

## Key Design Decisions / 关键设计决策

### 1. Model Aliases via LiteLLM

All agents use logical names (e.g., `coding-primary`, `finance-primary`).
Actual model selection happens in LiteLLM config.

> **Benefit / 好处:** Swap models without changing agent code.
> 换模型无需改 Agent 代码。

```yaml
# Today / 今天
finance-primary: deepseek-v4-pro

# Tomorrow / 明天
finance-primary: kimi-k2.5
```

### 2. Debate Mode

When `debateMode=true`, agents see each other's outputs and respond in subsequent rounds.

> **Benefit / 好处:** More thorough analysis for subjective questions (investments, trade-offs, strategic decisions).
> 对主观问题（投资、权衡、战略决策）进行更深入的分析。

### 3. Critic + Judge Separation

- **Critic / 批评家:** Finds flaws, gaps, unchallenged claims
- **Judge / 裁判:** Synthesizes all debate rounds into final answer

> **Benefit / 好处:** Quality control + coherent output.
> 质量控制 + 连贯的输出。

### 4. Router with Manual JSON Parsing

Router uses prompt-based JSON output with manual parsing (not `withStructuredOutput`).

> **Reason / 原因:** Thinking-mode models (Qwen, etc.) do not support `tool_choice: required` parameter.
> Thinking 模式模型不支持 `tool_choice: required` 参数。

## State Management / 状态管理

LangGraph maintains state across the entire workflow:

```typescript
{
  // Input
  userRequest: string,
  threadId: string,

  // Router output
  primaryAgent: string,
  selectedAgents: string[],
  complexity: "simple" | "moderate" | "complex",
  requiresMultiAgent: boolean,
  debateMode: boolean,

  // Debate control
  currentRound: number,
  maxRounds: number,

  // Agent outputs (accumulated)
  agentResults: Record<string, string>,
  debateHistory: Record<string, Record<number, string>>,

  // Critic output
  critique: string | null,
  needsRevision: boolean,

  // Final
  finalAnswer: string | null,
  errors: string[],
}
```

## Extensibility / 扩展性

### Add New Agent Type

1. Create `src/agents/newtype.ts`
2. Add to `agentConfigs` in `src/nodes.ts`
3. Add model alias in LiteLLM config
4. Update `RouterDecisionSchema` in `src/schemas.ts`

### Add MCP Tools (Future)

```
Agent --> MCP Client --> Stock Data MCP --> Yahoo Finance API
                       --> News MCP --> NewsAPI
                       --> GitHub MCP --> GitHub API
```

### Add Checkpointing (Future)

Use `@langchain/langgraph-checkpoint-postgres` to persist state:
- Resume interrupted workflows / 恢复中断的工作流
- Audit trail for all agent runs / 所有智能体运行的审计跟踪
- Paper trading portfolio tracking / 模拟交易投资组合跟踪
