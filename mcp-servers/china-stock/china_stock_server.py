"""
China Stock Market MCP Server
Data sources: Tencent Finance API, EastMoney API
"""

import json
import urllib.request
import urllib.parse
import ssl
from datetime import datetime
from typing import Optional
from fastmcp import FastMCP

mcp = FastMCP("china-stock-server")

# SSL context for HTTPS requests
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
}


def _normalize_code(symbol: str) -> str:
    """Normalize stock code to Tencent format (sh/sz prefix)"""
    symbol = symbol.strip().upper()
    
    # Already has prefix
    if symbol.startswith('SH') or symbol.startswith('SZ'):
        return symbol.lower()
    
    # Pure number
    if symbol.isdigit():
        code = symbol
        # Shanghai: 6xx, 5xx (ETF), 11xxxx (convertible bonds)
        if code.startswith('6') or code.startswith('5') or code.startswith('11'):
            return f'sh{code}'
        # Shenzhen: 0xx, 3xx, 15xxxx (ETF), 12xxxx (convertible bonds)
        else:
            return f'sz{code}'
    
    return symbol.lower()


def _fetch_tencent_realtime(codes: list[str]) -> dict:
    """Fetch realtime quotes from Tencent Finance API"""
    codes_str = ','.join(codes)
    url = f"https://qt.gtimg.cn/q={codes_str}"
    
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        resp = urllib.request.urlopen(req, context=ctx, timeout=15)
        raw = resp.read().decode('gbk')
    except Exception as e:
        return {"error": f"Failed to fetch: {e}"}
    
    results = {}
    lines = raw.strip().split(';')
    for line in lines:
        line = line.strip()
        if not line or '~' not in line:
            continue
        parts = line.split('~')
        if len(parts) < 45:
            continue
        
        code = parts[2]
        results[code] = {
            "name": parts[1],
            "code": code,
            "price": float(parts[3]) if parts[3] else 0,
            "prev_close": float(parts[4]) if parts[4] else 0,
            "open": float(parts[5]) if parts[5] else 0,
            "high": float(parts[33]) if parts[33] else 0,
            "low": float(parts[34]) if parts[34] else 0,
            "change_pct": float(parts[32]) if parts[32] else 0,
            "volume": int(parts[36]) if parts[36] else 0,  # 手
            "amount": float(parts[37]) if parts[37] else 0,  # 万元
            "turnover_rate": float(parts[38]) if parts[38] else 0,
            "pe_ratio": float(parts[39]) if parts[39] else 0,
            "pb_ratio": float(parts[46]) if len(parts) > 46 and parts[46] else 0,
            "date": parts[30] if len(parts) > 30 else "",
            "time": parts[31] if len(parts) > 31 else "",
        }
    
    return results


def _fetch_tencent_kline(code: str, period: str = "day", count: int = 60, fq: str = "qfq") -> list:
    """Fetch K-line data from Tencent Finance API
    
    Args:
        code: Stock code with prefix (e.g., sh600519)
        period: day/week/month
        count: Number of K-lines
        fq: qfq (forward adjusted) / hfq (backward adjusted) / nofq (unadjusted)
    
    Returns:
        List of [date, open, close, high, low, volume]
    """
    url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={code},{period},,,{count},{fq}"
    
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        resp = urllib.request.urlopen(req, context=ctx, timeout=15)
        data = json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        return []
    
    key = code
    stock_data = data.get('data', {}).get(key, {})
    klines = stock_data.get(f'{fq}{period}') or stock_data.get(period, [])
    
    return klines


def _fetch_eastmoney_sectors(page_size: int = 20, sort_by: str = "change_pct") -> list:
    """Fetch sector rankings from EastMoney API"""
    url = "https://datacenter-web.eastmoney.com/api/data/v1/get"
    params = {
        "sortColumns": "CHANGE_RATE",
        "sortTypes": "-1",
        "pageSize": str(page_size),
        "pageNumber": "1",
        "reportName": "RPT_INDUSTRY_BOARD",
        "columns": "BOARD_NAME,BOARD_CODE,CHANGE_RATE,BOARD_PRICE,TOTAL_MARKET_CAP,DEAL_AMOUNT,LEAD_STOCK_NAME,LEAD_STOCK_CHANGE",
        "source": "WEB",
        "client": "WEB",
    }
    
    full_url = f"{url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(full_url, headers={
        **HEADERS,
        'Referer': 'https://data.eastmoney.com/'
    })
    
    try:
        resp = urllib.request.urlopen(req, context=ctx, timeout=15)
        data = json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        return []
    
    if not data.get('result') or not data['result'].get('data'):
        return []
    
    return data['result']['data']


