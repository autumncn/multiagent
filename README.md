# Hermes Multi-Agent Gateway

LangGraph.js 多模型路由 + 圆桌辩论系统。

## 架构

```
用户请求 → Hermes
              ↓ POST /invoke
        Multi-Agent Gateway (:18088)
              ↓
        LangGraph Supervisor
          ├── Router (router-fast)        → 判断任务类型
          ├── Specialist Agents (并行)     → 各抒己见 Round 1
          ├── Debate Rounds (串行)         → 互相辩论 Round 2+
          ├── Critic (critic-primary)     → 审查辩论质量
          └── Judge (judge-primary)       → 汇总最终答案
              ↓
           LiteLLM (:4000)
              ↓
        各实际模型 (Qwen/DeepSeek/Kimi/MiniMax/GLM)
```

## 流程

```
简单任务:
  Router → 1个 Agent → Judge → 返回

复杂任务 (无辩论):
  Router → 多个 Agent 并行 → Critic → Judge → 返回

复杂任务 (辩论模式):
  Router → 多个 Agent 并行 (Round 1)
         → 互相看到对方观点, 辩论 (Round 2)
         → 互相反驳 (Round 3, 可选)
         → Critic 审查
         → Judge 汇总
         → 返回
```

## 模型别名

| 别名 | 用途 | 建议模型 |
|---|---|---|
| router-fast | 路由判断 | Qwen 3-30B-A3B (免费) |
| general-fast | 通用问答 | Qwen 3-30B-A3B (免费) |
| coding-primary | 编程/Docker | Qwen 3.7-plus-cp |
| research-primary | 搜索/调研 | Qwen 3.7 Max |
| finance-primary | 金融/股票 | DeepSeek V4 Pro |
| document-primary | 文档处理 | Kimi K2.5 |
| critic-primary | 审查/找问题 | MiniMax M3 |
| judge-primary | 最终汇总 | Qwen 3.7 Max TP |

换模型只改 LiteLLM config.yaml，不改 Agent 代码。

## 部署到 51

### Step 1: 复制项目到 51

```bash
scp -r /usr/local/applications/hermes-multiagent root@192.168.31.51:/usr/local/applications/
```

### Step 2: 在 LiteLLM config.yaml 中添加模型别名

```bash
# 编辑 LiteLLM config
ssh root@192.168.31.51
# 找到 litellm 的 config.yaml 并添加以下 model_list 条目
```

需要在 model_list 中添加:

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

注意: 根据你的 LiteLLM 已有配置格式调整 model/api_key/api_base。

### Step 3: 创建 PostgreSQL 数据库

```bash
ssh root@192.168.31.51

docker exec -it litellm-db psql -U user -c "CREATE DATABASE multiagent;"
docker exec -it litellm-db psql -U user -c "CREATE USER multiagent WITH PASSWORD 'your-strong-password';"
docker exec -it litellm-db psql -U user -c "GRANT ALL PRIVILEGES ON DATABASE multiagent TO multiagent;"
```

### Step 4: 修改 .env

```bash
cd /usr/local/applications/hermes-multiagent

# 生成随机 API Key
openssl rand -hex 32
# 把生成的值填入 AGENT_API_KEY

# 修改数据库密码
# POSTGRES_PASSWORD=your-strong-password

# 确认 LiteLLM 地址和 key
# LITELLM_BASE_URL=http://192.168.31.51:4000/v1
# LITELLM_API_KEY=sk-your-litellm-key
```

### Step 5: 构建镜像

```bash
cd /usr/local/applications/hermes-multiagent
docker build -t hermes-multiagent:0.1.0 .
```

### Step 6: 运行

```bash
docker run -d \
  --name hermes-multiagent \
  --restart unless-stopped \
  -p 127.0.0.1:18088:18088 \
  --env-file /usr/local/applications/hermes-multiagent/.env \
  --add-host=host.docker.internal:host-gateway \
  hermes-multiagent:0.1.0
```

### Step 7: 测试

```bash
# 健康检查
curl http://localhost:18088/health

# 简单任务 (单 Agent, 无辩论)
curl -s -X POST http://localhost:18088/invoke \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_AGENT_API_KEY" \
  -d '{"message": "帮我写一个 bash 脚本，监控磁盘使用率超过 80% 就发告警"}' \
  | python3 -m json.tool

# 复杂任务 (多 Agent + 辩论模式)
curl -s -X POST http://localhost:18088/invoke \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_AGENT_API_KEY" \
  -d '{
    "message": "分析 SATS (新翔集团 SGX: S58) 这只股票，从基本面、技术面和行业趋势三个角度分析，值不值得持有 6 个月",
    "threadId": "sats-debate-001",
    "maxDebateRounds": 2
  }' \
  | python3 -m json.tool

# 跨领域任务 (触发多 Agent)
curl -s -X POST http://localhost:18088/invoke \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_AGENT_API_KEY" \
  -d '{
    "message": "我打算用 Docker + FastAPI 做一个股票分析服务，同时需要对 OCBC 做估值分析，帮我设计方案",
    "threadId": "ocbc-tech-001"
  }' \
  | python3 -m json.tool
```

## API 说明

### POST /invoke

**Headers:**
- `Content-Type: application/json`
- `x-api-key: YOUR_AGENT_API_KEY`

**Body:**
```json
{
  "message": "你的问题",
  "threadId": "可选, 用于追踪",
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
  "critique": "Critic 的审查意见...",
  "finalAnswer": "Judge 的最终汇总...",
  "errors": []
}
```

## 更新部署

```bash
# 重新构建
cd /usr/local/applications/hermes-multiagent
docker build -t hermes-multiagent:0.1.1 .

# 停旧启新
docker stop hermes-multiagent && docker rm hermes-multiagent
docker run -d \
  --name hermes-multiagent \
  --restart unless-stopped \
  -p 127.0.0.1:18088:18088 \
  --env-file /usr/local/applications/hermes-multiagent/.env \
  --add-host=host.docker.internal:host-gateway \
  hermes-multiagent:0.1.1
```

## 后续扩展

- Phase 2: 加 MCP 工具 (股票数据, GitHub, 搜索)
- Phase 3: 加 Hermes MCP 配置，让 Hermes 能直接调用 Gateway
- Phase 4: 加 n8n 定时触发
