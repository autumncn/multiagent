# Architecture Details

## System Overview

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

**Node Descriptions:**

| Node | Role | Description |
|---|---|---|
| Router | Task classification | Classifies complexity, selects agents, decides debate mode |
| Agents | Specialist analysis | 5 types (coding, research, finance, document, general). Round 1 parallel. |
| Debate | Cross-debate | Only when debateMode=true. Round 2+ sequential rebuttal. |
| Critic | Quality review | Finds flaws, gaps, unchallenged claims |
| Judge | Final synthesis | Combines all rounds into coherent answer |

## Flow Patterns

### Simple Task

```
User --> Router --> 1 Agent --> Judge --> Response
```

Example: "Write a bash script to monitor disk usage"

### Complex Task (No Debate)

```
User --> Router --> N Agents (parallel) --> Critic --> Judge --> Response
```

Example: "Explain Docker networking"

### Complex Task (Debate Mode)

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

Example: "Should I hold SATS stock for 6 months?"

## Key Design Decisions

### 1. Model Aliases via LiteLLM

All agents use logical names (e.g. coding-primary, finance-primary). Actual model selection happens in LiteLLM config.

**Benefit:** Swap models without changing agent code.

```yaml
# Today
finance-primary: deepseek-v4-pro

# Tomorrow
finance-primary: kimi-k2.5
```

### 2. Debate Mode

When debateMode=true, agents see each other's outputs and respond in subsequent rounds.

**Benefit:** More thorough analysis for subjective questions (investments, trade-offs, strategic decisions).

### 3. Critic + Judge Separation

- **Critic:** Finds flaws, gaps, unchallenged claims
- **Judge:** Synthesizes all debate rounds into final answer

**Benefit:** Quality control + coherent output.

### 4. Router with Manual JSON Parsing

Router uses prompt-based JSON output with manual parsing (not withStructuredOutput).

**Reason:** Thinking-mode models (Qwen, etc.) do not support tool_choice: required parameter.

## State Management

LangGraph maintains state across the entire workflow:

| Field | Type | Description |
|---|---|---|
| userRequest | string | User input |
| threadId | string | Thread tracking ID |
| primaryAgent | string | Main agent type |
| selectedAgents | string[] | All selected agents |
| complexity | enum | simple, moderate, complex |
| requiresMultiAgent | boolean | Multi-agent needed |
| debateMode | boolean | Debate enabled |
| currentRound | number | Current debate round |
| maxRounds | number | Max debate rounds |
| agentResults | Record | Agent outputs (accumulated) |
| debateHistory | Record | Per-round debate outputs |
| critique | string or null | Critic review |
| needsRevision | boolean | Revision requested |
| finalAnswer | string or null | Judge synthesis |
| errors | string[] | Error messages |

## Extensibility

### Add New Agent Type

1. Create src/agents/newtype.ts
2. Add to agentConfigs in src/nodes.ts
3. Add model alias in LiteLLM config
4. Update RouterDecisionSchema in src/schemas.ts

### Add MCP Tools (Future)

```
Agent --> MCP Client --> Stock Data MCP --> Yahoo Finance API
                       --> News MCP --> NewsAPI
                       --> GitHub MCP --> GitHub API
```

### Add Checkpointing (Future)

Use @langchain/langgraph-checkpoint-postgres to persist state:

- Resume interrupted workflows
- Audit trail for all agent runs
- Paper trading portfolio tracking