def _fetch_northbound_flow(days: int = 10) -> list:
    """Fetch northbound (沪股通+深股通) capital flow from EastMoney"""
    results = []
    
    for mutual_type in ["001", "003"]:  # 001=沪股通, 003=深股通
        url = "https://datacenter-web.eastmoney.com/api/data/v1/get"
        params = {
            "sortColumns": "TRADE_DATE",
            "sortTypes": "-1",
            "pageSize": str(days),
            "pageNumber": "1",
            "reportName": "RPT_MUTUAL_DEAL_HISTORY",
            "columns": "TRADE_DATE,MUTUAL_TYPE,NET_DEAL_AMT,BUY_AMT,SELL_AMT,DEAL_AMT,INDEX_CHANGE_RATE",
            "source": "WEB",
            "client": "WEB",
            "filter": f'(MUTUAL_TYPE="{mutual_type}")',
        }
        
        full_url = f"{url}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(full_url, headers={
            **HEADERS,
            'Referer': 'https://data.eastmoney.com/'
        })
        
        try:
            resp = urllib.request.urlopen(req, context=ctx, timeout=15)
            data = json.loads(resp.read().decode('utf-8'))
            if data.get('result') and data['result'].get('data'):
                results.extend(data['result']['data'])
        except Exception:
            continue
    
    # Sort by date descending
    results.sort(key=lambda x: x.get('TRADE_DATE', ''), reverse=True)
    return results


def _fetch_etf_ranking(page_size: int = 20) -> list:
    """Fetch ETF rankings by daily change from EastMoney"""
    url = "https://datacenter-web.eastmoney.com/api/data/v1/get"
    params = {
        "sortColumns": "CHANGE_RATE",
        "sortTypes": "-1",
        "pageSize": str(page_size),
        "pageNumber": "1",
        "reportName": "RPT_FUND_F10_EHJM",
        "columns": "SECURITY_CODE,SECURITY_NAME_ABBR,CHANGE_RATE,LATEST_NET_VALUE,ACCUMULATED_NET_VALUE,DEAL_AMOUNT",
        "source": "WEB",
        "client": "WEB",
        "filter": '(FUND_TYPE="1")',  # ETF type
    }
    
    full_url = f"{url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(full_url, headers={
        **HEADERS,
        'Referer': 'https://data.eastmoney.com/'
    })
    
    try:
        resp = urllib.request.urlopen(req, context=ctx, timeout=15)
        data = json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        return []
    
    if not data.get('result') or not data['result'].get('data'):
        return []
    
    return data['result']['data']


def _calc_fibonacci(high: float, low: float, current: float) -> dict:
    """Calculate Fibonacci retracement levels"""
    rng = high - low
    if rng == 0:
        return {"error": "High equals low, cannot calculate"}
    
    fib_0382 = low + rng * 0.382
    fib_0500 = low + rng * 0.500
    fib_0618 = low + rng * 0.618
    fib_0786 = low + rng * 0.786
    
    # Determine current position
    if current <= fib_0382:
        position = "below 0.382 (weak)"
    elif current <= fib_0500:
        position = "0.382~0.500 (buy zone)"
    elif current <= fib_0618:
        position = "0.500~0.618 (golden zone)"
    elif current <= fib_0786:
        position = "0.618~0.786 (strong)"
    else:
        position = "above 0.786 (very strong)"
    
    return {
        "high": high,
        "low": low,
        "range": round(rng, 2),
        "fib_0382": round(fib_0382, 2),
        "fib_0500": round(fib_0500, 2),
        "fib_0618": round(fib_0618, 2),
        "fib_0786": round(fib_0786, 2),
        "current": current,
        "position": position,
    }


# ============================================================
# MCP Tools
# ============================================================

