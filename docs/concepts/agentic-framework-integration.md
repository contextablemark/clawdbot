# Agentic Framework Integration Research

Research into integrating OpenClaw with external agentic frameworks (Mastra, LangChain, AG2, CrewAI, Google ADK, etc.) via the A2A and AG-UI protocol ecosystem.

## Current State

### Existing Integration Points

- **ACP (Agent Client Protocol)** — Bridges external clients (IDEs) to OpenClaw agents via `src/acp/translator.ts`. Bridges *inward*.
- **AG-UI** — Already implemented via Contextable/clawg-ui. Provides standardized event-based frontend connectivity.
- **A2UI** — Vendored at `vendor/a2ui/` (v0.8). Lit renderer bundled and served to mobile/macOS Canvas nodes. Infrastructure is complete but agents do not currently generate A2UI payloads.
- **MCP** — Supported via `skills/mcporter/` for calling external tool servers.
- **Multi-agent primitives** — `sessions_send`, `sessions_spawn`, `agents_list` tools provide first-class inter-agent communication within OpenClaw.

### What Does NOT Exist

- No A2A (Agent-to-Agent) protocol support
- No direct integration with Mastra, LangChain, AG2, CrewAI, or Google ADK
- No mechanism for external agents built on other frameworks to discover or call OpenClaw agents
- No mechanism for OpenClaw agents to delegate to external framework agents

## Protocol Landscape (2025-2026)

| Layer | Protocol | Role | Status |
|-------|----------|------|--------|
| Agent-to-Agent | **A2A** | Inter-agent discovery and collaboration | v0.3, Linux Foundation, 150+ orgs |
| Agent-to-Tool | **MCP** | Tool/context access | Supported in OpenClaw |
| Agent-to-Frontend | **AG-UI** | Real-time event-based UI streaming | Implemented via clawg-ui |
| UI Specification | **A2UI** | Declarative component descriptions | v0.8 vendored, infrastructure ready |

## A2A Integration Analysis

### A2A Server (OpenClaw as a callable agent)

Making OpenClaw discoverable and callable in the A2A ecosystem. This is the highest-leverage opportunity.

**What it would expose:**
- Multi-channel delivery (Discord, Slack, WhatsApp, Telegram, etc.)
- Persistent session management
- Multi-agent orchestration
- A2UI generation (when agents support it)

**Implementation approach:**
- Publish an Agent Card at `/.well-known/agent-card.json`
- Implement `message/send` and `message/stream` JSON-RPC endpoints
- Translate between A2A tasks and Gateway sessions (similar to ACP translator pattern)
- Advertise A2UI extension for UI-capable clients

**A2UI over A2A:**
The predominant A2UI architecture uses A2A as transport. A2UI messages travel as `DataPart` objects with MIME type `application/json+a2ui`. The A2UI extension (`https://a2ui.org/a2a-extension/a2ui/v0.8`) is negotiated via A2A's extension mechanism, with graceful fallback to text-only for non-UI clients.

Reference implementation: [CopilotKit/with-a2a-a2ui](https://github.com/CopilotKit/with-a2a-a2ui)

### A2A Client (OpenClaw calling external agents)

Letting OpenClaw agents delegate to agents built on other frameworks.

**The second-class citizen problem:**
A simple `a2a_call` tool would not participate in OpenClaw's first-class agent interop:
- No session key identity (invisible to routing)
- No sub-agent registry entry (no lifecycle tracking)
- Not in `agents_list` (not discoverable by other agents)
- No lane classification, no persistence, no announce flow

**First-class integration options:**

1. **Remote agent backend** — Add a `backend: a2a` agent type to config. The gateway's `agent` method branches: local agents run LLM pipeline, A2A agents proxy to remote endpoints. Session keys, lifecycle tracking, and `sessions_send`/`sessions_spawn` all work normally.

2. **Protocol-aware `sessions_send`** — When resolving a target agent configured with `backend: a2a`, translate outgoing messages to A2A `message/send` or `message/stream` and map responses back. Less invasive than option 1.

Both require core gateway changes — the plugin SDK deliberately does not expose agent registration or session routing.

## A2UI Opportunity

### Current Gap

A2UI infrastructure is complete but dormant:
- `canvas.a2ui_push` tool exists but agents aren't instructed to use it
- System prompt mentions canvas generically but not A2UI capabilities
- No example agents generate A2UI payloads
- Only Canvas on mobile/macOS supports A2UI rendering (messaging channels do not)

### Potential Directions

1. **A2UI relay** — OpenClaw as A2A server receives A2UI from external agents and relays it to Canvas nodes. OpenClaw doesn't need to generate A2UI itself.

2. **Agent-generated A2UI** — Requires system prompt updates, A2UI schema/examples in agent context, and a product decision about Canvas as a primary interaction surface vs. diagnostic sidecar.

3. **A2UI as A2A differentiator** — When external A2A clients discover OpenClaw, A2UI support advertised in the AgentCard provides rich UI capabilities that text-only agents can't match.

## Recommended Priority

1. **A2A Server** — Makes OpenClaw callable by the broader agent ecosystem. Unique value proposition: multi-channel delivery + persistent sessions + A2UI rendering.
2. **A2A Client (first-class)** — Remote agent backend or protocol-aware `sessions_send`. Requires core changes but avoids second-class tooling.
3. **A2UI activation** — Separate product decision about whether Canvas becomes a primary generative UI surface.

## References

- [A2A Protocol Specification](https://a2a-protocol.org/latest/specification/)
- [A2UI Specification v0.8](https://a2ui.org/specification/v0.8-a2ui/)
- [A2UI A2A Extension](https://a2ui.org/specification/v0.8-a2a-extension/)
- [AG-UI Documentation](https://docs.ag-ui.com/)
- [CopilotKit A2A+A2UI Reference](https://github.com/CopilotKit/with-a2a-a2ui)
- [A2A + MCP + AG-UI Comparison](https://a2aprotocol.ai/docs/guide/a2a-mcp-ag-ui)
