# multi-codex

`multi-codex` is a local wrapper around Codex that keeps one `CODEX_HOME` per account. It does not modify your current `~/.codex` unless you explicitly import from it.

## What it solves

- Keep multiple Codex/ChatGPT logins cached locally at the same time
- Switch accounts without overwriting the current `auth.json`
- Inspect each account's local auth state, plan metadata, refresh times, and local session usage
- View all connected accounts at once in a local web dashboard

## Limits

- Codex currently stores one active login per `CODEX_HOME`
- Codex does not expose remote remaining quota/plan usage locally
- The dashboard's `localTokens` field is computed from local session logs under each account home, not from OpenAI billing APIs

## Layout

By default this project stores accounts here:

```text
accounts/<slug>/
  meta.json
  home/
    auth.json
    config.toml
    history.jsonl
    sessions/
accounts/_project/
  launch.json
```

Each `home/` directory is used as that account's `CODEX_HOME`.
`accounts/_project/` is reserved for local dashboard launch settings and is ignored by git.

## Quick start

```bash
cd multi-codex
chmod +x ./bin/multi-codex.js
./bin/multi-codex.js add team-a
./bin/multi-codex.js login team-a
./bin/multi-codex.js dashboard
```

If you already have a working login in `~/.codex`, import it into a named account:

```bash
./bin/multi-codex.js import-current personal
./bin/multi-codex.js web --open
```

## Common commands

Show the dashboard:

```bash
./bin/multi-codex.js dashboard
```

Fast mode skips session log token parsing:

```bash
./bin/multi-codex.js dashboard --fast
```

Start the local web dashboard:

```bash
./bin/multi-codex.js web --open
```

The web dashboard now supports:

- creating an empty account slot
- importing the current `~/.codex` session into a named slot
- opening ChatGPT, account settings, and Codex usage pages from the dashboard
- launching either a per-slot `codex login` terminal window or a proxy-backed `codex` terminal window
- saving per-slot labels for `team`, `subscription`, `owner/auth`, and notes
- saving project-local proxy/router launch settings for `OPENAI_BASE_URL` or a custom `model_provider`
- testing the current proxy settings from the dashboard before launching Codex
- saving an optional local proxy start command and launching it in a terminal from the dashboard
- removing a slot you no longer need
- copying login, shell, env, and status commands per account

Dashboard proxy routing:

- Proxy settings are edited in the web dashboard and stored under `accounts/_project/launch.json`.
- `OPENAI_BASE_URL` mode is the lightest option when the built-in OpenAI provider should talk to a router or data-residency endpoint.
- `Custom provider` mode injects `model_provider` and `model_providers.<id>.*` overrides with `wire_api="responses"`, which matches OpenAI-compatible reverse proxies such as CLIProxyAPI.
- `Local start command` is optional and lets the dashboard open a terminal and start your proxy process before you launch Codex.
- The dashboard does not expose `temperature`, `top_p`, or `top_k` for Codex launches.
- If the saved proxy config can authenticate through an API key, the launch button opens `codex` directly and does not require the slot itself to be logged in.

## VS Code extension

This project now also includes a local VS Code extension manifest.

What the extension does:

