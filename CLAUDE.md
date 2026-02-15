# CLAUDE.md

This file provides context for AI agents working on the OpenClaw codebase.

## Project Overview

OpenClaw is an open-source AI agent gateway and CLI that connects language models to messaging channels (WhatsApp, Telegram, Discord, Slack, Signal, SMS, etc.), tools, and skills. It runs as a gateway server that routes messages between users and AI agents.

## Tech Stack

- **Runtime**: Node.js >= 22.12.0
- **Package manager**: pnpm 10.23.0
- **Language**: TypeScript (strict mode, ES2023 target, NodeNext modules)
- **Test framework**: Vitest 4.x (process forking pool)
- **Linting**: oxlint (with unicorn, typescript, oxc plugins)
- **Formatting**: oxfmt (with experimental import sorting)
- **UI**: Lit 3.3.2 with legacy decorators (`experimentalDecorators: true`)
- **Bundling**: tsdown + Rolldown

## Repository Structure

```
src/            # Core source (gateway, agents, channels, routing, CLI, etc.)
extensions/     # Channel plugins and feature plugins (whatsapp, telegram, voice-call, telephony, etc.)
ui/             # Control UI (Lit web components)
apps/           # Native apps (macOS, iOS, Android)
docs/           # Documentation site
skills/         # Skills directory
packages/       # Shared packages
test/           # Test setup and shared test utilities
scripts/        # Build and utility scripts
vendor/         # Vendored dependencies
```

## Key Commands

### Build & Check (run before PRs)
```bash
pnpm build && pnpm check && pnpm test
```

### Individual Commands
```bash
pnpm build          # Build everything (tsdown + plugin SDK DTS + canvas + build info)
pnpm check          # Format check + type check (tsgo) + lint (oxlint)
pnpm lint           # oxlint only
pnpm format         # oxfmt auto-fix
pnpm test           # All tests (parallel via scripts/test-parallel.mjs)
pnpm test:fast      # Unit tests only (vitest run --config vitest.unit.config.ts)
```

### Extension-Specific Tests
```bash
# Run tests for a specific extension
pnpm vitest run --config vitest.extensions.config.ts extensions/telephony

# Watch mode
pnpm vitest --config vitest.extensions.config.ts extensions/telephony
```

### Development
```bash
pnpm dev            # Development server
pnpm gateway:dev    # Gateway dev mode
pnpm gateway:watch  # Watch mode for gateway
pnpm tui            # TUI interface
pnpm ui:dev         # UI development server
```

## Testing Conventions

- **Framework**: Vitest with `describe`/`it` blocks
- **File naming**: `.test.ts` suffix, colocated with source files
- **Imports**: `import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";`
- **Test timeout**: 120 seconds (180s on Windows)
- **Coverage target**: 70% lines/functions/statements, 55% branches (core src/)
- **Extensions**: Excluded from coverage enforcement but should have tests
- **Config files**:
  - `vitest.config.ts` — base config
  - `vitest.unit.config.ts` — unit tests (excludes extensions)
  - `vitest.extensions.config.ts` — extension tests only
  - `vitest.e2e.config.ts` — end-to-end tests
  - `vitest.gateway.config.ts` — gateway tests

### Test Patterns
```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("feature", () => {
  it("should do something", () => {
    expect(result).toBe(expected);
  });
});
```

- Use `vi.fn()` for mocks, `vi.mock()` for module mocks
- Use `beforeEach`/`afterEach` for env var cleanup
- Save and restore `process.env` when testing env-based config

## Code Style & Lint Rules

- **Formatter**: oxfmt (NOT Prettier) — run `pnpm format` to auto-fix
- **Linter**: oxlint (NOT ESLint) — run `pnpm lint`
- **Import sorting**: Automatic via oxfmt `experimentalSortImports`
- **Key rules**:
  - `typescript/no-explicit-any`: error
  - `curly`: error (always use braces for control flow)
  - Correctness, perf, and suspicious categories are all errors
- **Extensions directory is excluded from oxlint** (see `.oxlintrc.json` ignorePatterns)
- No semicolons enforcement — the codebase uses semicolons consistently
- Use `type` imports for type-only imports: `import type { Foo } from "./bar.js";`

## TypeScript Configuration

- **Strict mode**: enabled
- **Module**: NodeNext (use `.js` extensions in imports even for `.ts` files)
- **Target**: ES2023
- **Path aliases**:
  - `openclaw/plugin-sdk` → `src/plugin-sdk/index.ts`
  - `openclaw/plugin-sdk/*` → `src/plugin-sdk/*.ts`
- **Legacy decorators**: enabled for Lit UI components (`experimentalDecorators: true`)

## Extension/Plugin Architecture

Extensions live in `extensions/<name>/` and follow this pattern:

