# Configuration Guide

## Environment Variables

Config file path: `/usr/local/applications/hermes-multiagent-docker/.env`

```bash
PORT=18088
AGENT_API_KEY=your-random-key
LITELLM_BASE_URL=http://192.168.31.51:4000/v1
LITELLM_API_KEY=sk-my-litellm-key-lucas@320
```

> **Important:** .env file must NOT contain comments (`#`) or blank lines. Docker `--env-file` will fail on them.

## LiteLLM Aliases

Configure these aliases in LiteLLM UI (not config.yaml):

| Alias | Type | Purpose | Model ID | Cost (In/Out) |
|---|---|---|---|---|
| `router-fast` | 固定节点 | Router 决策 | deepseek-v4-flash-tp | $0.09/$0.18 |
| `judge-primary` | 固定节点 | 最终裁决 | qwen3.7-max-tp | $1.25/$3.75 |
| `critic-primary` | 固定节点 | 质量审查 | deepseek-v4-pro-tp | $0.43/$0.87 |
| `general-fast` | 动态专家 | 简单任务 fallback | deepseek-v4-flash-tp | $0.09/$0.18 |
| `technical-heavy` | 动态专家 | 代码/DevOps | qwen3.7-plus-cp | $0.32/$1.28 |
| `technical-light` | 动态专家 | 简单脚本 | deepseek-v4-flash-tp | $0.09/$0.18 |
| `finance-heavy` | 动态专家 | 金融分析 | deepseek-v4-pro-tp | $0.43/$0.87 |
| `research-heavy` | 动态专家 | 深度研究 | qwen3.7-max-tp | $1.25/$3.75 |
| `creative-heavy` | 动态专家 | 长文写作 | qwen3.7-max-tp | $1.25/$3.75 |
| `creative-light` | 动态专家 | 简短写作 | deepseek-v4-flash-tp | $0.09/$0.18 |

### Adding aliases via LiteLLM UI

1. Open LiteLLM UI: `http://YOUR_HOST:4000/ui`
2. Login with master key
3. Go to "Models" tab
4. Click "Add Model" for each alias
5. Set model name to the alias (e.g., `router-fast`)
6. Select the underlying model

### Adding aliases via API

```bash
# Add router-fast
curl -X POST http://YOUR_HOST:4000/model/new \
  -H "Authorization: Bearer sk-your-master-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model_name": "router-fast",
    "litellm_params": {
      "model": "dashscope/qwen3-30b-a3b",
      "api_key": "sk-your-dashscope-key"
    }
  }'

# Add reasoning-heavy
curl -X POST http://YOUR_HOST:4000/model/new \
  -H "Authorization: Bearer sk-your-master-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model_name": "reasoning-heavy",
    "litellm_params": {
      "model": "dashscope/deepseek-v4-pro",
      "api_key": "sk-your-dashscope-key"
    }
  }'
```

## Registry Configuration

`src/registry.yaml` defines capability mapping for each alias:

```yaml
aliases:
  router-fast:
    capabilities: [routing, classification]
    description: "Fast, cheap model for routing decisions"

  reasoning-heavy:
    capabilities: [judge, synthesis, decision, complex_reasoning, macro, debate]
    description: "Best model for complex reasoning and final judgment"

  reasoning-light:
    capabilities: [general, qa, daily, travel, simple, greeting]
    description: "Fast model for simple tasks and Q&A"

  critical-heavy:
    capabilities: [criticism, logic, review, contradiction, risk, fact_check, audit]
    description: "Best model for finding flaws, risks and contradictions"

  technical-heavy:
    capabilities: [code, devops, architecture, security, debugging, infrastructure, database, networking]
    description: "Best model for complex engineering tasks"

  technical-light:
    capabilities: [script, simple_code, command, bash, config]
    description: "Fast model for simple code tasks"

  finance-heavy:
    capabilities: [finance, valuation, quant, market, portfolio, technical_analysis, stock, forex, options]
    description: "Best model for financial analysis and valuation"

  research-heavy:
    capabilities: [research, long_context, report, analysis, industry, news, comparison, trend]
    description: "Best model for deep research and analysis"

  creative-heavy:
    capabilities: [writing, document, report, email, summarization, communication, content]
    description: "Best model for long-form writing and communication"

  creative-light:
    capabilities: [brief, summary, rewrite, translation, editing]
    description: "Fast model for short writing tasks"
```

When Router generates an expert with `needs: ["finance", "valuation"]`, registry matches to `finance-heavy` (Kimi K2.5).

To add new capability or change mapping:
1. Edit `src/registry.yaml`
2. Rebuild Docker image
3. Update LiteLLM aliases if needed

## Troubleshooting

**Port 18088 not accessible**
```bash
# Check if container is running
docker ps | grep hermes-multiagent

# Check logs
docker logs hermes-multiagent

# Test from host
curl http://localhost:18088/health
```

**LiteLLM connection failed**
```bash
# Check LiteLLM is running
curl http://YOUR_HOST:4000/health

# Check aliases exist
curl -H "Authorization: Bearer sk-your-master-key" \
  http://YOUR_HOST:4000/v1/models
```

**Registry not loading**
```bash
# Check registry.yaml exists in container
docker exec hermes-multiagent cat /app/dist/registry.yaml

# Check logs for registry load message
docker logs hermes-multiagent | grep "Loaded model registry"
```
