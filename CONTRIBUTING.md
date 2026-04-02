# Contributing to enclave-trade

## Setup

```bash
git clone https://github.com/YOUR_ORG/enclave-trade
cd enclave-trade
bun install
cp .env.example .env
# Fill in ANTHROPIC_API_KEY and HELIUS_API_KEY
bun run setup
```

## Development

```bash
bun run dev          # hot-reload agent (TEE_MODE=software by default)
bun test             # run test suite
bun run lint         # typecheck
```

## Project Structure

```
src/
├── main.ts          # entry point — do not add business logic here
├── agent/           # loop, memory, hooks
├── enclave/         # TEE boundary — isolated, minimal deps
├── mcp/             # MCP server + tools
├── execution/       # strategy implementations
├── risk/            # validation engine
└── core/            # shared types, logger
```

## Constraints

- **Never** add external network calls inside `src/enclave/` — the enclave module must remain dependency-minimal
- **Never** log private key material, even in dev/software mode
- **Always** run `bun run lint` before opening a PR — strict TypeScript is enforced
- New MCP tools must include a test in `tests/unit/mcp-tools.test.ts`

## Pull Request Process

1. Fork → feature branch → PR against `main`
2. Include tests for any new MCP tool or strategy
3. Update `ARCHITECTURE.md` if you change component boundaries
4. One approval required to merge

## License

By contributing, you agree your code is licensed under AGPL-3.0.
