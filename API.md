# API Reference

## POST /invoke

Submit a task for multi-agent analysis.

### Headers

```
Content-Type: application/json
x-api-key: YOUR_AGENT_API_KEY
```

### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| message | string | Yes | The task or question |
| threadId | string | No | For tracking, auto-generated if omitted |
| maxDebateRounds | number | No | Max debate rounds (default: 2) |

### Response

| Field | Type | Description |
|---|---|---|
| threadId | string | Thread tracking ID |
| routing | object | Router decision |
| routing.primaryAgent | string | Main agent type |
| routing.selectedAgents | string[] | All agents involved |
| routing.complexity | string | simple / moderate / complex |
| routing.requiresMultiAgent | boolean | Multi-agent needed |
| routing.debateMode | boolean | Debate enabled |
| routing.reason | string | Why this routing was chosen |
| debate | object | Debate history |
| debate.rounds | number | Rounds completed |
| debate.history | object | Per-agent per-round outputs |
| agentResults | object | Final output from each agent |
| critique | string or null | Critic's review |
| finalAnswer | string or null | Judge's synthesis |
| errors | string[] | Error messages |
| revisionCount | number | Revision requests from critic |

### Examples

**Simple task:**

```bash
curl -X POST http://localhost:18088/invoke \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-key" \
  -d '{"message": "Write a bash script to backup files"}'
```

**Complex task with debate:**

```bash
curl -X POST http://localhost:18088/invoke \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-key" \
  -d '{
    "message": "Should I invest in SATS stock for 6 months?",
    "maxDebateRounds": 3
  }'
```

**Sample response:**

```json
{
  "threadId": "sats-debate-001",
  "routing": {
    "primaryAgent": "finance",
    "selectedAgents": ["finance", "research"],
    "complexity": "complex",
    "requiresMultiAgent": true,
    "debateMode": true,
    "reason": "Investment analysis needs multi-perspective debate"
  },
  "debate": {
    "rounds": 2,
    "history": {
      "finance": {
        "1": "Round 1: Fundamental analysis...",
        "2": "Round 2: Rebuttal to research agent..."
      },
      "research": {
        "1": "Round 1: Industry trend analysis...",
        "2": "Round 2: Response to finance agent..."
      }
    }
  },
  "critique": "Critic review: debate covered key angles...",
  "finalAnswer": "Judge synthesis: based on all rounds...",
  "errors": [],
  "revisionCount": 0
}
```

## GET /health

Health check endpoint.

### Response

```json
{
  "status": "ok",
  "timestamp": "2026-01-27T10:00:00.000Z"
}
```

## Error Responses

**401 Unauthorized:**

```json
{"error": "Invalid API key"}
```

**400 Bad Request:**

```json
{"error": "message is required"}
```

**500 Internal Server Error:**

```json
{"error": "Detailed error message"}
```
