# API Reference

## Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Health check |
| `/invoke` | POST | Native API with SSE streaming |
| `/v1/chat/completions` | POST | OpenAI-compatible API |
| `/v1/models` | GET | List available models |

## Authentication

All endpoints (except `/health`) require API key:

**Native API:**
```
x-api-key: YOUR_AGENT_API_KEY
```

**OpenAI-compatible:**
```
Authorization: Bearer YOUR_AGENT_API_KEY
```

## POST /invoke

Native API with SSE streaming. Router dynamically generates experts based on task.

### Request

```bash
curl -N -X POST http://localhost:18088/invoke \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -H "x-api-key: YOUR_KEY" \
  -d '{
    "message": "Analyze NVDA for 6-month investment",
    "maxDebateRounds": 2
  }'
```

**Parameters:**
- `message` (required): User question
- `maxDebateRounds` (optional): Number of debate rounds (default: 2)

### Response (SSE Stream)

Real-time token output:

```
event: router
data: {"stage": "start"}

event: router
data: {"stage": "done", "experts": [
  {"role": "Valuation Expert", "model": "finance-heavy"},
  {"role": "Technical Analyst", "model": "finance-heavy"},
  {"role": "Risk Assessor", "model": "critical-heavy"}
]}

event: expert
data: {"role": "Valuation Expert", "round": 1, "stage": "start"}

event: token
data: {"role": "Valuation Expert", "round": 1, "token": "NVDA"}

event: token
data: {"role": "Valuation Expert", "round": 1, "token": " currently"}

event: expert
data: {"role": "Valuation Expert", "round": 1, "stage": "done"}

...

event: critic
data: {"stage": "start"}

event: token
data: {"stage": "critic", "token": "The analysis"}

event: judge
data: {"stage": "start"}

event: token
data: {"stage": "judge", "token": "**Final**"}

event: done
data: {
  "threadId": "thread-xxx",
  "finalAnswer": "...",
  "experts": [...],
  "debate": {"rounds": 2, "history": {...}},
  "elapsedMs": 45000
}
```

## POST /v1/chat/completions

OpenAI-compatible API. Use `multi-agent` or `multi-agent-debate` as model name.

### Non-streaming

```bash
curl -X POST http://localhost:18088/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_KEY" \
  -d '{
    "model": "multi-agent",
    "messages": [
      {"role": "user", "content": "What is 2+2?"}
    ]
  }'
```

**Response:**
```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "model": "multi-agent",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "**Final Answer:** 4\n\n**Reasoning:** Simple arithmetic..."
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 50,
    "total_tokens": 60
  }
}
```

### Streaming

```bash
curl -N -X POST http://localhost:18088/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_KEY" \
  -d '{
    "model": "multi-agent-debate",
    "stream": true,
    "messages": [
      {"role": "user", "content": "Should I buy SATS?"}
    ]
  }'
```

**Response (SSE):**
```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","model":"multi-agent-debate","choices":[{"index":0,"delta":{"role":"assistant","content":"**Final"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","model":"multi-agent-debate","choices":[{"index":0,"delta":{"content":" Answer"},"finish_reason":null}]}

...

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","model":"multi-agent-debate","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

## Models

### multi-agent

Router generates experts, runs in parallel, judge synthesizes. Fast (10-30s).

**Use for:**
- Simple Q&A
- Single-domain tasks
- Quick analysis

### multi-agent-debate

Router generates experts, runs debate rounds (2 by default), critic reviews, judge synthesizes. Thorough (1-3min).

**Use for:**
- Investment decisions
- Complex analysis
- Multi-perspective problems
- Trade-off evaluation

## GET /health

```bash
curl http://localhost:18088/health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-01-28T10:30:00Z"
}
```

## GET /v1/models

```bash
curl http://localhost:18088/v1/models \
  -H "Authorization: Bearer YOUR_KEY"
```

**Response:**
```json
{
  "object": "list",
  "data": [
    {
      "id": "multi-agent",
      "object": "model",
      "created": 1706438400,
      "owned_by": "hermes"
    },
    {
      "id": "multi-agent-debate",
      "object": "model",
      "created": 1706438400,
      "owned_by": "hermes"
    }
  ]
}
```

## Error Handling

### Invalid API Key

```json
{
  "error": {
    "message": "Invalid API key",
    "type": "invalid_request_error",
    "code": "invalid_api_key"
  }
}
```

### Missing Message

```json
{
  "error": {
    "message": "message field is required",
    "type": "invalid_request_error",
    "code": "missing_message"
  }
}
```

### Model Error

```json
{
  "error": {
    "message": "LiteLLM connection failed: timeout",
    "type": "model_error",
    "code": "model_unavailable"
  }
}
```

## Examples

### Simple Task

```bash
curl -N -X POST http://localhost:18088/invoke \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -H "x-api-key: YOUR_KEY" \
  -d '{"message": "Write a Python script to sort a CSV file"}'
```

Router generates: 1 Expert (Technical Expert) → Judge

### Investment Analysis

```bash
curl -N -X POST http://localhost:18088/invoke \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -H "x-api-key: YOUR_KEY" \
  -d '{
    "message": "Analyze NVDA for 6-month investment: valuation, technicals, risks",
    "maxDebateRounds": 2
  }'
```

Router generates: 3-4 Experts (Valuation, Technical, Risk, Industry) → Debate R2 → Critic → Judge

### Research Report

```bash
curl -N -X POST http://localhost:18088/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_KEY" \
  -d '{
    "model": "multi-agent",
    "stream": true,
    "messages": [
      {"role": "user", "content": "Compare LangGraph.js vs AutoGen for multi-agent orchestration"}
    ]
  }'
```

Router generates: 2 Experts (Framework Expert, Use Case Analyst) → Judge

### Via LiteLLM

```bash
# Through LiteLLM proxy
curl -N -X POST http://YOUR_LITELLM_HOST:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-master-key" \
  -d '{
    "model": "multi-agent-debate",
    "stream": true,
    "messages": [
      {"role": "user", "content": "Should I buy SATS (SGX: S58) for 6 months?"}
    ]
  }'
```
