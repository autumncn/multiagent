# Hermes Multi-Agent Gateway

Multi-model routing + roundtable debate system.
多模型路由 + 圆桌辩论系统。

## Architecture / 架构

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

> **节点说明:**
> - **Router** = 路由器，判断任务类型和复杂度
> - **Agents** = 专业智能体（编程/调研/金融/文档/通用），Round 1 并行独立分析
> - **Debate** = 辩论轮次，Round 2+ 串行互相看到观点并辩论
> - **Critic** = 批评家，审查辩论质量
> - **Judge** = 裁判，汇总所有轮次生成最终答案

## Flow / 流程

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

> **说明:**
> - 简单任务: 路由器 → 1个智能体 → 裁判 → 返回
> - 复杂任务(无辩论): 路由器 → 多个智能体并行 → 批评家 → 裁判 → 返回
> - 复杂任务(辩论模式): 路由器 → 并行Round1 → 辩论Round2 → 反驳Round3 → 批评家 → 裁判 → 返回

## Model Aliases / 模型别名

| Alias | Purpose | Suggested Model |
|---|---|---|
| router-fast | Task routing / 路由判断 | Qwen 3-30B-A3B (free) |
| general-fast | General Q&A / 通用问答 | Qwen 3-30B-A3B (free) |
| coding-primary | Coding/Docker / 编程 | Qwen 3.7-plus-cp |
| research-primary | Research / 搜索调研 | Qwen 3.7 Max |
| finance-primary | Finance/Stock / 金融 | DeepSeek V4 Pro |
| document-primary | Documents / 文档处理 | Kimi K2.5 |
| critic-primary | Critique / 审查 | MiniMax M3 |
| judge-primary | Judge / 最终汇总 | Qwen 3.7 Max TP |

Swap models by editing LiteLLM config.yaml only.
换模型只改 LiteLLM config.yaml，不改 Agent 代码。

---

## Quick Deploy (Docker Image) / 快速部署

Pre-built image available. Pull and run.
预构建镜像可用，直接拉取运行。

### Prerequisites / 前提条件

- Docker installed / 已安装 Docker
- LiteLLM running on `:4000` / LiteLLM 运行在 :4000
- PostgreSQL available / PostgreSQL 可用

### Step 1: Create config directory / 创建配置目录

```bash
mkdir -p /usr/local/applications/hermes-multiagent-docker
```

### Step 2: Generate .env / 生成 .env

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

echo "API_KEY: $API_KEY"
echo "DB_PASS: $DB_PASS"
```

> **Important / 注意:** `.env` file must NOT contain `#` comments or blank lines. Docker `--env-file` will fail on them.
> `.env` 文件不能包含 `#` 注释或空行，否则 Docker `--env-file` 会报错。

### Step 3: Create database / 创建数据库

```bash
docker exec -it litellm-db psql -U litellm -c "CREATE DATABASE multiagent;"
docker exec -it litellm-db psql -U litellm -c "CREATE USER multiagent WITH PASSWORD '$DB_PASS';"
docker exec -it litellm-db psql -U litellm -c "GRANT ALL PRIVILEGES ON DATABASE multiagent TO multiagent;"
```

### Step 4: Pull and run / 拉取并运行

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

### Step 5: Configure LiteLLM aliases / 配置 LiteLLM 别名

Add to `model_list` in LiteLLM `config.yaml`. See [CONFIG.md](./CONFIG.md) for details.
添加到 LiteLLM config.yaml 的 model_list 中。详见 [CONFIG.md](./CONFIG.md)。

### Step 6: Verify / 验证

```bash
# Health check / 健康检查
curl http://localhost:18088/health

# Simple task / 简单任务
curl -s -X POST http://localhost:18088/invoke \
  -H "Content-Type: application/json" \
  -H "x-api-key: $(grep AGENT_API_KEY /usr/local/applications/hermes-multiagent-docker/.env | cut -d= -f2)" \
  -d '{"message": "Write a bash script to monitor disk usage"}'

# Debate task / 辩论任务
curl -s -X POST http://localhost:18088/invoke \
  -H "Content-Type: application/json" \
  -H "x-api-key: $(grep AGENT_API_KEY /usr/local/applications/hermes-multiagent-docker/.env | cut -d= -f2)" \
  -d '{
    "message": "Analyze SATS (SGX: S58) for 6-month hold",
    "threadId": "sats-debate-001",
    "maxDebateRounds": 2
  }'
```

---

## Update Deployment / 更新部署

```bash
# Pull new version / 拉取新版本
docker pull dimages.ctimware.com/hermes-multiagent:latest

# Replace container / 替换容器
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

## Build from Source / 从源码构建

```bash
# Clone / 克隆
cd /usr/local/applications
git clone https://github.com/autumncn/multiagent.git hermes-multiagent
cd hermes-multiagent

# Build / 构建
docker build -t hermes-multiagent:local .

# Run / 运行
docker run -d \
  --name hermes-multiagent \
  --restart unless-stopped \
  -p 127.0.0.1:18088:18088 \
  --env-file /usr/local/applications/hermes-multiagent-docker/.env \
  --add-host=host.docker.internal:host-gateway \
  hermes-multiagent:local
```

### Build and push / 构建并推送

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

## API Reference / API 文档

See [API.md](./API.md) for full details.
完整文档见 [API.md](./API.md)。

### POST /invoke

```bash
curl -X POST http://localhost:18088/invoke \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_KEY" \
  -d '{
    "message": "Your question here",
    "threadId": "optional-tracking-id",
    "maxDebateRounds": 2
  }'
```

### GET /health

```bash
curl http://localhost:18088/health
```

---

## Project Structure / 目录结构

```
hermes-multiagent/
+-- Dockerfile              # Two-stage build / 两阶段构建
+-- .env.example            # Env template / 环境变量模板
+-- package.json            # Node.js deps / 依赖
+-- tsconfig.json           # TypeScript config / TS配置
+-- README.md               # This document / 本文档
+-- ARCHITECTURE.md         # Architecture details / 架构详解
+-- API.md                  # API reference / API文档
+-- CONFIG.md               # Config guide / 配置指南
+-- src/
    +-- server.ts           # Express API (/health, /invoke)
    +-- graph.ts            # LangGraph state graph / 状态图
    +-- router.ts           # Router node / 路由节点
    +-- nodes.ts            # Agent execution nodes / 执行节点
    +-- state.ts            # State types / 状态类型
    +-- models.ts           # LiteLLM model factory / 模型工厂
    +-- schemas.ts          # Zod validation / Zod验证
    +-- prompts.ts          # System prompts / 提示词
    +-- agents/
        +-- factory.ts      # Agent factory / 智能体工厂
        +-- coding.ts       # Coding / 编程
        +-- research.ts     # Research / 调研
        +-- finance.ts      # Finance / 金融
        +-- document.ts     # Document / 文档
        +-- general.ts      # General / 通用
        +-- critic.ts       # Critic / 批评家
        +-- judge.ts        # Judge / 裁判
```

## Roadmap / 后续扩展

- [ ] Phase 2: MCP tools (stock data, GitHub, search) / MCP 工具
- [ ] Phase 3: Hermes MCP integration / Hermes 对接
- [ ] Phase 4: n8n scheduled triggers / n8n 定时触发
- [ ] Phase 5: PostgreSQL checkpoint persistence / 持久化检查点

## Related Docs / 相关文档

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Architecture details / 架构详解
- [API.md](./API.md) - API reference / API 文档
- [CONFIG.md](./CONFIG.md) - Configuration guide / 配置指南
