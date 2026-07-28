# Configuration Guide

## Environment Variables

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

> **Note:** .env file must NOT contain comments or blank lines. Docker --env-file will fail on them.

## LiteLLM Model Aliases

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

Adjust model/api_base/api_key to match your LiteLLM provider setup.

## Docker Deployment

### Using pre-built image (recommended)

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

### Build from source

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

### Update

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

### Build and push

```bash
cd /usr/local/applications/hermes-multiagent
VERSION=$(date +%Y%m%d)

docker build -t hermes-multiagent:$VERSION .
docker tag hermes-multiagent:$VERSION dimages.ctimware.com/hermes-multiagent:$VERSION
docker tag hermes-multiagent:$VERSION dimages.ctimware.com/hermes-multiagent:latest
docker push dimages.ctimware.com/hermes-multiagent:$VERSION
docker push dimages.ctimware.com/hermes-multiagent:latest
```

## Changing Models

Only edit LiteLLM `config.yaml` -- no agent code changes needed:

```yaml
# Example: change finance-primary from DeepSeek to Kimi
- model_name: finance-primary
  litellm_params:
    model: openrouter/moonshotai/kimi-k2.5
    api_key: os.environ/OPENROUTER_API_KEY
```

Then restart LiteLLM:

```bash
docker restart litellm
```

## Tuning Debate Rounds

Control via API parameter:

```bash
# Quick analysis (1 round)
curl -X POST http://localhost:18088/invoke \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_KEY" \
  -d '{"message": "...", "maxDebateRounds": 1}'

# Thorough debate (3 rounds)
curl -X POST http://localhost:18088/invoke \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_KEY" \
  -d '{"message": "...", "maxDebateRounds": 3}'
```

More rounds = more thorough but slower and higher token cost.

## Troubleshooting

### Container won't start

```bash
# Check logs
docker logs hermes-multiagent

# Check port conflict
ss -tlnp | grep 18088
```

### LiteLLM connection fails

```bash
# Verify LiteLLM is accessible
curl http://192.168.31.51:4000/health

# Check URL in .env
grep LITELLM_BASE_URL /usr/local/applications/hermes-multiagent-docker/.env
```

### Model alias not found

```bash
# Verify LiteLLM config has all aliases
curl http://192.168.31.51:4000/v1/models \
  -H "Authorization: Bearer YOUR_LITELLM_KEY"
```
