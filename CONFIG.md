# 配置指南 / Configuration Guide

## 环境变量 / Environment Variables

配置文件路径: `/usr/local/applications/hermes-multiagent-docker/.env`
Config file path: `/usr/local/applications/hermes-multiagent-docker/.env`

```bash
PORT=18088
AGENT_API_KEY=your-random-key
LITELLM_BASE_URL=http://192.168.31.51:4000/v1
LITELLM_API_KEY=sk-xxx
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
POSTGRES_PASSWORD=your-db-pass
DATABASE_URL=postgresql://multiagent:pass@host:5432/multiagent
```

**注意 / Note:** .env 文件中不能有 `#` 注释或空行，否则 Docker `--env-file` 会报错。
.env file must NOT contain `#` comments or blank lines — Docker `--env-file` will fail.

## LiteLLM 模型别名 / LiteLLM Model Aliases

将这些添加到 LiteLLM `config.yaml` 的 `model_list` 中:
Add to `model_list` in LiteLLM `config.yaml`:

```yaml
model_list:
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

根据你的 LiteLLM 提供商设置调整 model/api_base/api_key。
Adjust model/api_base/api_key to match your LiteLLM provider setup.

## Docker 部署 / Docker Deployment

### 使用预构建镜像 (推荐) / Using pre-built image (recommended)

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

### 从源码构建 / Build from source

```bash
cd /usr/local/applications/hermes-multiagent
docker build -t hermes-multiagent:local .

docker run -d \
  --name hermes-multiagent \
  --restart unless-stopped \
  -p 127.0.0.1:18088:18088 \
  --env-file /usr/local/applications/hermes-multiagent-docker/.env \
  --add-host=host.docker.internal:host-gateway \
  hermes-multiagent:local
```

### 更新 / Update

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

### 构建并推送 / Build and push

```bash
cd /usr/local/applications/hermes-multiagent
VERSION=$(date +%Y%m%d)

docker build -t hermes-multiagent:$VERSION .
docker tag hermes-multiagent:$VERSION dimages.ctimware.com/hermes-multiagent:$VERSION
docker tag hermes-multiagent:$VERSION dimages.ctimware.com/hermes-multiagent:latest
docker push dimages.ctimware.com/hermes-multiagent:$VERSION
docker push dimages.ctimware.com/hermes-multiagent:latest
```

## 更换模型 / Changing Models

只需修改 LiteLLM `config.yaml`，无需改 Agent 代码:
Only edit LiteLLM `config.yaml` — no agent code changes needed:

```yaml
# 例如: 把 finance-primary 从 DeepSeek 换成 Kimi
# Example: change finance-primary from DeepSeek to Kimi
- model_name: finance-primary
  litellm_params:
    model: openrouter/moonshotai/kimi-k2.5
    api_key: os.environ/OPENROUTER_API_KEY
```

然后重启 LiteLLM:
Then restart LiteLLM:

```bash
docker restart litellm
```

## 调整辩论轮次 / Tuning Debate Rounds

通过 API 参数控制:
Control via API parameter:

```bash
# 快速分析 (1轮) / Quick analysis (1 round)
curl -X POST http://localhost:18088/invoke \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_KEY" \
  -d '{"message": "...", "maxDebateRounds": 1}'

# 深入辩论 (3轮) / Thorough debate (3 rounds)
curl -X POST http://localhost:18088/invoke \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_KEY" \
  -d '{"message": "...", "maxDebateRounds": 3}'
```

更多轮次 = 更深入但更慢且 token 成本更高。
More rounds = more thorough but slower and higher token cost.

## 故障排查 / Troubleshooting

### 容器无法启动 / Container won't start

```bash
# 检查日志 / Check logs
docker logs hermes-multiagent

# 检查端口冲突 / Check port conflict
ss -tlnp | grep 18088
```

### LiteLLM 连接失败 / LiteLLM connection fails

```bash
# 确认 LiteLLM 可访问 / Verify LiteLLM is accessible
curl http://192.168.31.51:4000/health

# 检查 .env 中的 URL / Check URL in .env
grep LITELLM_BASE_URL /usr/local/applications/hermes-multiagent-docker/.env
```

### 模型别名未找到 / Model alias not found

```bash
# 确认 LiteLLM 配置包含所有别名 / Verify LiteLLM config has all aliases
curl http://192.168.31.51:4000/v1/models \
  -H "Authorization: Bearer YOUR_LITELLM_KEY"
```
