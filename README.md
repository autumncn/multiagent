# Hermes Multi-Agent Gateway

Dynamic Multi-Agent Orchestrator with LangGraph, SSE streaming, and capability-based model routing.

## Architecture

```
User Request
    |
    v
+--------------------------------------+
|  Multi-Agent Gateway (:18088)        |
|  Express + LangGraph.js + SSE        |
+------------------+-------------------+
                   |
                   v
+--------------------------------------+
|  LangGraph Dynamic Orchestrator      |
|                                      |
|  [Router] -----> Generate experts    |
|      |          (dynamic roles)      |
|      v                               |
|  [Registry] --> Match models by      |
|      |          capability needs     |
|      v                               |
|  [Experts] ----> Parallel analysis   |
|      |          (dynamic count)      |
|      v (if debate mode)              |
|  [Debate] -----> Cross-debate R2+    |
|      v                               |
|  [Critic] -----> Review quality      |
|      v                               |
|  [Judge]  -----> Final answer        |
+------------------+-------------------+
                   |
                   v
+--------------------------------------+
|  LiteLLM (:4000)                     |
|  Capability-based alias routing      |
+------------------+-------------------+
                   |
       +-----------+-----------+
       v           v           v
   [Qwen]    [DeepSeek]    [Kimi] ...
```

**Key Features:**

- **Dynamic Experts** - Router generates any number of expert roles (1-5) based on task
- **Capability Matching** - registry.yaml maps model aliases to capabilities
- **SSE Streaming** - Real-time token output for all stages
- **Debate Mode** - Optional multi-round cross-debate between experts
- **OpenAI Compatible** - `/v1/chat/completions` API for direct integration

> Router = 动态生成专家 | Registry = 能力匹配 | Experts = 动态角色 | Debate = 辩论轮次 | Critic = 批评家 | Judge = 裁判

## Flow

```
Simple task:
  Router --> 1 Expert --> Judge --> Response

Complex (no debate):
  Router --> N Experts (parallel) --> Critic --> Judge --> Response

Complex (debate mode):
  Router --> N Experts R1 (parallel, independent)
         --> Debate R2 (see each other, respond)
         --> Debate R3 (rebuttal, optional)
         --> Critic (review)
         --> Judge (synthesize)
         --> Response
```

**Example: "Analyze NVDA for 6-month hold"**

```
Router generates:
  - Valuation Expert (needs: finance, valuation)
  - Technical Analyst (needs: finance, technical_analysis)
  - Risk Assessor (needs: risk, criticism)
  - Industry Researcher (needs: research, industry)

Registry matches:
  - finance-heavy → Kimi K2.5
  - research-heavy → Qwen 3.7 Max
  - critical-heavy → DeepSeek V4 Pro

All 4 experts run in parallel (Round 1), then debate (Round 2),
critic reviews, judge synthesizes final recommendation.
```

> 简单任务: 路由器生成1个专家 → 裁判 → 返回
>
> 复杂任务(无辩论): 路由器生成多个专家并行 → 批评家 → 裁判 → 返回
>
> 复杂任务(辩论模式): 路由器生成专家 → 并行Round1 → 辩论Round2 → 反驳Round3 → 批评家 → 裁判 → 返回

## LiteLLM Aliases (Capability-Based)

| Alias | Type | Purpose | Model | Tier |
|---|---|---|---|---|
| `router-fast` | 固定节点 | Router 决策 | qwen3.6-plus-cp | fast |
| `judge-primary` | 固定节点 | 最终裁决 | qwen3.7-max-tp | best |
| `critic-primary` | 固定节点 | 质量审查 | deepseek-v4-pro-tp | strong |
| `general-fast` | 动态专家 | 简单任务 fallback | qwen3.6-plus-cp | fast |
| `reasoning-heavy` | 动态专家 | 复杂逻辑推理 | qwen3.7-max-tp | best |
| `reasoning-light` | 动态专家 | 简单逻辑计算 | qwen3.6-plus-cp | fast |
| `technical-heavy` | 动态专家 | 代码/DevOps | qwen3.7-plus-cp | mid |
| `technical-light` | 动态专家 | 简单脚本 | qwen3.6-plus-cp | fast |
| `finance-heavy` | 动态专家 | 金融分析 | deepseek-v4-pro-tp | strong |
| `research-heavy` | 动态专家 | 深度研究 | qwen3.7-max-tp | best |
| `creative-heavy` | 动态专家 | 长文写作 | qwen3.7-max-tp | best |
| `creative-light` | 动态专家 | 简短写作 | qwen3.6-plus-cp | fast |