@mcp.tool()
def get_realtime_quote(symbols: list[str]) -> str:
    """Get realtime stock/ETF/bond quotes from China A-share market.
    
    Args:
        symbols: List of stock codes. Accepts formats: 
                 - "sh600519" (Shanghai with prefix)
                 - "sz300024" (Shenzhen with prefix)
                 - "600519" (pure number, auto-detect exchange)
                 - "300024" (pure number)
    
    Returns:
        JSON with realtime data: price, change%, volume, PE, PB, turnover rate
    """
    codes = [_normalize_code(s) for s in symbols]
    data = _fetch_tencent_realtime(codes)
    
    if "error" in data:
        return json.dumps(data, ensure_ascii=False)
    
    return json.dumps(data, ensure_ascii=False, indent=2)


@mcp.tool()
def get_kline_history(symbol: str, period: str = "day", count: int = 60) -> str:
    """Get K-line (candlestick) history data for a stock.
    
    Args:
        symbol: Stock code (e.g., "600519", "sh600519", "sz300024")
        period: "day", "week", or "month"
        count: Number of K-lines to fetch (max ~200)
    
    Returns:
        JSON array of K-line data: [date, open, close, high, low, volume]
    """
    code = _normalize_code(symbol)
    klines = _fetch_tencent_kline(code, period, count)
    
    if not klines:
        return json.dumps({"error": f"No K-line data for {symbol}"}, ensure_ascii=False)
    
    # Format output
    result = []
    for k in klines:
        if len(k) >= 6:
            result.append({
                "date": k[0],
                "open": float(k[1]),
                "close": float(k[2]),
                "high": float(k[3]),
                "low": float(k[4]),
                "volume": int(k[5]) if k[5] else 0,
            })
    
    return json.dumps({
        "symbol": symbol,
        "period": period,
        "count": len(result),
        "data": result,
    }, ensure_ascii=False, indent=2)


@mcp.tool()
def get_fibonacci_levels(symbol: str, days: int = 20) -> str:
    """Calculate Fibonacci retracement levels based on recent high/low.
    
    Args:
        symbol: Stock code
        days: Number of trading days to look back (default 20)
    
    Returns:
        Fibonacci levels (0.382, 0.500, 0.618, 0.786) and current position
    """
    code = _normalize_code(symbol)
    klines = _fetch_tencent_kline(code, "day", days + 5)
    
    if not klines or len(klines) < days:
        return json.dumps({"error": f"Insufficient K-line data for {symbol}"}, ensure_ascii=False)
    
    # Get high/low from last N days
    recent = klines[-days:]
    highs = [float(k[3]) for k in recent]
    lows = [float(k[4]) for k in recent]
    current = float(recent[-1][2])  # last close
    
    high_20d = max(highs)
    low_20d = min(lows)
    
    fib = _calc_fibonacci(high_20d, low_20d, current)
    fib["symbol"] = symbol
    fib["lookback_days"] = days
    
    return json.dumps(fib, ensure_ascii=False, indent=2)


@mcp.tool()
def get_sector_ranking(count: int = 20) -> str:
    """Get A-share industry sector rankings by daily change.
    
    Args:
        count: Number of sectors to return (default 20)
    
    Returns:
        JSON array of sectors: name, change%, leader stock, deal amount
    """
    data = _fetch_eastmoney_sectors(page_size=count)
    
    if not data:
        return json.dumps({"error": "Failed to fetch sector data"}, ensure_ascii=False)
    
    results = []
    for item in data:
        results.append({
            "name": item.get("BOARD_NAME", ""),
            "code": item.get("BOARD_CODE", ""),
            "change_pct": round(item.get("CHANGE_RATE", 0), 2),
            "deal_amount": round(item.get("DEAL_AMOUNT", 0) / 10000, 2),  # 亿元
            "leader_stock": item.get("LEAD_STOCK_NAME", ""),
            "leader_change": round(item.get("LEAD_STOCK_CHANGE", 0), 2),
        })
    
    return json.dumps(results, ensure_ascii=False, indent=2)


