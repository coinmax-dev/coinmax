---
name: crypto_market_data
description: Fetch real-time cryptocurrency market data from CoinGecko and Fear & Greed Index
---

# Crypto Market Data

When you need current market data for analysis, run these commands:

## Fetch All Coin Prices & Stats

```bash
curl -s "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,solana,binancecoin,dogecoin,ripple,cardano,avalanche-2,chainlink,polkadot&order=market_cap_desc&sparkline=false&price_change_percentage=1h,24h,7d" | python3 -c "
import json, sys
coins = json.load(sys.stdin)
NAMES = {'bitcoin':'BTC','ethereum':'ETH','solana':'SOL','binancecoin':'BNB','dogecoin':'DOGE','ripple':'XRP','cardano':'ADA','avalanche-2':'AVAX','chainlink':'LINK','polkadot':'DOT'}
for c in coins:
    sym = NAMES.get(c['id'], c['symbol'].upper())
    h1 = c.get('price_change_percentage_1h_in_currency') or 0
    h24 = c.get('price_change_percentage_24h') or 0
    d7 = c.get('price_change_percentage_7d') or 0
    vol = c['total_volume'] / 1e6
    print(f\"{sym:5s} \${c['current_price']:>10,.2f} | 1h:{h1:+.2f}% 24h:{h24:+.2f}% 7d:{d7:+.2f}% | vol:\${vol:.0f}M | range:\${c['low_24h']:.2f}-\${c['high_24h']:.2f}\")
"
```

## Fetch Fear & Greed Index

```bash
curl -s "https://api.alternative.me/fng/?limit=1" | python3 -c "
import json, sys
d = json.load(sys.stdin)
v = d['data'][0]
print(f\"Fear & Greed Index: {v['value']} ({v['value_classification']})\")"
```

## Fetch Latest Crypto News

```bash
curl -s "https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=popular" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for n in d.get('Data', [])[:5]:
    print(f\"- {n['title']} ({n['source']})\")
"
```

Run all three commands, then analyze the data to pick the best trading opportunities.
