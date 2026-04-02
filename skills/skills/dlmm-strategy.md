---
name: dlmm-strategy
description: Meteora DLMM concentrated liquidity strategy guidelines
---

# DLMM Strategy — Meteora

## Entry Criteria
- Active bin TVL must be > $50k
- 24h volume/TVL ratio > 0.3 (confirms fees cover IL risk)
- Price in middle 40% of bin range (avoid range edges)
- Funding rate on related perp market must be neutral to negative

## Exit Criteria
- Position IL exceeds 3x fees earned
- TVL drops > 40% in 2h (liquidity flight signal)
- Price moves to within 2 bins of range boundary
- Better opportunity available with confidence delta > 0.15

## Risk Rules
- Max single DLMM position: $300 USD
- Max 2 concurrent DLMM positions
- Prefer narrow bin ranges (12-20 bins) over wide ranges
- Always check Birdeye volume authenticity — wash trading inflates APR

## Memory Patterns
After each trade, record:
- Pool address, bin range entered, TVL at entry
- Fee earned vs IL at exit
- Whether volume held or collapsed
