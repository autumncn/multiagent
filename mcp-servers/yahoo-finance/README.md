# Yahoo Finance MCP Server

Provides US/HK/SG stock market data via Yahoo Finance API.

## Tools (11)

| Tool | Description |
|------|-------------|
| `get-ticker-info` | Company info + financials (PE, PB, market cap) |
| `get-ticker-news` | Latest news (up to 50 articles) |
| `search` | Search stocks/ETFs by keyword |
| `get-top-entities` | Industry leaders (ETFs, companies) |
| `get-price-history` | Historical prices (1d to max) |
| `ticker-option-chain` | Options chain data |
| `ticker-earning` | Earnings data (annual/quarterly) |
| `get-insider-transactions` | Insider trading activity |
| `get-institutional-holders` | Institutional holdings |
| `get-sec-filings` | SEC filings (10-K, 10-Q, etc.) |
| `get-filing-content` | Download SEC filing content |

## Deploy

```bash
docker build -t ai-yahoo-mcp .
docker run -d --name ai-yahoo-mcp \
  --restart unless-stopped \
  --dns 8.8.8.8 --dns 1.1.1.1 \
  -p 3000:3000 \
  ai-yahoo-mcp \
  python -m yahoo_finance_server \
  --transport http --host 0.0.0.0 --port 3000
```

## Notes

- Requires `--dns 8.8.8.8` to bypass AdGuard DNS blocking of Yahoo Finance domains
- MCP StreamableHTTP protocol on port 3000
- Data source: yfinance (unofficial Yahoo Finance API)