@mcp.tool()
def get_northbound_flow(days: int = 10) -> str:
    """Get northbound capital flow (沪股通 + 深股通) data.
    
    Args:
        days: Number of trading days to fetch (default 10)
    
    Returns:
        JSON array: date, type (沪股通/深股通), net inflow, buy/sell amount
    """
    data = _fetch_northbound_flow(days)
    
    if not data:
        return json.dumps({"error": "Failed to fetch northbound data"}, ensure_ascii=False)
    
    results = []
    for item in data:
        mutual_type = "沪股通" if item.get("MUTUAL_TYPE") == "001" else "深股通"
        net_deal = item.get("NET_DEAL_AMT", 0)
        results.append({
            "date": item.get("TRADE_DATE", "")[:10],
            "type": mutual_type,
            "net_deal_amt": round(net_deal / 10000, 2) if net_deal else 0,  # 亿元
            "buy_amt": round(item.get("BUY_AMT", 0) / 10000, 2),
            "sell_amt": round(item.get("SELL_AMT", 0) / 10000, 2),
            "total_amt": round(item.get("DEAL_AMT", 0) / 10000, 2),
            "index_change": round(item.get("INDEX_CHANGE_RATE", 0), 2),
        })
    
    return json.dumps(results, ensure_ascii=False, indent=2)


@mcp.tool()
def get_etf_ranking(count: int = 20, exclude_star: bool = True) -> str:
    """Get ETF rankings by daily change percentage.
    
    Args:
        count: Number of ETFs to return (default 20)
        exclude_star: Exclude STAR market (科创板, 688xxx) ETFs (default True)
    
    Returns:
        JSON array: code, name, change%, net value, deal amount
    """
    data = _fetch_etf_ranking(page_size=count * 2 if exclude_star else count)
    
    if not data:
        return json.dumps({"error": "Failed to fetch ETF data"}, ensure_ascii=False)
    
    results = []
    for item in data:
        code = item.get("SECURITY_CODE", "")
        if exclude_star and code.startswith("688"):
            continue
        
        results.append({
            "code": code,
            "name": item.get("SECURITY_NAME_ABBR", ""),
            "change_pct": round(item.get("CHANGE_RATE", 0), 2),
            "net_value": item.get("LATEST_NET_VALUE", 0),
            "deal_amount": round(item.get("DEAL_AMOUNT", 0) / 10000, 2) if item.get("DEAL_AMOUNT") else 0,
        })
        
        if len(results) >= count:
            break
    
    return json.dumps(results, ensure_ascii=False, indent=2)


@mcp.tool()
def search_stock(keyword: str, count: int = 10) -> str:
    """Search for A-share stocks by name or code keyword.
    
    Args:
        keyword: Search keyword (Chinese name, pinyin, or code fragment)
        count: Max results to return
    
    Returns:
        JSON array of matching stocks: code, name, market
    """
    url = f"https://smartbox.gtimg.cn/s3/?v=2&q={urllib.parse.quote(keyword)}&t=all"
    req = urllib.request.Request(url, headers=HEADERS)
    
    try:
        resp = urllib.request.urlopen(req, context=ctx, timeout=10)
        raw = resp.read().decode('gbk')
    except Exception as e:
        return json.dumps({"error": f"Search failed: {e}"}, ensure_ascii=False)
    
    # Parse: v_hint="code~name~pinyin~..."
    results = []
    if '="' in raw:
        content = raw.split('="')[1].rstrip('";')
        items = content.split('^')
        for item in items[:count]:
            parts = item.split('~')
            if len(parts) >= 3:
                market = parts[0]  # sh or sz
                code = parts[1]
                name = parts[2]
                pinyin = parts[3] if len(parts) > 3 else ""
                results.append({
                    "code": f"{market}{code}",
                    "name": name,
                    "pinyin": pinyin,
                    "market": "Shanghai" if market == "sh" else "Shenzhen",
                })
    
    return json.dumps(results, ensure_ascii=False, indent=2)


@mcp.tool()
def get_market_indices() -> str:
    """Get major A-share market indices (上证、深证、创业板、科创板、中证500等).
    
    Returns:
        JSON with index data: name, price, change%, volume
    """
    # Major index codes
    indices = [
        "sh000001",  # 上证指数
        "sz399001",  # 深证成指
        "sz399006",  # 创业板指
        "sh000688",  # 科创50
        "sh000300",  # 沪深300
        "sh000905",  # 中证500
        "sh000016",  # 上证50
    ]
    
    data = _fetch_tencent_realtime(indices)
    
    if "error" in data:
        return json.dumps(data, ensure_ascii=False)
    
    return json.dumps(data, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    mcp.run(transport="http", host="0.0.0.0", port=3001)
