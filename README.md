# Savantis Memory for Paperclip

Native Paperclip plugin that connects configured companies to Savantis Memory, with separate OAuth credentials for each company. It contributes a connection/status page and three company-scoped agent tools:

- `policy` reads `savantis_get_memory_policy`.
- `recall` reads policy first, then recalls relevant data and marks it untrusted.
- `retain` reads policy, proposes one distilled memory, enforces confirmation and credential guards, waits a bounded time for durable storage, then links it to the private `Paperclip` Space.

It does not copy memory history into Paperclip, retain transcripts automatically, or infer new memories. Agent role instructions decide when recall and retention are useful.

## Install

Requires a Paperclip instance with plugins enabled, Node.js 24.11 or later, and a Savantis Memory account. Built against `@paperclipai/plugin-sdk@2026.916.1`; Paperclip's plugin API is still alpha.

In Paperclip's **Plugin Manager**, select **Install Plugin** and enter:

```text
paperclip-plugin-savantis-memory
```

The npm package includes the compiled manifest, worker, UI and MCP bridge. The worker's dependencies are bundled; no build step is needed on the Paperclip host.

For development from source:

```sh
git clone https://github.com/mrKlar/paperclip-plugin-savantis-memory.git
cd paperclip-plugin-savantis-memory
npm ci
npm test
npm run build
```

The artifacts are `dist/manifest.js`, `dist/worker.js`, `dist/ui/index.js`, and `dist/bridge.mjs`. A source checkout can also be installed with Paperclip's local-plugin installer after building. Paperclip manages the worker; the optional bridge runs as a CLI's MCP stdio subprocess.

## Connect a company

Configure these required instance settings:

```json
{
  "companyId": "<paperclip-company-uuid>",
  "publicBaseUrl": "https://paperclip.example/NIC"
}
```

`publicBaseUrl` is the browser-reachable Paperclip company URL (origin plus company prefix). HTTPS is required, except for HTTP on `localhost`, `127.0.0.1` or `[::1]` during local development. OAuth returns to the stable page route declared by the plugin:

```text
https://paperclip.example/NIC/savantis-memory
```

Open the **Savantis Memory** page and use its connection button. The plugin dynamically registers that exact redirect URI with Savantis and requests `context:read context:write` with Authorization Code + PKCE S256 and public-client authentication (`none`). Complete authorization in your browser. The UI completes the callback; access and refresh tokens never cross the UI bridge.

Credentials live only at `$PAPERCLIP_HOME/plugins/paperclip.savantis-memory/credentials/<companyId>.json` when that variable is available. When the worker environment omits it, the installed bundle falls back to `private/credentials/<companyId>.json` in the plugin directory. Each company has its own tokens and pending authorization state. The plugin creates the private directory with mode `0700`, writes the file atomically with mode `0600`, and never puts credentials in Paperclip plugin state, config, UI responses, or logs. Keep that directory writable and persistent across host upgrades. Legacy unscoped credentials are not imported; connect each company through its page.

Requests use the Savantis service at `https://context.savantisai.com/mcp`. Queries and memories you submit are sent to that service. The plugin itself makes no model calls, starts no background AI jobs, and has no polling schedule; agent runs and Savantis usage follow their respective account limits.

## MCP stdio bridge

Agents whose CLI does not receive native Paperclip tools can run:

```sh
node /absolute/path/to/installed/package/dist/bridge.mjs
```

The bridge exposes only `savantis_memory_policy`, `savantis_memory_recall`, and `savantis_memory_retain`. It relays them to Paperclip's authenticated `/api/plugins/tools/execute` endpoint; it never talks to Savantis directly.

Required per-run environment:

- `PAPERCLIP_API_URL`
- `PAPERCLIP_API_KEY` (the Paperclip run JWT, never a global standalone token)
- `PAPERCLIP_AGENT_ID`
- `PAPERCLIP_RUN_ID`
- `PAPERCLIP_COMPANY_ID`
- `PAPERCLIP_TASK_ID` for assigned work; the bridge resolves its project from the issue
- `PAPERCLIP_MEMORY_PROJECT_ID` only as the fallback for a role chat without a task

The configured company boundary is checked again inside every native tool and OAuth/status action. Unknown policy modes fail closed. Sensitive memories and any proposal that Savantis marks as requiring confirmation are blocked unless the caller supplies `confirmed: true`. Agents must set that flag only after the user explicitly approves the exact memory. The flag is a caller attestation; this plugin does not independently authenticate human approval. Use only trusted agents, and disable retention in Savantis if you require a separate human approval boundary. Obvious passwords, API keys, bearer tokens, refresh tokens, client secrets, and private keys are rejected before any storage call.

Pending Savantis operations are polled three times by default. If they remain pending, the tool returns `status: "pending"` with the operation ID and creates no Space link. A failed or malformed durable retain also creates no link.

## License

Copyright © 2026 Savantis. All rights reserved. This public release does not grant a reuse license for the plugin source. Bundled dependencies retain their own licenses, reproduced in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