Swap models by editing LiteLLM UI only. Registry.yaml defines capability mapping.

> 换模型只改 LiteLLM UI, registry.yaml 定义能力映射, 不改 Agent 代码。

## Capability Matching

`src/registry.yaml` defines what each alias is good at:

```yaml
aliases:
  finance-heavy:
    capabilities: [finance, valuation, quant, market, portfolio]
    description: "Best model for financial analysis"

  research-heavy:
    capabilities: [research, long_context, report, analysis]
    description: "Best model for deep research"
```

Router generates experts with capability needs:

```json
{
  "experts": [
    {
      "role": "Valuation Expert",
      "needs": ["finance", "valuation"],
      "task": "Analyze NVDA PE/PB ratio, DCF model"
    }
  ]
}
```

Registry matches `["finance", "valuation"]` → `finance-heavy` → Kimi K2.5

---

## Quick Deploy (Docker Image)

### Prerequisites

- Docker installed
- LiteLLM running on port 4000 with aliases configured
- PostgreSQL available (optional, for checkpoint persistence)

### Step 1: Create config directory

```bash
mkdir -p /usr/local/applications/hermes-multiagent-docker
```

### Step 2: Generate .env

```bash
API_KEY=$(openssl rand -hex 32)

cat > /usr/local/applications/hermes-multiagent-docker/.env << EOF
PORT=18088
AGENT_API_KEY=$API_KEY
LITELLM_BASE_URL=http://YOUR_LITELLM_HOST:4000/v1
LITELLM_API_KEY=sk-your-litellm-key
EOF
chmod 600 /usr/local/applications/hermes-multiagent-docker/.env
```

> **Important:** .env file must NOT contain comments or blank lines. Docker --env-file will fail on them.

### Step 3: Configure LiteLLM aliases

In LiteLLM UI, add these model aliases (Model Name → Model ID):

**Fixed nodes (used by specific components):**
| Alias (Model Name) | Underlying Model |
|---|---|
| `router-fast` | `qwen3.6-plus-cp` (fast) |
| `judge-primary` | `qwen3.7-max-tp` (best) |
| `critic-primary` | `deepseek-v4-pro-tp` (strong) |

**Dynamic experts (matched by capability):**
| Alias (Model Name) | Underlying Model |
|---|---|
| `general-fast` | `qwen3.6-plus-cp` (fast) |
| `reasoning-heavy` | `qwen3.7-max-tp` (best) |
| `reasoning-light` | `qwen3.6-plus-cp` (fast) |
| `technical-heavy` | `qwen3.7-plus-cp` (coding) |
| `technical-light` | `qwen3.6-plus-cp` (fast) |
| `finance-heavy` | `deepseek-v4-pro-tp` (strong) |
| `research-heavy` | `qwen3.7-max-tp` (best) |
| `creative-heavy` | `qwen3.7-max-tp` (best) |
| `creative-light` | `qwen3.6-plus-cp` (fast) |

See [CONFIG.md](./CONFIG.md) for details.

### Step 4: Pull and run

```bash
docker pull dimages.ctimware.com/hermes-multiagent:latest

docker run -d \
  --name hermes-multiagent \
  --restart unless-stopped \
  -p 127.0.0.1:18088:18088 \
  --env-file /usr/local/applications/hermes-multiagent-docker/.env \
  --add-host=host.docker.internal:host-gateway \
  dimages.ctimware.com/hermes-multiagent:latest
```

### Step 5: Verify

