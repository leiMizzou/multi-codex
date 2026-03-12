# multi-codex

Local multi-account Codex manager. One `CODEX_HOME` per account, with a VS Code sidebar and web dashboard to manage them all.

## Features

- **Multi-account isolation** — keep multiple Codex/ChatGPT logins cached locally without overwriting each other
- **Quota monitoring** — 5-hour window, weekly window, subscription expiry, and reset times per slot
- **Token usage tracking** — input, output, cached input, and reasoning tokens parsed from local session logs
- **Cost estimation** — estimated USD spend based on token breakdown, plus cache savings
- **Proxy routing** — launch Codex through `OPENAI_BASE_URL` or a custom `model_provider` (e.g. CLIProxyAPI)
- **VS Code extension** — sidebar with slot switching, one-click launch/resume, quota sorting, and three view modes
- **Web dashboard** — full control surface with proxy config, slot labels, and launch commands

## Quick start

```bash
cd multi-codex
chmod +x ./bin/multi-codex.js

# Create a slot and log in
./bin/multi-codex.js add team-a
./bin/multi-codex.js login team-a

# Or import an existing ~/.codex session
./bin/multi-codex.js import-current personal

# Open the web dashboard
./bin/multi-codex.js web --open
```

## CLI commands

| Command | Description |
|---------|-------------|
| `add <name>` | Create a new account slot |
| `remove <name>` | Delete a slot (aliases: `rm`, `delete`) |
| `import-current <name>` | Import current `~/.codex` auth into a slot |
| `login <name>` | Interactive login for a slot |
| `logout <name>` | Interactive logout for a slot |
| `dashboard` | Show all accounts with status (aliases: `list`, `status`) |
| `dashboard --fast` | Skip session log parsing for faster output |
| `dashboard --json` | Output raw JSON |
| `web` | Start web dashboard server (alias: `serve`) |
| `web --open` | Start and open in browser |
| `env <name>` | Print shell exports for a slot (alias: `use`) |
| `exec <name> -- <cmd>` | Run a command with that slot's `CODEX_HOME` |
| `shell <name>` | Spawn a subshell with the slot activated |
| `where <name>` | Show slot paths |
| `help` | Show help |

## Token usage & cost estimation

Token metrics are parsed from each slot's `sessions/*.jsonl` files. The last `token_count` event in each session provides cumulative totals:

| Metric | Description |
|--------|-------------|
| `input_tokens` | Total input tokens sent |
| `cached_input_tokens` | Input tokens served from cache (billed at 50% rate) |
| `output_tokens` | Total output tokens received |
| `reasoning_output_tokens` | Output tokens used for reasoning |
| `total_tokens` | Grand total |

Cost is estimated using these rates (per 1M tokens):

| Type | Rate |
|------|------|
| Input | $2.50 |
| Cached input | $1.25 |
| Output | $10.00 |

Token scanning always runs, regardless of the `fastScan` setting.

## Account store layout

```text
accounts/
  <slug>/
    meta.json              # Labels, team, subscription info
    home/
      auth.json            # OAuth tokens
      config.toml          # Codex config
      history.jsonl        # Command history
      sessions/            # Session logs with token_count events
  _project/
    launch.json            # Proxy settings (gitignored, may contain API key)
```

Each `home/` directory is used as that slot's `CODEX_HOME`.

## VS Code extension

### Install

```bash
npm run package:extension
code --install-extension multi-codex-0.1.1.vsix --force
```

### What it does

- Shows every slot in a sidebar webview with online state, quota, and token usage
- Three view modes: **Minimal** (compact meters), **Standard** (quota + tokens + cost), **Detailed** (full breakdown)
- **Open** launches a fresh `codex` session; **Resume** continues the latest session with `codex resume --all`
- Switch active slot from the sidebar or command palette — new terminals inherit that slot's `CODEX_HOME`
- Sort slots by 5-hour remaining quota (ascending or descending)
- Create, import, login, and delete slots directly from the sidebar
- Auto-refreshes every 6 hours; manual refresh for immediate updates
- Token usage summary at the top: total tokens, input/output/cached breakdown, estimated cost, and cache savings

