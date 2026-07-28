# Hermes Multi-Agent Gateway

多模型路由 + 圆桌辩论系统。/ Multi-model routing + roundtable debate system.

## 架构 / Architecture

```
用户请求 → Hermes
              ↓ POST /invoke
        Multi-Agent Gateway (:18088)
              ↓
        LangGraph Supervisor
          ├── Router (router-fast)        → 判断任务类型 / Route task
          ├── Specialist Agents (并行)     → 各抒己见 Round 1 / Independent analysis
          ├── Debate Rounds (串行)         → 互相辩论 Round 2+ / Cross-debate
          ├── Critic (critic-primary)     → 审查辩论质量 / Review quality
          └── Judge (judge-primary)       → 汇总最终答案 / Synthesize answer
              ↓
           LiteLLM (:4000)
              ↓
        各实际模型 / Actual models (Qwen/DeepSeek/Kimi/MiniMax/GLM)
```

## 流程 / Flow

```
简单任务 / Simple task:
  Router → 1个 Agent → Judge → 返回

复杂任务 (无辩论) / Complex task (no debate):
  Router → 多个 Agent 并行 → Critic → Judge → 返回

复杂任务 (辩论模式) / Complex task (debate mode):
  Router → 多个 Agent 并行 (Round 1)
         → 互相看到对方观点, 辩论 (Round 2)
         → 互相反驳 (Round 3, 可选)
         → Critic 审查
         → Judge 汇总
         → 返回
```

## 模型别名 / Model Aliases

| 别名 / Alias | 用途 / Purpose | 建议模型 / Suggested Model |
|---|---|---|
| router-fast | 路由判断 / Routing | Qwen 3-30B-A3B (free) |
| general-fast | 通用问答 / General Q&A | Qwen 3-30B-A3B (free) |
| coding-primary | 编程/Docker / Coding | Qwen 3.7-plus-cp |
| research-primary | 搜索/调研 / Research | Qwen 3.7 Max |
| finance-primary | 金融/股票 / Finance | DeepSeek V4 Pro |
| document-primary | 文档处理 / Documents | Kimi K2.5 |
| critic-primary | 审查/找问题 / Critique | MiniMax M3 |
| judge-primary | 最终汇总 / Judge | Qwen 3.7 Max TP |

换模型只改 LiteLLM config.yaml，不改 Agent 代码。
Swap models by editing LiteLLM config.yaml only — no agent code changes needed.

---

## 快速部署 (Docker 镜像) / Quick Deploy (Docker Image)

预构建镜像，直接拉取运行。/ Pre-built image, pull and run.

### 前提条件 / Prerequisites

- Docker 已安装 / Docker installed
- LiteLLM 已运行在 `:4000` / LiteLLM running on `:4000`
- PostgreSQL 可用 / PostgreSQL available

### Step 1: 创建配置目录 / Create config directory

```bash
mkdir -p /usr/local/applications/hermes-multiagent-docker
```

### Step 2: 生成 .env / Generate .env

```bash
DB_PASS=$(openssl rand -hex 16)
API_KEY=$(openssl rand -hex 32)

cat > /usr/local/applications/hermes-multiagent-docker/.env << EOF
PORT=18088
AGENT_API_KEY=$API_KEY
LITELLM_BASE_URL=http://192.168.31.51:4000/v1
LITELLM_API_KEY=sk-your-litellm-key
MODEL_ROUTER=router-fast
MODEL_GENERAL=general-fast
MODEL_CODING=coding-primary
MODEL_RESEARCH=research-primary
MODEL_FINANCE=finance-primary
MODEL_DOCUMENT=document-primary
MODEL_CRITIC=critic-primary
MODEL_JUDGE=judge-primary
POSTGRES_HOST=192.168.31.51
POSTGRES_PORT=5432
POSTGRES_DB=multiagent
POSTGRES_USER=multiagent
POSTGRES_PASSWORD=$DB_PASS
DATABASE_URL=postgresql://multiagent:$DB_PASS@192.168.31.51:5432/multiagent
EOF
chmod 600 /usr/local/applications/hermes-multiagent-docker/.env

echo "API_KEY: $API_KEY"
echo "DB_PASS: $DB_PASS"
```