```bash
# Health check
curl http://localhost:18088/health

# Simple task (Router generates 1 expert)
curl -N -X POST http://localhost:18088/invoke \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -H "x-api-key: $(grep AGENT_API_KEY /usr/local/applications/hermes-multiagent-docker/.env | cut -d= -f2)" \
  -d '{"message": "Write a bash script to monitor disk usage"}'

# Debate task (Router generates multiple experts + debate)
curl -N -X POST http://localhost:18088/invoke \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -H "x-api-key: $(grep AGENT_API_KEY /usr/local/applications/hermes-multiagent-docker/.env | cut -d= -f2)" \
  -d '{"message": "Analyze NVDA for 6-month investment: valuation, technicals, risks", "maxDebateRounds": 2}'

# OpenAI-compatible API
curl -N -X POST http://localhost:18088/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(grep AGENT_API_KEY /usr/local/applications/hermes-multiagent-docker/.env | cut -d= -f2)" \
  -d '{
    "model": "multi-agent-debate",
    "stream": true,
    "messages": [{"role": "user", "content": "Should I buy SATS (SGX: S58)?"}]
  }'
```

---

## Update Deployment

```bash
docker pull dimages.ctimware.com/hermes-multiagent:latest
docker stop hermes-multiagent && docker rm hermes-multiagent
docker run -d \
  --name hermes-multiagent \
  --restart unless-stopped \
  -p 127.0.0.1:18088:18088 \
  --env-file /usr/local/applications/hermes-multiagent-docker/.env \
  --add-host=host.docker.internal:host-gateway \
  dimages.ctimware.com/hermes-multiagent:latest
```

---

## Build from Source

```bash
cd /usr/local/applications
git clone https://github.com/autumncn/multiagent.git hermes-multiagent
cd hermes-multiagent
docker build -t hermes-multiagent:local .
docker run -d \
  --name hermes-multiagent \
  --restart unless-stopped \
  -p 127.0.0.1:18088:18088 \
  --env-file /usr/local/applications/hermes-multiagent-docker/.env \
  --add-host=host.docker.internal:host-gateway \
  hermes-multiagent:local
```

### Build and push to registry

```bash
cd /usr/local/applications/hermes-multiagent
VERSION=$(date +%Y%m%d)
docker build -t hermes-multiagent:$VERSION .
docker tag hermes-multiagent:$VERSION dimages.ctimware.com/hermes-multiagent:$VERSION
docker tag hermes-multiagent:$VERSION dimages.ctimware.com/hermes-multiagent:latest
docker push dimages.ctimware.com/hermes-multiagent:$VERSION
docker push dimages.ctimware.com/hermes-multiagent:latest
```

---

## API Reference

See [API.md](./API.md) for full details.

### POST /invoke (Native API)

```bash
curl -N -X POST http://localhost:18088/invoke \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -H "x-api-key: YOUR_KEY" \
  -d '{"message": "Your question", "maxDebateRounds": 2}'
```

### POST /v1/chat/completions (OpenAI Compatible)

```bash
curl -N -X POST http://localhost:18088/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_KEY" \
  -d '{
    "model": "multi-agent-debate",
    "stream": true,
    "messages": [{"role": "user", "content": "Your question"}]
  }'
```

### GET /health

```bash
curl http://localhost:18088/health
```

---

## Project Structure

| Path | Description |
|---|---|
| Dockerfile | Two-stage build |
| .env.example | Env template |
| package.json | Node.js deps |
| tsconfig.json | TypeScript config |
| src/registry.yaml | Capability registry |
| src/server.ts | Express API (health, invoke, /v1/chat/completions) |
| src/graph.ts | LangGraph dynamic orchestrator |
| src/nodes.ts | Router, Experts, Debate, Critic, Judge nodes |
| src/state.ts | State types (experts, modelMapping, etc.) |
| src/models.ts | LiteLLM model factory (stream/invoke) |
| src/schemas.ts | Zod validation (Expert, RouterDecision) |
| src/prompts.ts | Dynamic prompt generation |
| src/registry.ts | Capability matching logic |
| src/streaming.ts | SSE writer registry + token events |

## Roadmap

- [x] Phase 1: Dynamic Multi-Agent Orchestrator with SSE streaming
- [ ] Phase 2: MCP tools (stock data, GitHub, search)
- [ ] Phase 3: Hermes MCP integration
- [ ] Phase 4: n8n scheduled triggers
- [ ] Phase 5: PostgreSQL checkpoint persistence

## Related Docs

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Architecture details
- [API.md](./API.md) - API reference
- [CONFIG.md](./CONFIG.md) - Configuration guide