- shows every saved slot in a VS Code sidebar webview
- displays online state, 5-hour quota, weekly quota, and subscription expiry
- shows quota reset times for both the 5-hour and weekly windows
- can run in its own extension-managed storage, without the web server and without a separate multi-codex project directory
- lets you pick an active slot without typing login commands again
- `Use + Open` always launches a fresh `codex` session for that slot
- launches `codex` or `codex login` in a VS Code integrated terminal with that slot's `CODEX_HOME`
- can resume the active slot directly with `codex resume --all` from the sidebar or command palette
- when you switch the active slot, VS Code terminal environment defaults are updated so newly opened terminals inherit that slot's `CODEX_HOME`
- can route interactive Codex launches through an external proxy via `OPENAI_BASE_URL` or a custom `model_provider` that uses the Responses API
- interactive launches default to `--dangerously-bypass-approvals-and-sandbox`, `-m gpt-5.4`, `-c 'model_reasoning_effort="xhigh"'`, `-c 'service_tier="fast"'`, and `-c 'tui.status_line=["model-with-reasoning","current-dir","five-hour-limit","weekly-limit","used-tokens"]'` unless you override the extension settings
- the toolbar can toggle `5h left` sorting between ascending and descending, and the chosen order is stored globally
- opens those terminals in the editor area by default, as top tabs beside the active editor
- supports three sidebar display modes: `Minimal`, `Standard`, and `Detailed`
- supports one-click `Use + Open` / `Use + Login` per slot, plus `Quick Launch Slot` from the command palette
- refreshes automatically every 6 hours by default, with manual refresh for immediate quota updates
- lets you create slots, import the current `~/.codex` login, and delete slots directly inside the extension

Important boundary:

- the extension can switch the slot used for the terminals it launches
- it does not hot-swap an already-running Codex process or privately control the official OpenAI extension internals

Package the extension locally:

```bash
cd multi-codex
npm run package:extension
```

Install the generated `.vsix`:

```bash
code --install-extension local-tools.multi-codex-0.1.0.vsix --force
```

The extension will auto-detect an existing account store first and otherwise fall back to its own local storage.

To force the extension into its own local storage, run:

```text
Multi Codex: Use Extension Storage
```

If you want to point it at an existing account store instead, run:

```text
Multi Codex: Select Project Home
```

Then point it at the folder that contains `accounts/`, at an existing multi-codex project root, or at an empty directory that should become a new store.

External proxy / router support:

- `multiCodex.proxyMode = "openaiBaseUrl"` sets `OPENAI_BASE_URL` for extension-launched Codex terminals. This is the lightest option when the built-in OpenAI provider should talk to a router or data-residency endpoint.
- `multiCodex.proxyMode = "customProvider"` injects `-c model_provider=...` and `-c model_providers.<id>.*` overrides with `wire_api="responses"`. This is the mode to use for OpenAI-compatible reverse proxies such as CLIProxyAPI.
- `Multi Codex: Set Proxy API Key` stores an optional proxy key in VS Code Secret Storage. If no key is stored, Codex must find the relevant API key env var from the surrounding environment.
- In `customProvider` mode, `Use + Open` does not require the slot itself to be logged in, because the launch can authenticate through the configured proxy API key instead.

Example settings for CLIProxyAPI:

```json
{
  "multiCodex.proxyMode": "customProvider",
  "multiCodex.proxyBaseUrl": "http://127.0.0.1:8317",
  "multiCodex.proxyProviderId": "cliproxyapi",
  "multiCodex.proxyEnvKey": "OPENAI_API_KEY"
}
```

Recommended capture flow for multiple teams/subscriptions:

1. Create a slot named after the team or subscription you want to preserve.
2. Open ChatGPT or Settings from the dashboard and manually switch to that target team/subscription.
3. On that slot card, click the launch button. In normal mode it opens `codex login`; with proxy routing it opens `codex` using the saved router settings.
4. Save `team`, `subscription`, `owner/auth`, and notes on the slot card.
5. Refresh the dashboard. That slot remains isolated and will aggregate alongside your other saved slots.

Use a cheaper status scan for the web API:

```bash
./bin/multi-codex.js web --fast
```

Output shell exports for the current account:

```bash
eval "$(./bin/multi-codex.js env personal)"
echo "$CODEX_HOME"
```

Run Codex under a specific account without switching your shell:

```bash
./bin/multi-codex.js exec personal -- codex login status
./bin/multi-codex.js exec personal -- codex
```

Remove an account directory you no longer need:

```bash
./bin/multi-codex.js remove personal
```

Open a subshell with the account activated:

```bash
./bin/multi-codex.js shell personal
```

## Installing as a command

From this project directory:

```bash
npm link
multi-codex dashboard
```

## Development

Run tests:

```bash
npm test
```
