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

## Web dashboard

The web dashboard is the main control surface for this project. It supports:

- creating an empty account slot
- importing the current `~/.codex` session into a named slot
- opening ChatGPT, account settings, and Codex usage pages
- launching either `codex login` or a proxy-backed `codex` session per slot
- saving per-slot labels for `team`, `subscription`, `owner/auth`, and notes
- testing a proxy before launch
- optionally starting a local proxy command in a terminal
- removing slots you no longer need
- copying shell, login, status, and launch commands per account

### Dashboard proxy setup

Proxy settings live in the dashboard and are stored in:

```text
accounts/_project/launch.json
```

That file is ignored by git. It may contain a saved API key, so treat it as local machine state.

Use the proxy panel in the dashboard like this:

1. Start the dashboard with `./bin/multi-codex.js web --open`.
2. In `Proxy routing`, choose `OPENAI_BASE_URL` or `Custom provider`.
3. Fill in the base URL.
4. For `Custom provider`, also fill in `Provider ID` and `Env key`.
5. If the proxy needs a direct API key, paste it into `API key`.
6. If you want the dashboard to start the proxy for you, fill in `Local start command` and optionally `Local start cwd`.
7. Click `Save proxy`.
8. Click `Test proxy`.
9. Open a slot and use `Launch Codex`.

Notes:

- `OPENAI_BASE_URL` mode is the lightest option when the built-in OpenAI provider should talk to a router or data-residency endpoint.
- `Custom provider` mode injects `model_provider` and `model_providers.<id>.*` overrides with `wire_api="responses"`. This is the mode for OpenAI-compatible reverse proxies such as CLIProxyAPI.
- If the saved proxy config can authenticate through an API key, the launch button opens `codex` directly and does not require slot-local ChatGPT login state.
- The dashboard does not expose `temperature`, `top_p`, or `top_k` for Codex launches.

Example values for a local CLIProxyAPI install:

```text
Mode:         Custom provider
Base URL:     http://127.0.0.1:8317
Provider ID:  cliproxyapi
Env key:      OPENAI_API_KEY
Start cmd:    /opt/homebrew/bin/brew services start cliproxyapi
```

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
- interactive launches default to `--dangerously-bypass-approvals-and-sandbox`, `-m gpt-5.4`, `-c 'model_reasoning_effort="xhigh"'`, and `-c 'tui.status_line=["model-with-reasoning","current-dir","five-hour-limit","weekly-limit","used-tokens"]'`
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
