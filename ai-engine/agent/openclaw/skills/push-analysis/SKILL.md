---
name: push_analysis
description: Push AI trading analysis results to CoinMax Supabase database
---

# Push Analysis to CoinMax

After completing your market analysis, push results to Supabase using these commands.

## Step 1: Push Coin Screening Result

Replace `PICKS` with your selected coins and `REASON` with your reasoning:

```bash
curl -s "https://enedbksmftcgtszrkppc.supabase.co/rest/v1/ai_market_analysis" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuZWRia3NtZnRjZ3RzenJrcHBjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzc5MzEyMCwiZXhwIjoyMDg5MzY5MTIwfQ.URK9Jw6uW0XbqB30dSQwE_x576Y0-6w-Ximb2gW6H5A" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuZWRia3NtZnRjZ3RzenJrcHBjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzc5MzEyMCwiZXhwIjoyMDg5MzY5MTIwfQ.URK9Jw6uW0XbqB30dSQwE_x576Y0-6w-Ximb2gW6H5A" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  -d '{
    "asset": "SCREENING",
    "model": "openclaw-agent",
    "direction": "NEUTRAL",
    "confidence": 0,
    "reasoning": "AI Agent picks: [BTC,ETH,SOL,DOGE,XRP] — your reasoning here",
    "key_levels": {"picks": ["BTC","ETH","SOL","DOGE","XRP"], "source": "openclaw-agent"},
    "market_sentiment": "screening",
    "timeframe": "4H",
    "expires_at": "'$(date -u -v+20M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "+20 minutes" +%Y-%m-%dT%H:%M:%SZ)'"
  }'
```

## Step 2: Push Analysis for Each Coin

For EACH coin you analyzed, push a separate record. Replace the values:

```bash
curl -s "https://enedbksmftcgtszrkppc.supabase.co/rest/v1/ai_market_analysis" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuZWRia3NtZnRjZ3RzenJrcHBjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzc5MzEyMCwiZXhwIjoyMDg5MzY5MTIwfQ.URK9Jw6uW0XbqB30dSQwE_x576Y0-6w-Ximb2gW6H5A" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuZWRia3NtZnRjZ3RzenJrcHBjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzc5MzEyMCwiZXhwIjoyMDg5MzY5MTIwfQ.URK9Jw6uW0XbqB30dSQwE_x576Y0-6w-Ximb2gW6H5A" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  -d '{
    "asset": "BTC",
    "model": "openclaw-agent",
    "direction": "BULLISH",
    "confidence": 72,
    "reasoning": "Your 2-3 sentence analysis here",
    "key_levels": {"support": 68000, "resistance": 72000},
    "market_sentiment": "fearful",
    "timeframe": "4H",
    "expires_at": "'$(date -u -v+20M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "+20 minutes" +%Y-%m-%dT%H:%M:%SZ)'"
  }'
```

Repeat Step 2 for each coin (BTC, ETH, SOL, etc). Change `asset`, `direction`, `confidence`, `reasoning`, `key_levels`, and `market_sentiment` for each.

## Important

- `direction` must be exactly: `BULLISH`, `BEARISH`, or `NEUTRAL`
- `confidence` must be 0-100
- `expires_at` should be ~20 minutes from now (the template above auto-calculates this)
- The simulate-trading system reads these results every 5 minutes to adjust trading signals
