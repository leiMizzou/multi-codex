#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const {
  WEB_DEFAULT_PORT,
  collectAccountStatuses,
  copyCurrentAuth,
  createAccount,
  deleteAccount,
  formatBytes,
  formatDateTime,
  formatEnvExport,
  formatNumber,
  getAccountPaths,
  getProjectHome,
  runCodexForAccount,
  spawnShellForAccount,
} = require("../lib/core");
const { openUrl, startDashboardServer } = require("../lib/server");

function printHelp() {
  console.log(`multi-codex

Usage:
  multi-codex dashboard [--json] [--fast]
  multi-codex list [--json] [--fast]
  multi-codex add <name>
  multi-codex remove <name>
  multi-codex import-current <name> [--source <codex_home>]
  multi-codex env <name> [--shell <sh|fish|pwsh>]
  multi-codex login <name>
  multi-codex logout <name>
  multi-codex shell <name>
  multi-codex exec <name> -- <command...>
  multi-codex where <name>
  multi-codex web [--host <host>] [--port <port>] [--fast] [--open]

Notes:
  - Each account uses its own CODEX_HOME under this project.
  - Remote quota/plan usage is not exposed by Codex locally; localTokens is derived from local session logs.
  - Project home: ${getProjectHome()}
`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "dashboard";

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "add") {
    const name = args[1];
    if (!name) {
      throw new Error("Usage: multi-codex add <name>");
    }
    const created = await createAccount(name);
    console.log(`Created account '${created.slug}'`);
    console.log(`CODEX_HOME: ${created.homeDir}`);
    console.log(`Next: ${path.relative(process.cwd(), __filename)} login ${created.slug}`);
    return;
  }

  if (command === "remove" || command === "rm" || command === "delete") {
    const name = args[1];
    if (!name) {
      throw new Error("Usage: multi-codex remove <name>");
    }
    const removed = await deleteAccount(name);
    console.log(`Removed account '${removed.slug}'`);
    return;
  }

  if (command === "import-current") {
    const name = args[1];
    if (!name) {
      throw new Error("Usage: multi-codex import-current <name> [--source <codex_home>]");
    }
    const sourceIndex = args.indexOf("--source");
    const sourceHome =
      sourceIndex >= 0 && args[sourceIndex + 1] ? args[sourceIndex + 1] : undefined;
    const result = await copyCurrentAuth(name, { sourceHome });
    console.log(`Imported current auth into '${result.slug}'`);
    console.log(`Copied: ${result.copied.length > 0 ? result.copied.join(", ") : "(nothing found)"}`);
    console.log(`Source: ${result.sourceHome}`);
    console.log(`Target: ${result.homeDir}`);
    return;
  }

  if (command === "dashboard" || command === "list" || command === "status") {
    const json = args.includes("--json");
    const fast = args.includes("--fast");
    const statuses = await collectAccountStatuses({ deep: !fast });
    if (json) {
      console.log(JSON.stringify(statuses, null, 2));
      return;
    }
    printDashboard(statuses, { fast });
    return;
  }

  if (command === "env" || command === "use") {
    const name = args[1];
    if (!name) {
      throw new Error("Usage: multi-codex env <name> [--shell <sh|fish|pwsh>]");
    }
    const shellIndex = args.indexOf("--shell");
    const shell = shellIndex >= 0 ? args[shellIndex + 1] : undefined;
    console.log(formatEnvExport(name, { shell }));
    return;
  }

  if (command === "login") {
    const name = args[1];
    if (!name) {
      throw new Error("Usage: multi-codex login <name>");
    }
    runCodexForAccount(name, ["login"]);
    return;
  }

  if (command === "logout") {
    const name = args[1];
    if (!name) {
      throw new Error("Usage: multi-codex logout <name>");
    }
    runCodexForAccount(name, ["logout"]);
    return;
  }

  if (command === "shell") {
    const name = args[1];
    if (!name) {
      throw new Error("Usage: multi-codex shell <name>");
    }
    await spawnShellForAccount(name);
    return;
  }

  if (command === "exec") {
    const name = args[1];
    if (!name) {
      throw new Error("Usage: multi-codex exec <name> -- <command...>");
    }
    const separator = args.indexOf("--");
    const cmdArgs = separator >= 0 ? args.slice(separator + 1) : args.slice(2);
    if (cmdArgs.length === 0) {
      throw new Error("Usage: multi-codex exec <name> -- <command...>");
    }

    const account = getAccountPaths(name);
    const result = spawnSync(cmdArgs[0], cmdArgs.slice(1), {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CODEX_HOME: account.homeDir,
      },
      stdio: "inherit",
    });

    if (result.error) {
      throw result.error;
    }
    process.exitCode = result.status ?? 0;
    return;
  }

  if (command === "where") {
    const name = args[1];
    if (!name) {
      throw new Error("Usage: multi-codex where <name>");
    }
    const paths = getAccountPaths(name);
    console.log(`slug:      ${paths.slug}`);
    console.log(`account:   ${paths.dir}`);
    console.log(`CODEX_HOME:${paths.homeDir}`);
    console.log(`auth:      ${paths.authPath}`);
    console.log(`config:    ${paths.configPath}`);
    return;
  }

  if (command === "web" || command === "serve") {
    const hostIndex = args.indexOf("--host");
    const portIndex = args.indexOf("--port");
    const open = args.includes("--open");
    const fast = args.includes("--fast");
    const host = hostIndex >= 0 ? args[hostIndex + 1] : "127.0.0.1";
    const port = portIndex >= 0 ? Number(args[portIndex + 1]) : WEB_DEFAULT_PORT;
    const started = await startDashboardServer({
      deepDefault: !fast,
      host,
      port,
    });
    console.log(`multi-codex dashboard listening on ${started.url}`);
    if (open) {
      openUrl(started.url);
    }
    console.log("Press Ctrl+C to stop.");
    await new Promise(() => {});
    return;
  }

  throw new Error(`Unknown command '${command}'. Run 'multi-codex help'.`);
}

