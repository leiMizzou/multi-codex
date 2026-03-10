"use strict";

const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const {
  WEB_DEFAULT_PORT,
  buildCodexLoginCommand,
  buildDashboardPayload,
  buildProjectLaunchState,
  buildProjectProxyStartCommand,
  copyCurrentAuth,
  createAccount,
  deleteAccount,
  getProjectLaunchState,
  getProjectHome,
  mergeProjectLaunchSettings,
  readProjectLaunchSettings,
  testProxyLaunchSettings,
  updateProjectLaunchSettings,
  updateAccountMeta,
} = require("./core");

const WEB_DIR = path.join(__dirname, "..", "web");
const ACCOUNT_SURFACES = {
  "chatgpt-home": "https://chatgpt.com/",
  "account-settings": "https://chatgpt.com/#settings",
  "codex-usage": "https://chatgpt.com/codex/settings/usage",
};
const STATIC_CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function createDashboardServer(options = {}) {
  const projectHome = options.projectHome || getProjectHome();
  const cache = new Map();
  const cacheTtlMs = options.cacheTtlMs ?? 6 * 60 * 60 * 1000;
  const deepDefault = options.deepDefault !== false;
  const remoteDefault = options.remote !== false;
  const launchTerminal = options.launchTerminalImpl || launchLoginInTerminal;

  return http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
      const pathname = requestUrl.pathname;

      if (pathname === "/api/status" && (req.method === "GET" || req.method === "HEAD")) {
        const deepParam = requestUrl.searchParams.get("deep");
        const fastParam = requestUrl.searchParams.get("fast");
        const forceParam = requestUrl.searchParams.get("force");
        const deep =
          deepParam === null
            ? fastParam === "1" || fastParam === "true"
              ? false
              : deepDefault
            : !(deepParam === "0" || deepParam === "false");
        const force = forceParam === "1" || forceParam === "true";
        const payload = await getStatusPayload(cache, {
          cacheTtlMs,
          deep,
          force,
          projectHome,
          remote: remoteDefault,
        });
        return respondJson(res, 200, payload);
      }

      if (pathname === "/api/ping" && (req.method === "GET" || req.method === "HEAD")) {
        return respondJson(res, 200, {
          ok: true,
          generatedAt: new Date().toISOString(),
        });
      }

      if (pathname === "/api/accounts" && req.method === "POST") {
        const body = await readJsonBody(req);
        const name = String(body?.name || "").trim();
        if (!name) {
          return respondJson(res, 400, { error: "Account name is required." });
        }
        const created = await createAccount(name, projectHome);
        cache.clear();
        return respondJson(res, 201, {
          ok: true,
          account: {
            slug: created.slug,
            homeDir: created.homeDir,
          },
          dashboard: await buildDashboardPayload({
            deep: deepDefault,
            projectHome,
            remote: remoteDefault,
          }),
        });
      }

      if (pathname === "/api/accounts/import-current" && req.method === "POST") {
        const body = await readJsonBody(req);
        const name = String(body?.name || "").trim();
        if (!name) {
          return respondJson(res, 400, { error: "Account name is required." });
        }
        const imported = await copyCurrentAuth(name, {
          projectHome,
          sourceHome: body?.sourceHome,
        });
        cache.clear();
        return respondJson(res, 200, {
          ok: true,
          imported: {
            slug: imported.slug,
            copied: imported.copied,
            sourceHome: imported.sourceHome,
          },
          dashboard: await buildDashboardPayload({
            deep: deepDefault,
            projectHome,
            remote: remoteDefault,
          }),
        });
      }

      if (pathname === "/api/open/surface" && req.method === "POST") {
        const body = await readJsonBody(req);
        const surface = String(body?.surface || "").trim();
        const url = ACCOUNT_SURFACES[surface];
        if (!url) {
          return respondJson(res, 400, { error: "Unknown surface." });
        }
        openUrl(url);
        return respondJson(res, 200, {
          ok: true,
          surface,
          url,
        });
      }

      if (pathname === "/api/settings/launch" && (req.method === "GET" || req.method === "HEAD")) {
        return respondJson(res, 200, {
          ok: true,
          launch: {
            proxy: await getProjectLaunchState(projectHome),
          },
        });
      }

      if (pathname === "/api/settings/launch" && (req.method === "PATCH" || req.method === "POST")) {
        const body = await readJsonBody(req);
        const launch = await updateProjectLaunchSettings(body, projectHome);
        cache.clear();
        return respondJson(res, 200, {
          ok: true,
          launch: {
            proxy: launch,
          },
          dashboard: await buildDashboardPayload({
            deep: deepDefault,
            projectHome,
            remote: remoteDefault,
          }),
        });
      }

      if (pathname === "/api/settings/launch/test" && req.method === "POST") {
        const body = await readJsonBody(req);
        const saved = await readProjectLaunchSettings(projectHome);
        const merged = mergeProjectLaunchSettings(saved, body);
        const result = await testProxyLaunchSettings(merged, {
          fetchImpl: options.fetchImpl,
        });
        return respondJson(res, 200, {
          ok: result.ok,
          test: result,
          launch: {
            proxy: await getProjectLaunchState(projectHome),
          },
        });
      }

      if (pathname === "/api/settings/launch/start" && req.method === "POST") {
        const body = await readJsonBody(req);
        const saved = await readProjectLaunchSettings(projectHome);
        const merged = mergeProjectLaunchSettings(saved, body);
        const command = buildProjectProxyStartCommand(merged, { projectHome });
        await launchTerminal(command);
        return respondJson(res, 200, {
          ok: true,
          command,
          launch: {
            proxy: buildProjectLaunchState(merged),
          },
        });
      }

      const importMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/import-current$/);
      if (importMatch && req.method === "POST") {
        const body = await readJsonBody(req);
        const slug = decodeURIComponent(importMatch[1]);
        const imported = await copyCurrentAuth(slug, {
          projectHome,
          sourceHome: body?.sourceHome,
        });
        cache.clear();
        return respondJson(res, 200, {
          ok: true,
          imported: {
            slug: imported.slug,
            copied: imported.copied,
            sourceHome: imported.sourceHome,
          },
          dashboard: await buildDashboardPayload({
            deep: deepDefault,
            projectHome,
            remote: remoteDefault,
          }),
        });
      }

      const metaMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/meta$/);
      if (metaMatch && (req.method === "PATCH" || req.method === "POST")) {
        const body = await readJsonBody(req);
        const slug = decodeURIComponent(metaMatch[1]);
        const updated = await updateAccountMeta(slug, body, projectHome);
        cache.clear();
        return respondJson(res, 200, {
          ok: true,
          account: {
            slug: updated.slug,
            meta: updated.meta,
          },
          dashboard: await buildDashboardPayload({
            deep: deepDefault,
            projectHome,
            remote: remoteDefault,
          }),
        });
      }

      const launchMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/launch(?:-login)?$/);
      if (launchMatch && req.method === "POST") {
        const slug = decodeURIComponent(launchMatch[1]);
        const launchState = await getProjectLaunchState(projectHome);
        const command = buildCodexLoginCommand(slug, { projectHome });
        await launchTerminal(command);
        return respondJson(res, 200, {
          ok: true,
          slug,
          command,
          launch: {
            proxy: launchState,
          },
          requiresSlotLogin: launchState.resolved.requiresSlotLogin,
        });
      }

      const accountMatch = pathname.match(/^\/api\/accounts\/([^/]+)$/);
      if (accountMatch && req.method === "DELETE") {
        const slug = decodeURIComponent(accountMatch[1]);
        const removed = await deleteAccount(slug, projectHome);
        cache.clear();
        return respondJson(res, 200, {
          ok: true,
          removed: {
            slug: removed.slug,
          },
          dashboard: await buildDashboardPayload({
            deep: deepDefault,
            projectHome,
            remote: remoteDefault,
          }),
        });
      }

      if (pathname.startsWith("/api/")) {
        return respondJson(res, 405, { error: "Method not allowed" });
      }

      if (req.method !== "GET" && req.method !== "HEAD") {
        return respondJson(res, 405, { error: "Method not allowed" });
      }

      if (pathname === "/") {
        return serveFile(res, path.join(WEB_DIR, "index.html"));
      }

      const safePath = pathname.replace(/^\/+/, "");
      const filePath = path.normalize(path.join(WEB_DIR, safePath));
      if (!filePath.startsWith(WEB_DIR)) {
        return respondJson(res, 400, { error: "Invalid path" });
      }

      return serveFile(res, filePath);
    } catch (error) {
      const statusCode = error && typeof error.statusCode === "number" ? error.statusCode : 500;
      return respondJson(res, statusCode, {
        error: error.message || "Internal server error",
      });
    }
  });
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Invalid JSON body.");
    error.statusCode = 400;
    throw error;
  }
}

