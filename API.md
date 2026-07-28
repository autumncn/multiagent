# API 文档 / API Reference

## POST /invoke

提交任务进行多智能体分析。
Submit a task for multi-agent analysis.

### 请求头 / Headers
```
Content-Type: application/json
x-api-key: YOUR_AGENT_API_KEY
```

### 请求体 / Request Body
```json
{
  "message": "string (必需/required) - 任务或问题 / The task or question",
  "threadId": "string (可选/optional) - 用于追踪 / For tracking, auto-generated if omitted",
  "maxDebateRounds": "number (可选/optional, default: 2) - 最大辩论轮次 / Max debate rounds"
}
```

### 响应 / Response
```json
{
  "threadId": "string",
  "routing": {
    "primaryAgent": "string - 主要智能体类型 / Main agent type",
    "selectedAgents": ["array - 所有参与的智能体 / All agents involved"],
    "complexity": "simple | moderate | complex",
    "requiresMultiAgent": "boolean",
    "debateMode": "boolean",
    "reason": "string - 路由原因 / Why this routing was chosen"
  },
  "debate": {
    "rounds": "number - 完成的轮次数 / Rounds completed",
    "history": {
      "agent-name": {
        "1": "Round 1 输出 / output",
        "2": "Round 2 输出 / output"
      }
    }
  },
  "agentResults": {
    "agent-name": "每个智能体的最终输出 / Final output from each agent"
  },
  "critique": "string | null - 批评家的审查 / Critic's review",
  "finalAnswer": "string | null - 裁判的综合 / Judge's synthesis",
  "errors": ["array - 错误消息 / Error messages"],
  "revisionCount": "number - 批评家要求修改的次数 / Revision requests"
}
```

### 示例 / Examples

**简单任务 / Simple task:**
```bash
curl -X POST http://localhost:18088/invoke \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-key" \
  -d '{"message": "Write a bash script to backup files"}'
```

**复杂任务 (带辩论) / Complex task with debate:**
```bash
curl -X POST http://localhost:18088/invoke \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-key" \
  -d '{
    "message": "Should I invest in SATS stock for 6 months?",
    "maxDebateRounds": 3
  }'
```

## GET /health

健康检查端点。
Health check endpoint.

### 响应 / Response
```json
{
  "status": "ok",
  "timestamp": "2026-01-27T10:00:00.000Z"
}
```

## 错误响应 / Error Responses

**401 未授权 / Unauthorized**
```json
{"error": "Invalid API key"}
```

**400 错误请求 / Bad Request**
```json
{"error": "message is required"}
```

**500 内部服务器错误 / Internal Server Error**
```json
{"error": "Detailed error message"}
```