### Package Structure
```
extensions/<name>/
├── index.ts                  # Plugin entry point (default export)
├── package.json              # { "openclaw": { "extensions": ["./index.ts"] } }
├── openclaw.plugin.json      # Plugin manifest with config schema
├── src/
│   ├── config.ts             # Zod config schemas
│   ├── channel.ts            # ChannelPlugin implementation (if channel)
│   ├── providers/            # Multi-provider abstraction (if applicable)
│   └── *.test.ts             # Colocated tests
└── README.md                 # Optional
```

### Plugin Entry Point
```typescript
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

const plugin = {
  id: "my-plugin",
  name: "My Plugin",
  description: "...",
  configSchema: { parse(value) { ... } },
  register(api: OpenClawPluginApi) {
    // api.registerChannel({ plugin }) — register a channel
    // api.registerTool({ name, parameters, execute }) — register an agent tool
    // api.registerGatewayMethod(name, handler) — register RPC method
    // api.registerCli(({ program }) => { ... }) — register CLI commands
    // api.registerService({ id, start, stop }) — register lifecycle service
  },
};
export default plugin;
```

### Channel Plugin Interface
Channels implement `ChannelPlugin<T>` with adapters for:
- `config` — account resolution, enable/disable, describe
- `security` — DM policy resolution
- `pairing` — `{ idLabel }` for the shared pairing store
- `outbound` — `sendText()`, `sendMedia()`, chunking
- `setup` — account configuration
- `status` — runtime state
- `gateway` — start/stop account
- `messaging` — target normalization

### package.json Pattern
```json
{
  "name": "@openclaw/<name>",
  "version": "2026.2.15",
  "private": true,
  "type": "module",
  "devDependencies": { "openclaw": "workspace:*" },
  "openclaw": { "extensions": ["./index.ts"] }
}
```

## Channel Pairing System

OpenClaw has a shared pairing store (`src/pairing/pairing-store.ts`) that all channels use:

1. Channel declares `pairing: { idLabel: "phoneNumber" }` in its plugin
2. Unknown sender triggers pairing — generates 8-char alphanumeric code
3. Admin approves via `openclaw pairing approve <channel> <code>`
4. Sender is added to the allow-from list
5. Optional `notifyApproval` callback sends confirmation

Pairing codes expire after 60 minutes. Max 3 pending per channel.

## Key Patterns to Follow

### Multi-Provider Abstraction (see `extensions/voice-call/`, `extensions/telephony/`)
- Define a provider interface in `providers/base.ts`
- Concrete implementations per provider (e.g., `twilio.ts`, `telnyx.ts`, `plivo.ts`)
- Config selects active provider; env vars fall back for credentials
- Mock provider for development/testing

### Config with Zod + Env Var Resolution
- Define schemas with Zod in `config.ts`
- `resolveFooConfig()` merges env vars into missing fields
- `validateProviderConfig()` checks required fields per provider
- Config lives under `channels.<id>` for channels, `plugins.entries.<id>.config` for plugins

### Webhook Server Pattern
- HTTP server for inbound webhooks from external services
- Per-provider signature verification (HMAC-SHA1/SHA256, Ed25519)
- Normalized event types for cross-provider abstraction
- Configurable port/bind/path with tunnel support (ngrok, Tailscale)

## PR Guidelines

- Test locally: `pnpm build && pnpm check && pnpm test`
- Keep PRs focused (one thing per PR)
- Follow the PR template in `.github/pull_request_template.md`
- Commit messages: `type(scope): description` (e.g., `feat(telephony): add SMS chunker`)
- AI-assisted PRs are welcome — mark them and note testing level

## Important Files

| File | Purpose |
|------|---------|
| `src/plugin-sdk/index.ts` | Plugin SDK exports (types, helpers) |
| `src/channels/plugins/types.plugin.ts` | `ChannelPlugin` type definition |
| `src/channels/plugins/types.adapters.ts` | Channel adapter types |
| `src/pairing/pairing-store.ts` | Shared channel pairing store |
| `src/gateway/server/ws-connection/` | Gateway WebSocket connection handling |
| `src/infra/device-pairing.ts` | Device (UI client) pairing |
| `vitest.config.ts` | Base test configuration |
| `.oxlintrc.json` | Linter configuration |
| `.oxfmtrc.jsonc` | Formatter configuration |

## Common Gotchas

1. **Import extensions**: Always use `.js` extensions in TypeScript imports (NodeNext resolution)
2. **No Prettier/ESLint**: This project uses oxfmt/oxlint, not the more common Prettier/ESLint
3. **Extensions excluded from lint**: The `extensions/` directory is excluded from oxlint
4. **Legacy decorators**: The UI uses legacy TypeScript decorators — don't switch to standard decorators
5. **Plugin SDK imports**: Use `import { ... } from "openclaw/plugin-sdk"` — this resolves via tsconfig paths
6. **No SDK dependencies in providers**: Provider implementations use native `fetch()` and `crypto` — no Twilio/Telnyx/Plivo SDKs
7. **Zod for config, TypeBox for tool schemas**: Config validation uses Zod; agent tool parameter schemas use `@sinclair/typebox`
