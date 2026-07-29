# China Stock MCP Server

A股实时行情数据，数据源：腾讯财经 API + 东方财富 API。

## Tools (8)

| Tool | Description |
|------|-------------|
| `get_realtime_quote` | 实时行情（现价/涨跌幅/成交量/PE/PB/换手率） |
| `get_kline_history` | K线数据（日/周/月，前复权/后复权/不复权） |
| `get_fibonacci_levels` | 斐波那契回撤位计算（0.382/0.500/0.618/0.786） |
| `get_sector_ranking` | 行业板块涨幅排名 |
| `get_northbound_flow` | 北向资金流向（沪股通+深股通） |
| `get_etf_ranking` | ETF涨幅排名（支持排除科创板688xxx） |
| `search_stock` | 搜索A股（中文名/拼音/代码） |
| `get_market_indices` | 大盘指数（上证/深证/创业板/科创50/沪深300/中证500/上证50） |

## 数据源

- **实时行情/K线**: 腾讯财经 `qt.gtimg.cn`（GBK编码，免费无需认证）
- **板块/北向/ETF**: 东方财富 `datacenter-web.eastmoney.com`
- **搜索**: 腾讯智能搜索 `smartbox.gtimg.cn`

## 股票代码格式

| 格式 | 示例 | 说明 |
|------|------|------|
| `sh` + 6位 | `sh600519` | 上海证券交易所 |
| `sz` + 6位 | `sz300024` | 深圳证券交易所 |
| 纯6位数字 | `600519` | 自动识别（6开头→上海，0/3开头→深圳） |
| `.SS`/`.SZ` | `600519.SS` | Yahoo Finance 格式（也支持） |

## Deploy

```bash
docker build -t ai-china-stock-mcp .
docker run -d --name ai-china-stock-mcp \
  --restart unless-stopped \
  --dns 8.8.8.8 --dns 1.1.1.1 \
  -p 3001:3001 \
  ai-china-stock-mcp
```

## 注意事项

- `--dns 8.8.8.8` 绕过 AdGuard 对 `fc.yahoo.com` 的 DNS 屏蔽（Yahoo MCP 也需要）
- MCP StreamableHTTP 协议，端口 3001
- 支持排除科创板（688xxx 代码）