async function getStatusPayload(cache, options) {
  const key = options.deep ? "deep" : "fast";
  const now = Date.now();
  const hit = cache.get(key);
  if (!options.force && hit && now - hit.ts < options.cacheTtlMs) {
    return hit.payload;
  }

  const payload = await buildDashboardPayload({
    deep: options.deep,
    projectHome: options.projectHome,
    remote: options.remote,
  });
  cache.set(key, { ts: now, payload });
  return payload;
}

function startDashboardServer(options = {}) {
  const port = Number(options.port ?? WEB_DEFAULT_PORT);
  const host = options.host || "127.0.0.1";
  const server = createDashboardServer(options);

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      const effectivePort =
        address && typeof address === "object" ? address.port : port;
      const url = `http://${host}:${effectivePort}`;
      resolve({ server, port: effectivePort, url });
    });
  });
}

async function serveFile(res, filePath) {
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "cache-control": "no-store",
      "content-type":
        STATIC_CONTENT_TYPES[ext] || "application/octet-stream",
    });
    res.end(data);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return respondJson(res, 404, { error: "Not found" });
    }
    return respondJson(res, 500, { error: error.message || "Failed to read file" });
  }
}

function respondJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload, null, 2));
}

function openUrl(targetUrl) {
  if (!targetUrl) {
    return;
  }

  let command = null;
  let args = [];

  switch (process.platform) {
    case "darwin":
      command = "open";
      args = [targetUrl];
      break;
    case "win32":
      command = "cmd";
      args = ["/c", "start", "", targetUrl];
      break;
    default:
      command = "xdg-open";
      args = [targetUrl];
      break;
  }

  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function launchLoginInTerminal(command) {
  if (process.platform === "darwin") {
    const script = [
      'tell application "Terminal"',
      "activate",
      `do script "${escapeAppleScript(command)}"`,
      "end tell",
    ];
    await runCommand("osascript", script.flatMap((line) => ["-e", line]));
    return;
  }

  if (process.platform === "linux") {
    await runCommand("x-terminal-emulator", ["-e", "sh", "-lc", command]);
    return;
  }

  const error = new Error("Terminal launch is not implemented for this platform.");
  error.statusCode = 501;
  throw error;
}

function escapeAppleScript(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const error = new Error(`${command} exited with code ${code}.`);
      error.statusCode = 500;
      reject(error);
    });
  });
}

module.exports = {
  ACCOUNT_SURFACES,
  createDashboardServer,
  launchLoginInTerminal,
  openUrl,
  startDashboardServer,
};
