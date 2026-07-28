# Hermes Multi-Agent Gateway

Multi-model routing + roundtable debate system.

## Architecture

```
User Request
    |
    v
+--------------------------------------+
|  Multi-Agent Gateway (:18088)        |
|  Express + LangGraph.js              |
+------------------+-------------------+
                   |
                   v
+--------------------------------------+
|  LangGraph Supervisor                |
|                                      |
|  [Router] -----> Classify task       |
|      |                               |
|      v                               |
|  [Agents] -----> Parallel analysis   |
|  (coding, research, finance,         |
|   document, general)                 |
|      |                               |
|      v (if debate mode)              |
|  [Debate] -----> Cross-debate R2+    |
|      |                               |
|      v                               |
|  [Critic] -----> Review quality      |
|      |                               |
|      v                               |
|  [Judge]  -----> Final answer        |
+------------------+-------------------+
                   |
                   v
+--------------------------------------+
|  LiteLLM (:4000)                     |
|  Model alias routing                 |
+------------------+-------------------+
                   |
       +-----------+-----------+
       v           v           v
   [Qwen]    [DeepSeek]    [Kimi] ...
```

**Node descriptions:**

- **Router** - Classify task type and complexity, select agents
- **Agents** - 5 specialist types, Round 1 runs in parallel
- **Debate** - Round 2+ sequential, agents see each other's views
- **Critic** - Review debate quality, find gaps
- **Judge** - Synthesize all rounds into final answer

> Router = 路由器 | Agents = 专业智能体 | Debate = 辩论轮次 | Critic = 批评家 | Judge = 裁判

## Flow

```
Simple task:
  Router --> 1 Agent --> Judge --> Response

Complex (no debate):
  Router --> N Agents (parallel) --> Critic --> Judge --> Response

Complex (debate mode):
  Router --> N Agents R1 (parallel, independent)
         --> Debate R2 (see each other, respond)
         --> Debate R3 (rebuttal, optional)
         --> Critic (review)
         --> Judge (synthesize)
         --> Response
```

> 简单任务: 路由器 - 1个智能体 - 裁判 - 返回
>
> 复杂任务(无辩论): 路由器 - 多个智能体并行 - 批评家 - 裁判 - 返回
>
> 复杂任务(辩论模式): 路由器 - 并行Round1 - 辩论Round2 - 反驳Round3 - 批评家 - 裁判 - 返回

## Model Aliases

| Alias | Purpose | Suggested Model |
|---|---|---|
| router-fast | Task routing | Qwen 3-30B-A3B (free) |
| general-fast | General Q&A | Qwen 3-30B-A3B (free) |
| coding-primary | Coding/Docker | Qwen 3.7-plus-cp |
| research-primary | Research/Search | Qwen 3.7 Max |
| finance-primary | Finance/Stock | DeepSeek V4 Pro |
| document-primary | Documents | Kimi K2.5 |
| critic-primary | Critique/Review | MiniMax M3 |
| judge-primary | Final synthesis | Qwen 3.7 Max TP |

Swap models by editing LiteLLM config.yaml only, no agent code changes needed.

> 换模型只改 LiteLLM config.yaml, 不改 Agent 代码。

---

## Quick Deploy (Docker Image)

### Prerequisites

- Docker installed
- LiteLLM running on port 4000
- PostgreSQL available

### Step 1: Create config directory

```bash
mkdir -p /usr/local/applications/hermes-multiagent-docker
```

### Step 2: Generate .env

```bash
DB_PASS=$(openssl rand -hex 16)
API_KEY=$(openssl rand -hex 32)

cat > /usr/local/applications/hermes-multiagent-docker/.env << EOF
PORT=18088
AGENT_API_KEY=$API_KEY
LITELLM_BASE_URL=http://YOUR_LITELLM_HOST:4000/v1
LITELLM_API_KEY=sk-your-litellm-key
MODEL_ROUTER=router-fast
MODEL_GENERAL=general-fast
MODEL_CODING=coding-primary
MODEL_RESEARCH=research-primary
MODEL_FINANCE=finance-primary
MODEL_DOCUMENT=document-primary
MODEL_CRITIC=critic-primary
MODEL_JUDGE=judge-primary
POSTGRES_HOST=YOUR_PG_HOST
POSTGRES_PORT=5432
POSTGRES_DB=multiagent
POSTGRES_USER=multiagent
POSTGRES_PASSWORD=$DB_PASS
DATABASE_URL=postgresql://multiagent:$DB_PASS@YOUR_PG_HOST:5432/multiagent
EOF
chmod 600 /usr/local/applications/hermes-multiagent-docker/.env
```

> **Important:** .env file must NOT contain comments or blank lines. Docker --env-file will fail on them.

### Step 3: Create database

```bash
docker exec -it litellm-db psql -U litellm -c "CREATE DATABASE multiagent;"
docker exec -it litellm-db psql -U litellm -c "CREATE USER multiagent WITH PASSWORD '$DB_PASS';"
docker exec -it litellm-db psql -U litellm -c "GRANT ALL PRIVILEGES ON DATABASE multiagent TO multiagent;"
```

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

### Step 5: Configure LiteLLM aliases

Add model aliases to LiteLLM config.yaml. See [CONFIG.md](./CONFIG.md) for details.

### Step 6: Verify

```bash
# Health check
curl http://localhost:18088/health

# Simple task
curl -s -X POST http://localhost:18088/invoke \
  -H "Content-Type: application/json" \
  -H "x-api-key: $(grep AGENT_API_KEY /usr/local/applications/hermes-multiagent-docker/.env | cut -d= -f2)" \
  -d '{"message": "Write a bash script to monitor disk usage"}'

# Debate task
curl -s -X POST http://localhost:18088/invoke \
  -H "Content-Type: application/json" \
  -H "x-api-key: $(grep AGENT_API_KEY /usr/local/applications/hermes-multiagent-docker/.env | cut -d= -f2)" \
  -d '{"message": "Analyze SATS (SGX: S58) for 6-month hold", "maxDebateRounds": 2}'
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

### POST /invoke

```bash
curl -X POST http://localhost:18088/invoke \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_KEY" \
  -d '{"message": "Your question", "maxDebateRounds": 2}'
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
| src/server.ts | Express API (health, invoke) |
| src/graph.ts | LangGraph state graph |
| src/router.ts | Router node |
| src/nodes.ts | Agent execution nodes |
| src/state.ts | State types |
| src/models.ts | LiteLLM model factory |
| src/schemas.ts | Zod validation |
| src/prompts.ts | System prompts |
| src/agents/factory.ts | Agent factory |
| src/agents/coding.ts | Coding agent |
| src/agents/research.ts | Research agent |
| src/agents/finance.ts | Finance agent |
| src/agents/document.ts | Document agent |
| src/agents/general.ts | General agent |
| src/agents/critic.ts | Critic agent |
| src/agents/judge.ts | Judge agent |

## Roadmap

- [ ] Phase 2: MCP tools (stock data, GitHub, search)
- [ ] Phase 3: Hermes MCP integration
- [ ] Phase 4: n8n scheduled triggers
- [ ] Phase 5: PostgreSQL checkpoint persistence

## Related Docs

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Architecture details
- [API.md](./API.md) - API reference
- [CONFIG.md](./CONFIG.md) - Configuration guide