### Step 3: 创建数据库 / Create database

```bash
docker exec -it litellm-db psql -U litellm -c "CREATE DATABASE multiagent;"
docker exec -it litellm-db psql -U litellm -c "CREATE USER multiagent WITH PASSWORD '$DB_PASS';"
docker exec -it litellm-db psql -U litellm -c "GRANT ALL PRIVILEGES ON DATABASE multiagent TO multiagent;"
```

注意: 把 `$DB_PASS` 替换为你在 Step 2 中生成的密码。
Note: Replace `$DB_PASS` with the password generated in Step 2.

### Step 4: 拉取镜像并运行 / Pull image and run

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

### Step 5: 配置 LiteLLM 模型别名 / Configure LiteLLM model aliases

在 LiteLLM 的 `config.yaml` 的 `model_list` 中添加:
Add to `model_list` in LiteLLM's `config.yaml`:

```yaml
  - model_name: router-fast
    litellm_params:
      model: openrouter/qwen/qwen-3-30b-a3b:free
      api_key: os.environ/OPENROUTER_API_KEY

  - model_name: general-fast
    litellm_params:
      model: openrouter/qwen/qwen-3-30b-a3b:free
      api_key: os.environ/OPENROUTER_API_KEY

  - model_name: coding-primary
    litellm_params:
      model: dashscope/qwen3.7-plus-cp
      api_key: os.environ/DASHSCOPE_API_KEY

  - model_name: research-primary
    litellm_params:
      model: dashscope/qwen3.7-max
      api_key: os.environ/DASHSCOPE_API_KEY

  - model_name: finance-primary
    litellm_params:
      model: deepseek/deepseek-chat
      api_key: os.environ/DEEPSEEK_API_KEY

  - model_name: document-primary
    litellm_params:
      model: openrouter/moonshotai/kimi-k2.5
      api_key: os.environ/OPENROUTER_API_KEY

  - model_name: critic-primary
    litellm_params:
      model: openrouter/minimax/minimax-m3
      api_key: os.environ/OPENROUTER_API_KEY

  - model_name: judge-primary
    litellm_params:
      model: dashscope/qwen3.7-max-tp
      api_key: os.environ/DASHSCOPE_API_KEY
```

根据你的 LiteLLM 已有配置格式调整 model/api_key/api_base。
Adjust model/api_key/api_base to match your existing LiteLLM provider setup.

### Step 6: 验证 / Verify

```bash
# 健康检查 / Health check
curl http://localhost:18088/health

# 简单任务 / Simple task
curl -s -X POST http://localhost:18088/invoke \
  -H "Content-Type: application/json" \
  -H "x-api-key: $(grep AGENT_API_KEY /usr/local/applications/hermes-multiagent-docker/.env | cut -d= -f2)" \
  -d '{"message": "写一个 bash 脚本监控磁盘使用率"}' | python3 -m json.tool

# 辩论任务 / Debate task
curl -s -X POST http://localhost:18088/invoke \
  -H "Content-Type: application/json" \
  -H "x-api-key: $(grep AGENT_API_KEY /usr/local/applications/hermes-multiagent-docker/.env | cut -d= -f2)" \
  -d '{
    "message": "分析 SATS (新翔集团 SGX: S58) 是否值得持有6个月",
    "threadId": "sats-debate-001",
    "maxDebateRounds": 2
  }' | python3 -m json.tool
```

---

## 更新部署 / Update Deployment

```bash
# 拉取新版本 / Pull new version
docker pull dimages.ctimware.com/hermes-multiagent:latest

# 停旧启新 / Stop old, start new
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

## 从源码构建 / Build from Source

如果需要使用本地修改或自定义版本:
For local modifications or custom builds:

```bash
# 克隆 / Clone
cd /usr/local/applications
git clone https://github.com/autumncn/multiagent.git hermes-multiagent
cd hermes-multiagent