### Extension commands

| Command | Description |
|---------|-------------|
| Quick Switch Slot | Pick active slot from palette |
| Quick Launch Slot | Launch codex for a slot from palette |
| Resume Active Slot | Resume latest session for active slot |
| Open Panel | Open sidebar as an editor panel |
| Create Slot | Create a new slot |
| Import Current Login | Import `~/.codex` into a slot |
| Remove Slot | Delete a slot |
| Select Project Home | Point to an existing account store |
| Use Extension Storage | Use extension-managed local storage |
| Set/Clear Proxy API Key | Manage proxy key in VS Code Secret Storage |

### Extension settings

| Setting | Default | Description |
|---------|---------|-------------|
| `projectHome` | `""` | Absolute path to account store; auto-detects or falls back to extension storage |
| `fastScan` | `true` | Skip deep history line counting (token scanning always runs) |
| `autoRefreshHours` | `6` | Sidebar auto-refresh interval in hours |
| `viewMode` | `standard` | Sidebar detail level: `minimal`, `standard`, `detailed` |
| `primarySortOrder` | `asc` | 5h quota sort direction: `asc` or `desc` |
| `activeSlot` | `""` | Globally preferred active slot |
| `codexCommand` | `codex` | Command to launch Codex |
| `proxyMode` | `off` | Proxy mode: `off`, `openaiBaseUrl`, `customProvider` |
| `proxyBaseUrl` | `""` | Base URL for proxy/router |
| `proxyProviderId` | `proxy` | Provider ID for `customProvider` mode |
| `proxyEnvKey` | `OPENAI_API_KEY` | Env var name for proxy API key |
| `defaultModel` | `gpt-5.4` | Model for interactive launches |
| `defaultReasoningEffort` | `xhigh` | Reasoning effort level |
| `bypassApprovalsAndSandbox` | `true` | Include `--dangerously-bypass-approvals-and-sandbox` |
| `terminalLocation` | `editor` | Where to open terminals: `editor` or `panel` |

### Proxy setup

**OPENAI_BASE_URL mode** — lightest option for routing through a proxy or data-residency endpoint:

```json
{
  "multiCodex.proxyMode": "openaiBaseUrl",
  "multiCodex.proxyBaseUrl": "http://127.0.0.1:8317"
}
```

**Custom provider mode** — for OpenAI-compatible reverse proxies (e.g. CLIProxyAPI):

```json
{
  "multiCodex.proxyMode": "customProvider",
  "multiCodex.proxyBaseUrl": "http://127.0.0.1:8317",
  "multiCodex.proxyProviderId": "cliproxyapi",
  "multiCodex.proxyEnvKey": "OPENAI_API_KEY"
}
```

In `customProvider` mode, slots don't need their own ChatGPT login — the proxy API key handles auth.

## Web dashboard

Start with `./bin/multi-codex.js web --open`. The dashboard supports:

- Creating, importing, and removing slots
- Saving per-slot labels (team, subscription, owner, notes)
- Token usage breakdown and cost estimation per slot and globally
- Launching `codex` or `codex login` per slot
- Proxy configuration with test and optional local start command
- Opening ChatGPT, account settings, and usage pages

### Dashboard proxy

Proxy settings are stored in `accounts/_project/launch.json` (gitignored).

1. Choose proxy mode: `OPENAI_BASE_URL` or `Custom provider`
2. Fill in base URL (and provider ID / env key for custom mode)
3. Optionally paste an API key and set a local start command
4. Save → Test → Launch

## Limits

- Codex stores one active login per `CODEX_HOME`
- The extension cannot hot-swap an already-running Codex process
- Token costs are estimates based on published pricing, not actual billing data
- `temperature`, `top_p`, and `top_k` are not exposed for Codex launches

## Development

```bash
npm test
npm run package:extension
```
