---
name: perp-risk
description: Perpetual futures risk management rules for Drift Protocol
---

# Perp Risk — Drift Protocol

## Entry Criteria
- Funding rate magnitude > 0.01% per hour (directional edge)
- Go short when funding is highly positive (longs pay shorts)
- Go long when funding is highly negative (shorts pay longs)
- Oracle/mark price divergence < 0.3%

## Leverage Rules
- Maximum leverage: 3x
- Preferred leverage: 2x
- Never use max leverage on memecoins
- SOL, ETH, BTC only for leveraged positions

## Exit Criteria
- Funding rate reverts to neutral (< 0.005%)
- Unrealized loss exceeds 8% of position size
- Mark/oracle divergence exceeds 1% (manipulation risk)

## Hard Rules
- Never hold perp position overnight without stop-loss
- Reduce size by 50% if drawdown > 10% on position
- Never add to a losing position