# 构建 / Build
docker build -t hermes-multiagent:local .

# 运行 / Run
docker run -d \
  --name hermes-multiagent \
  --restart unless-stopped \
  -p 127.0.0.1:18088:18088 \
  --env-file /usr/local/applications/hermes-multiagent-docker/.env \
  --add-host=host.docker.internal:host-gateway \
  hermes-multiagent:local
```

### 构建并推送镜像 / Build and push image

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

## API 说明 / API Reference

### POST /invoke

**Headers:**
- `Content-Type: application/json`
- `x-api-key: YOUR_AGENT_API_KEY`

**Body:**
```json
{
  "message": "你的问题 / Your question",
  "threadId": "可选, 用于追踪 / Optional, for tracking",
  "maxDebateRounds": 2
}
```

**Response:**
```json
{
  "threadId": "xxx",
  "routing": {
    "primaryAgent": "finance",
    "selectedAgents": ["finance", "research"],
    "complexity": "complex",
    "requiresMultiAgent": true,
    "debateMode": true,
    "reason": "投资分析需要多角度辩论"
  },
  "debate": {
    "rounds": 2,
    "history": {
      "finance": {
        "1": "Round 1: 基本面分析...",
        "2": "Round 2: 反驳 research 的观点..."
      },
      "research": {
        "1": "Round 1: 行业趋势分析...",
        "2": "Round 2: 回应 finance 的质疑..."
      }
    }
  },
  "critique": "Critic 的审查意见 / Critic review...",
  "finalAnswer": "Judge 的最终汇总 / Judge synthesis...",
  "errors": []
}
```

### GET /health

```json
{
  "status": "ok",
  "timestamp": "2026-01-27T10:00:00.000Z"
}
```

---

## 目录结构 / Project Structure

```
hermes-multiagent/
├── Dockerfile              # 两阶段构建 / Two-stage build
├── .env.example            # 环境变量模板 / Env template
├── package.json            # Node.js 依赖 / Dependencies
├── tsconfig.json           # TypeScript 配置 / TS config
├── README.md               # 本文档 / This document
├── ARCHITECTURE.md         # 架构详解 / Architecture details
├── API.md                  # API 完整文档 / Full API docs
├── CONFIG.md               # 配置指南 / Config guide
└── src/
    ├── server.ts           # Express API (/health, /invoke)
    ├── graph.ts            # LangGraph 状态图 / State graph
    ├── router.ts           # 路由节点 / Router node
    ├── nodes.ts            # Agent 执行节点 / Agent execution nodes
    ├── state.ts            # 状态类型 / State types
    ├── models.ts           # LiteLLM 模型工厂 / Model factory
    ├── schemas.ts          # Zod 验证 / Zod validation
    ├── prompts.ts          # 各 Agent 提示词 / System prompts
    └── agents/
        ├── factory.ts      # Agent 工厂 / Agent factory
        ├── coding.ts       # 编程 / Coding
        ├── research.ts     # 调研 / Research
        ├── finance.ts      # 金融 / Finance
        ├── document.ts     # 文档 / Document
        ├── general.ts      # 通用 / General
        ├── critic.ts       # 批评 / Critic
        └── judge.ts        # 裁判 / Judge
```

## 后续扩展 / Roadmap

- [ ] Phase 2: 加 MCP 工具 (股票数据, GitHub, 搜索) / Add MCP tools (stock data, GitHub, search)
- [ ] Phase 3: 加 Hermes MCP 配置，让 Hermes 直接调用 Gateway / Hermes MCP integration
- [ ] Phase 4: 加 n8n 定时触发 / n8n scheduled triggers
- [ ] Phase 5: PostgreSQL checkpoint 持久化 / PostgreSQL checkpoint persistence

## 相关文档 / Related Docs

- [ARCHITECTURE.md](./ARCHITECTURE.md) - 架构详解 / Architecture details
- [API.md](./API.md) - API 完整文档 / Full API reference
- [CONFIG.md](./CONFIG.md) - 配置指南 / Configuration guide