function printDashboard(statuses, options = {}) {
  if (statuses.length === 0) {
    console.log("No accounts yet.");
    console.log("Start with: multi-codex add <name>");
    return;
  }

  const rows = statuses.map((status) => ({
    account: status.slug,
    status: status.health?.label || (status.auth.loggedIn ? "logged-in" : "empty"),
    mode: status.auth.authMode || "-",
    plan: status.auth.planType || "-",
    accessExp: shortDate(status.auth.accessTokenExpiresAt),
    subUntil: shortDate(status.auth.subscriptionActiveUntil),
    localTokens: options.fast ? "-" : formatNumber(status.usage.localTotalTokens),
    sessions: formatNumber(status.usage.sessionFiles),
    updated: shortDate(status.health?.lastUpdatedAt || status.meta.updatedAt || status.usage.latestActivityAt),
  }));

  renderTable(rows, [
    ["account", "ACCOUNT"],
    ["status", "STATUS"],
    ["mode", "MODE"],
    ["plan", "PLAN"],
    ["accessExp", "ACCESS EXP"],
    ["subUntil", "SUB UNTIL"],
    ["localTokens", "LOCAL TOKENS"],
    ["sessions", "SESSIONS"],
    ["updated", "UPDATED"],
  ]);

  console.log("");
  for (const status of statuses) {
    console.log(`${status.slug}`);
    console.log(`  home: ${status.homeDir}`);
    console.log(`  state: ${status.health?.label || "-"}`);
    console.log(`  accountId: ${status.auth.accountId || "-"}`);
    console.log(`  lastRefresh: ${formatDateTime(status.auth.lastRefresh)}`);
    console.log(`  subscriptionChecked: ${formatDateTime(status.auth.subscriptionLastChecked)}`);
    console.log(`  history: ${formatBytes(status.usage.historyBytes)}${status.usage.historyLines === null ? "" : `, ${formatNumber(status.usage.historyLines)} lines`}`);
    console.log(`  usage: localTokens=${formatNumber(status.usage.localTotalTokens)}, tokenFiles=${formatNumber(status.usage.tokenFileCount)}, latestActivity=${formatDateTime(status.usage.latestActivityAt)}`);
  }

  console.log("");
  console.log("Remote quota/remaining usage is not exposed by Codex local auth. localTokens is summed from local session logs only.");
}

function renderTable(rows, columns) {
  const widths = columns.map(([key, label]) => {
    const values = rows.map((row) => String(row[key] ?? ""));
    return Math.max(label.length, ...values.map((value) => value.length));
  });

  const header = columns
    .map(([, label], index) => label.padEnd(widths[index]))
    .join("  ");
  const divider = widths.map((width) => "-".repeat(width)).join("  ");

  console.log(header);
  console.log(divider);

  for (const row of rows) {
    const line = columns
      .map(([key], index) => String(row[key] ?? "").padEnd(widths[index]))
      .join("  ");
    console.log(line);
  }
}

function shortDate(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return String(value);
  }
  return date.toISOString().replace("T", " ").replace(".000Z", "Z");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
