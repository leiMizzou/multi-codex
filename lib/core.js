"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { spawn, spawnSync } = require("node:child_process");
const {
  normalizeProxyEnvKey,
  normalizeProxyMode,
  normalizeProxyProviderId,
  resolveProxyLaunchOptions,
} = require("./launch");

const DEFAULT_PROJECT_HOME = path.resolve(__dirname, "..");
const AUTH_HINT_PATH = "https://developers.openai.com/codex/authentication/";
const AUTH_COPY_FILES = ["auth.json", "config.toml", "version.json"];
const PROJECT_STATE_DIRNAME = "_project";
const PROJECT_LAUNCH_SETTINGS_FILE = "launch.json";
const WEB_DEFAULT_PORT = 4821;
const DEFAULT_OPENAI_USAGE_BASE_URL = "https://chatgpt.com/backend-api";
const DEFAULT_OPENAI_REFRESH_URL = "https://auth.openai.com/oauth/token";
const OPENAI_REFRESH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const REMOTE_USAGE_USER_AGENT = "multi-codex";

function getProjectHome() {
  return path.resolve(process.env.MULTI_CODEX_HOME || DEFAULT_PROJECT_HOME);
}

function getAccountsDir(projectHome = getProjectHome()) {
  return path.join(projectHome, "accounts");
}

function getProjectStateDir(projectHome = getProjectHome()) {
  return path.join(getAccountsDir(projectHome), PROJECT_STATE_DIRNAME);
}

function getProjectLaunchSettingsPath(projectHome = getProjectHome()) {
  return path.join(getProjectStateDir(projectHome), PROJECT_LAUNCH_SETTINGS_FILE);
}

function slugifyName(input) {
  const slug = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "account";
}

function isCanonicalAccountDirName(name) {
  const value = String(name || "").trim();
  return Boolean(value) && !value.startsWith(".") && !value.startsWith("_") && slugifyName(value) === value;
}

function getAccountPaths(nameOrSlug, projectHome = getProjectHome()) {
  const slug = slugifyName(nameOrSlug);
  const dir = path.join(getAccountsDir(projectHome), slug);
  return {
    slug,
    dir,
    metaPath: path.join(dir, "meta.json"),
    homeDir: path.join(dir, "home"),
    authPath: path.join(dir, "home", "auth.json"),
    configPath: path.join(dir, "home", "config.toml"),
  };
}

async function ensureProjectLayout(projectHome = getProjectHome()) {
  await fsp.mkdir(getAccountsDir(projectHome), { recursive: true });
}

async function createAccount(name, projectHome = getProjectHome()) {
  if (!name || !String(name).trim()) {
    throw new Error("Account name is required.");
  }

  await ensureProjectLayout(projectHome);
  const paths = getAccountPaths(name, projectHome);
  const exists = await pathExists(paths.dir);
  if (exists) {
    throw new Error(`Account '${paths.slug}' already exists.`);
  }

  await fsp.mkdir(paths.homeDir, { recursive: true });
  const now = new Date().toISOString();
  const meta = {
    name: String(name).trim(),
    slug: paths.slug,
    createdAt: now,
    updatedAt: now,
    teamLabel: "",
    subscriptionLabel: "",
    ownerLabel: "",
    notes: "",
  };
  await writeJson(paths.metaPath, meta);
  return { ...paths, meta };
}

async function listAccounts(projectHome = getProjectHome()) {
  await ensureProjectLayout(projectHome);
  const entries = await fsp.readdir(getAccountsDir(projectHome), {
    withFileTypes: true,
  });

  const accounts = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isCanonicalAccountDirName(entry.name)) {
      continue;
    }
    const paths = getAccountPaths(entry.name, projectHome);
    if (!(await pathExists(paths.homeDir))) {
      continue;
    }
    const meta =
      (await readJson(paths.metaPath)) || {
        name: entry.name,
        slug: entry.name,
        createdAt: null,
        updatedAt: null,
      };
    accounts.push({
      ...paths,
      meta,
    });
  }

  accounts.sort((a, b) => a.slug.localeCompare(b.slug));
  return accounts;
}

async function copyCurrentAuth(name, options = {}) {
  const projectHome = options.projectHome || getProjectHome();
  const sourceHome = path.resolve(
    options.sourceHome || path.join(os.homedir(), ".codex"),
  );
  const paths = getAccountPaths(name, projectHome);
  if (!(await pathExists(paths.dir))) {
    await createAccount(name, projectHome);
  }

  await fsp.mkdir(paths.homeDir, { recursive: true });
  const copied = [];

  for (const fileName of AUTH_COPY_FILES) {
    const src = path.join(sourceHome, fileName);
    const dst = path.join(paths.homeDir, fileName);
    if (!(await pathExists(src))) {
      continue;
    }
    await fsp.copyFile(src, dst);
    copied.push(fileName);
  }

  const meta =
    (await readJson(paths.metaPath)) || {
      name: String(name).trim(),
      slug: paths.slug,
      createdAt: new Date().toISOString(),
    };
  meta.lastImportedAt = new Date().toISOString();
  meta.lastImportSource = sourceHome;
  meta.updatedAt = new Date().toISOString();
  await writeJson(paths.metaPath, meta);

  return {
    ...paths,
    meta,
    copied,
    sourceHome,
  };
}

async function deleteAccount(name, projectHome = getProjectHome()) {
  const paths = getAccountPaths(name, projectHome);
  if (!(await pathExists(paths.dir))) {
    throw new Error(`Unknown account '${paths.slug}'.`);
  }
  await fsp.rm(paths.dir, { recursive: true, force: true });
  return paths;
}

async function updateAccountMeta(name, patch, projectHome = getProjectHome()) {
  const paths = getAccountPaths(name, projectHome);
  if (!(await pathExists(paths.dir))) {
    throw new Error(`Unknown account '${paths.slug}'.`);
  }

  const meta =
    (await readJson(paths.metaPath)) || {
      name: paths.slug,
      slug: paths.slug,
      createdAt: new Date().toISOString(),
    };

  const next = {
    ...meta,
    updatedAt: new Date().toISOString(),
  };

  if (typeof patch?.name === "string" && patch.name.trim()) {
    next.name = patch.name.trim();
  }
  if (typeof patch?.teamLabel === "string") {
    next.teamLabel = patch.teamLabel.trim();
  }
  if (typeof patch?.subscriptionLabel === "string") {
    next.subscriptionLabel = patch.subscriptionLabel.trim();
  }
  if (typeof patch?.ownerLabel === "string") {
    next.ownerLabel = patch.ownerLabel.trim();
  }
  if (typeof patch?.notes === "string") {
    next.notes = patch.notes.trim();
  }

  await writeJson(paths.metaPath, next);
  return {
    ...paths,
    meta: next,
  };
}

function makeAccountEnv(homeDir) {
  return {
    ...process.env,
    CODEX_HOME: homeDir,
  };
}

function normalizeProjectLaunchSettings(raw = {}) {
  return {
    mode: normalizeProxyMode(raw.mode),
    baseUrl: typeof raw.baseUrl === "string" ? raw.baseUrl.trim() : "",
    providerId: normalizeProxyProviderId(raw.providerId),
    envKey: normalizeProxyEnvKey(raw.envKey),
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey.trim() : "",
    startCommand:
      typeof raw.startCommand === "string" ? raw.startCommand.trim() : "",
    startCwd: typeof raw.startCwd === "string" ? raw.startCwd.trim() : "",
    updatedAt:
      typeof raw.updatedAt === "string" && raw.updatedAt.trim()
        ? raw.updatedAt
        : null,
  };
}

function mergeProjectLaunchSettings(current, patch = {}) {
  const next = {
    ...normalizeProjectLaunchSettings(current),
  };

  if (typeof patch?.mode !== "undefined") {
    next.mode = normalizeProxyMode(patch.mode);
  }
  if (typeof patch?.baseUrl !== "undefined") {
    next.baseUrl = String(patch.baseUrl || "").trim();
  }
  if (typeof patch?.providerId !== "undefined") {
    next.providerId = normalizeProxyProviderId(patch.providerId);
  }
  if (typeof patch?.envKey !== "undefined") {
    next.envKey = normalizeProxyEnvKey(patch.envKey);
  }
  if (patch?.clearApiKey) {
    next.apiKey = "";
  }
  if (typeof patch?.apiKey === "string" && patch.apiKey.trim()) {
    next.apiKey = patch.apiKey.trim();
  }
  if (typeof patch?.startCommand !== "undefined") {
    next.startCommand = String(patch.startCommand || "").trim();
  }
  if (typeof patch?.startCwd !== "undefined") {
    next.startCwd = String(patch.startCwd || "").trim();
  }

  return next;
}

function makePublicLaunchSettings(settings) {
  return {
    mode: settings.mode,
    baseUrl: settings.baseUrl,
    providerId: settings.providerId,
    envKey: settings.envKey,
    hasApiKey: Boolean(settings.apiKey),
    startCommand: settings.startCommand,
    startCwd: settings.startCwd,
    updatedAt: settings.updatedAt,
  };
}

function makeLaunchCapabilities() {
  return {
    responsesOnly: true,
    samplingControls: false,
    note:
      "Codex routes here use the Responses API path. temperature, top_p, and top_k are not exposed by this dashboard.",
  };
}

function buildProjectLaunchState(settings) {
  const proxy = resolveProxyLaunchOptions(settings);
  return {
    settings: makePublicLaunchSettings(settings),
    resolved: {
      mode: proxy.mode,
      enabled: proxy.enabled,
      issues: [...proxy.issues],
      requiresSlotLogin: proxy.requiresSlotLogin,
      summary: proxy.summary,
      wireApi: proxy.wireApi,
    },
    capabilities: makeLaunchCapabilities(),
  };
}

function readProjectLaunchSettingsSync(projectHome = getProjectHome()) {
  const filePath = getProjectLaunchSettingsPath(projectHome);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return normalizeProjectLaunchSettings(JSON.parse(raw));
  } catch {
    return normalizeProjectLaunchSettings();
  }
}

async function readProjectLaunchSettings(projectHome = getProjectHome()) {
  return normalizeProjectLaunchSettings(
    (await readJson(getProjectLaunchSettingsPath(projectHome))) || {},
  );
}

function getProjectLaunchStateSync(projectHome = getProjectHome()) {
  return buildProjectLaunchState(readProjectLaunchSettingsSync(projectHome));
}

async function getProjectLaunchState(projectHome = getProjectHome()) {
  return buildProjectLaunchState(await readProjectLaunchSettings(projectHome));
}

async function updateProjectLaunchSettings(patch, projectHome = getProjectHome()) {
  const current = await readProjectLaunchSettings(projectHome);
  const next = mergeProjectLaunchSettings(current, patch);
  next.updatedAt = new Date().toISOString();
  await writeJson(getProjectLaunchSettingsPath(projectHome), next);
  return buildProjectLaunchState(next);
}

function buildProjectProxyStartCommand(settings, options = {}) {
  const normalized = normalizeProjectLaunchSettings(settings);
  if (!normalized.startCommand) {
    throw new Error("Proxy start command is not configured.");
  }

  const cwd = normalized.startCwd || options.projectHome || getProjectHome();
  return [
    `cd ${shellQuote(cwd)}`,
    normalized.startCommand,
  ].join(" && ");
}

async function testProxyLaunchSettings(settings, options = {}) {
  const normalized = normalizeProjectLaunchSettings(settings);
  const proxy = resolveProxyLaunchOptions(normalized);
  const testedAt = new Date().toISOString();
  const keyEnvName =
    proxy.mode === "customProvider" ? proxy.envKey : "OPENAI_API_KEY";
  const envApiKey = String(process.env[keyEnvName] || "").trim();
  const apiKey = proxy.apiKey || envApiKey;
  const keySource = proxy.apiKey ? "saved" : envApiKey ? "environment" : "missing";

  if (!proxy.enabled) {
    return {
      ok: false,
      testedAt,
      status: null,
      url: null,
      keySource,
      envKey: keyEnvName,
      models: [],
      modelCount: 0,
      summary: proxy.summary,
      error: proxy.issues[0] || "Proxy is off.",
    };
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return {
      ok: false,
      testedAt,
      status: null,
      url: null,
      keySource,
      envKey: keyEnvName,
      models: [],
      modelCount: 0,
      summary: "Proxy test failed: fetch is unavailable in this Node runtime.",
      error: "Global fetch is unavailable in this Node runtime.",
    };
  }

  const headers = {
    accept: "application/json",
    "user-agent": REMOTE_USAGE_USER_AGENT,
  };
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  const urls = buildProxyProbeUrls(proxy.baseUrl);
  let lastFailure = null;

  for (const url of urls) {
    try {
      const response = await requestJson(fetchImpl, url, {
        method: "GET",
        headers,
      });

      if (response.status >= 200 && response.status < 300) {
        const models = extractModelIds(response.body);
        const modelPreview = models.slice(0, 5);
        return {
          ok: true,
          testedAt,
          status: response.status,
          url,
          keySource,
          envKey: keyEnvName,
          models: modelPreview,
          modelCount: models.length,
          summary: [
            `Connected to ${url}`,
            models.length > 0 ? `${models.length} models visible` : "No model list in response",
            keySource === "saved"
              ? "Using saved API key"
              : keySource === "environment"
                ? `Using ${keyEnvName} from environment`
                : "No API key sent",
          ].join(" · "),
          error: null,
        };
      }

      lastFailure = {
        testedAt,
        status: response.status,
        url,
        keySource,
        envKey: keyEnvName,
        models: [],
        modelCount: 0,
        error:
          response.body?.error?.message ||
          response.body?.message ||
          response.body?.detail ||
          response.text ||
          `Proxy request failed with status ${response.status}.`,
      };

      if (response.status !== 404 && response.status !== 405) {
        break;
      }
    } catch (error) {
      lastFailure = {
        testedAt,
        status: null,
        url,
        keySource,
        envKey: keyEnvName,
        models: [],
        modelCount: 0,
        error: error.message || String(error),
      };
    }
  }

  const fallbackFailure =
    lastFailure || {
      testedAt,
      status: null,
      url: urls[0] || null,
      keySource,
      envKey: keyEnvName,
      models: [],
      modelCount: 0,
      error: "Proxy test failed.",
    };

  return {
    ...fallbackFailure,
    ok: false,
    summary: buildProxyTestFailureSummary(fallbackFailure),
  };
}

function runCodexForAccount(name, codexArgs, options = {}) {
  const paths = getAccountPaths(name, options.projectHome);
  if (!fs.existsSync(paths.dir)) {
    throw new Error(`Unknown account '${paths.slug}'. Run 'multi-codex add ${paths.slug}' first.`);
  }

  const result = spawnSync("codex", codexArgs, {
    cwd: options.cwd || process.cwd(),
    env: makeAccountEnv(paths.homeDir),
    stdio: "inherit",
  });

  if (typeof result.status === "number") {
    process.exitCode = result.status;
    return result.status;
  }

  if (result.error) {
    throw result.error;
  }

  return 1;
}

async function spawnShellForAccount(name, options = {}) {
  const paths = getAccountPaths(name, options.projectHome);
  if (!(await pathExists(paths.dir))) {
    throw new Error(`Unknown account '${paths.slug}'.`);
  }

  const shellPath = process.env.SHELL || "/bin/zsh";
  const child = spawn(shellPath, {
    cwd: options.cwd || process.cwd(),
    env: makeAccountEnv(paths.homeDir),
    stdio: "inherit",
  });

  await new Promise((resolve, reject) => {
    child.on("exit", (code) => resolve(code ?? 0));
    child.on("error", reject);
  });
}

function formatEnvExport(name, options = {}) {
  const shellName = options.shell || detectShell();
  const paths = getAccountPaths(name, options.projectHome);
  const value = shellQuote(paths.homeDir);

  if (shellName === "fish") {
    return `set -x CODEX_HOME ${value};`;
  }
  if (shellName === "pwsh" || shellName === "powershell") {
    return `$env:CODEX_HOME = ${value}`;
  }
  return `export CODEX_HOME=${value}`;
}

function buildCodexLoginCommand(name, options = {}) {
  const paths = getAccountPaths(name, options.projectHome);
  if (!fs.existsSync(paths.dir)) {
    throw new Error(`Unknown account '${paths.slug}'. Run 'multi-codex add ${paths.slug}' first.`);
  }
  const cwd = options.cwd || options.projectHome || getProjectHome();
  const launchSettings = normalizeProjectLaunchSettings(
    options.launchSettings || readProjectLaunchSettingsSync(options.projectHome),
  );
  const proxy = options.proxyOptions || resolveProxyLaunchOptions(launchSettings);
  const codexArgs = Array.isArray(options.codexArgs)
    ? options.codexArgs.map((value) => String(value))
    : typeof options.codexArgs === "string" && options.codexArgs.trim()
      ? options.codexArgs.trim().split(/\s+/)
      : proxy.requiresSlotLogin
        ? ["login"]
        : [];
  const commandArgs = [];

  for (const entry of proxy.configEntries || []) {
    commandArgs.push("-c", entry);
  }
  commandArgs.push(...codexArgs);

  const exports = Object.entries(proxy.env || {}).map(
    ([key, value]) => `export ${key}=${shellQuote(value)}`,
  );
  const codexCommand = ["codex", ...commandArgs.map((value) => shellQuote(value))].join(" ");

  return [
    `cd ${shellQuote(cwd)}`,
    `export CODEX_HOME=${shellQuote(paths.homeDir)}`,
    ...exports,
    codexCommand,
  ].join(" && ");
}

async function collectAccountStatuses(options = {}) {
  const accounts = await listAccounts(options.projectHome);
  const statuses = [];

  for (const account of accounts) {
    let auth = await readJson(account.authPath);
    let remoteUsage = null;

    if (options.remote === true) {
      const remoteResult = await fetchCodexRemoteUsage({
        auth,
        authPath: account.authPath,
        fetchImpl: options.fetchImpl,
        homeDir: account.homeDir,
        persistAuth: options.persistAuth !== false,
        refreshUrl: options.refreshUrl,
        rpcFallbackImpl: options.rpcFallbackImpl,
        usageBaseUrl: options.usageBaseUrl,
      });
      auth = remoteResult.auth;
      remoteUsage = remoteResult.remoteUsage;
    }

    const usage = await collectUsageStats(account.homeDir, options);
    const authSummary = extractAuthSummary(auth);
    statuses.push({
      slug: account.slug,
      name: account.meta.name || account.slug,
      homeDir: account.homeDir,
      meta: account.meta,
      auth: authSummary,
      remoteUsage,
      usage,
      health: deriveAccountHealth({
        auth: authSummary,
        meta: account.meta,
        usage,
      }),
    });
  }

  return statuses;
}

async function buildDashboardPayload(options = {}) {
  const projectHome = options.projectHome || getProjectHome();
  const generatedAt = (options.generatedAt || new Date()).toISOString();
  const accounts = await collectAccountStatuses(options);
  const launchSettings = readProjectLaunchSettingsSync(projectHome);
  const launch = buildProjectLaunchState(launchSettings);
  const launchProxy = resolveProxyLaunchOptions(launchSettings);
  const launchActionLabel = launch.resolved.requiresSlotLogin
    ? "Launch Codex Login"
    : "Launch Codex";
  const tokenBreakdown = {
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
  };
  for (const account of accounts) {
    const bd = account.usage.tokenBreakdown;
    if (bd) {
      tokenBreakdown.input_tokens += bd.input_tokens;
      tokenBreakdown.output_tokens += bd.output_tokens;
      tokenBreakdown.cached_input_tokens += bd.cached_input_tokens;
      tokenBreakdown.reasoning_output_tokens += bd.reasoning_output_tokens;
      tokenBreakdown.total_tokens += bd.total_tokens;
    }
  }

  const summary = {
    accountCount: accounts.length,
    connectedCount: 0,
    activeCount: 0,
    refreshableCount: 0,
    staleCount: 0,
    emptyCount: 0,
    localTotalTokens: accounts.reduce(
      (sum, account) => sum + (account.usage.localTotalTokens || 0),
      0,
    ),
    tokenBreakdown,
    tokenCost: estimateTokenCost(tokenBreakdown),
    sessionFiles: accounts.reduce(
      (sum, account) => sum + (account.usage.sessionFiles || 0),
      0,
    ),
    latestUpdateAt: null,
  };

  for (const account of accounts) {
    if (account.health.connected) {
      summary.connectedCount += 1;
    }

    switch (account.health.state) {
      case "online":
      case "api-key":
        summary.activeCount += 1;
        break;
      case "refreshable":
        summary.refreshableCount += 1;
        break;
      case "stale":
      case "subscription-ended":
        summary.staleCount += 1;
        break;
      default:
        summary.emptyCount += 1;
        break;
    }

    summary.latestUpdateAt = latestIso([
      summary.latestUpdateAt,
      account.health.lastUpdatedAt,
      account.remoteUsage?.fetchedAt,
    ]);
  }

  return {
    generatedAt,
    projectHome,
    authDocs: AUTH_HINT_PATH,
    launch: {
      proxy: launch,
    },
    summary,
    accounts: accounts.map((account) => ({
      ...account,
      launch: {
        actionLabel: launchActionLabel,
        requiresSlotLogin: launch.resolved.requiresSlotLogin,
        summary: launch.resolved.summary,
      },
      commands: {
        add: `./bin/multi-codex.js add ${account.slug}`,
        importCurrent: `./bin/multi-codex.js import-current ${account.slug}`,
        login: `./bin/multi-codex.js login ${account.slug}`,
        logout: `./bin/multi-codex.js logout ${account.slug}`,
        shell: `./bin/multi-codex.js shell ${account.slug}`,
        env: `eval "$(${path.join(projectHome, "bin", "multi-codex.js")} env ${account.slug})"`,
        status: `./bin/multi-codex.js exec ${account.slug} -- codex login status`,
        where: `./bin/multi-codex.js where ${account.slug}`,
        launch: buildCodexLoginCommand(account.slug, {
          launchSettings,
          projectHome,
          proxyOptions: launchProxy,
        }),
        launchLogin: buildCodexLoginCommand(account.slug, {
          launchSettings,
          projectHome,
          proxyOptions: launchProxy,
        }),
      },
    })),
    emptyState: {
      title: "No connected accounts yet",
      body:
        "Create an account slot, then log that account into its own CODEX_HOME or import an existing ~/.codex session.",
      steps: [
        "./bin/multi-codex.js add personal",
        "./bin/multi-codex.js import-current personal",
        "./bin/multi-codex.js login personal",
      ],
    },
  };
}

async function collectUsageStats(homeDir, options = {}) {
  const deep = options.deep !== false;
  const historyPath = path.join(homeDir, "history.jsonl");
  const sessionsPath = path.join(homeDir, "sessions");

  const historyStat = await statOrNull(historyPath);
  const historyLines =
    historyStat && deep ? await countLines(historyPath) : null;

  const sessionFiles = await walkJsonlFiles(sessionsPath);
  let localTotalTokens = 0;
  let tokenFileCount = 0;
  let latestActivityAt = historyStat?.mtime?.toISOString() || null;
  const tokenBreakdown = {
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
  };

  for (const file of sessionFiles) {
    const stat = await statOrNull(file);
    if (stat?.mtime) {
      const iso = stat.mtime.toISOString();
      if (!latestActivityAt || iso > latestActivityAt) {
        latestActivityAt = iso;
      }
    }

    const usage = await readFinalTokenUsage(file);
    if (usage) {
      tokenFileCount += 1;
      localTotalTokens += usage.total_tokens;
      tokenBreakdown.input_tokens += usage.input_tokens;
      tokenBreakdown.output_tokens += usage.output_tokens;
      tokenBreakdown.cached_input_tokens += usage.cached_input_tokens;
      tokenBreakdown.reasoning_output_tokens += usage.reasoning_output_tokens;
      tokenBreakdown.total_tokens += usage.total_tokens;
    }
  }

  return {
    sessionFiles: sessionFiles.length,
    historyLines,
    historyBytes: historyStat?.size ?? 0,
    localTotalTokens,
    tokenBreakdown,
    tokenCost: estimateTokenCost(tokenBreakdown),
    tokenFileCount,
    latestActivityAt,
  };
}

function extractAuthSummary(auth) {
  if (!auth || typeof auth !== "object") {
    return {
      loggedIn: false,
      authMode: null,
      accountId: null,
      planType: null,
      accessTokenExpiresAt: null,
      idTokenExpiresAt: null,
      subscriptionActiveStart: null,
      subscriptionActiveUntil: null,
      subscriptionLastChecked: null,
      lastRefresh: null,
      hasRefreshToken: false,
      email: null,
      workspaceTitle: null,
      workspaceId: null,
      workspaceRole: null,
      organizations: [],
      groups: [],
      docs: AUTH_HINT_PATH,
    };
  }

  const tokens = auth.tokens && typeof auth.tokens === "object" ? auth.tokens : {};
  const accessPayload = decodeJwtPayload(tokens.access_token);
  const idPayload = decodeJwtPayload(tokens.id_token);
  const authClaims = mergeAuthClaims(
    accessPayload?.["https://api.openai.com/auth"],
    idPayload?.["https://api.openai.com/auth"],
  );
  const organizations = normalizeAuthMemberships(authClaims.organizations);
  const groups = normalizeAuthMemberships(authClaims.groups);
  const workspace = pickPrimaryWorkspace(groups, organizations);

  return {
    loggedIn: Boolean(
      auth.OPENAI_API_KEY || tokens.access_token || tokens.refresh_token,
    ),
    authMode: auth.auth_mode || (auth.OPENAI_API_KEY ? "api_key" : null),
    accountId:
      tokens.account_id ||
      authClaims.chatgpt_account_id ||
      authClaims.chatgptAccountId ||
      null,
    planType:
      authClaims.chatgpt_plan_type ||
      authClaims.chatgptPlanType ||
      null,
    accessTokenExpiresAt: epochToIso(accessPayload?.exp),
    idTokenExpiresAt: epochToIso(idPayload?.exp),
    subscriptionActiveStart:
      authClaims.chatgpt_subscription_active_start || null,
    subscriptionActiveUntil:
      authClaims.chatgpt_subscription_active_until || null,
    subscriptionLastChecked:
      authClaims.chatgpt_subscription_last_checked || null,
    lastRefresh: auth.last_refresh || null,
    hasRefreshToken: Boolean(tokens.refresh_token),
    userId: authClaims.chatgpt_user_id || authClaims.user_id || null,
    email: typeof idPayload?.email === "string" ? idPayload.email : null,
    workspaceTitle: workspace?.title || null,
    workspaceId: workspace?.id || null,
    workspaceRole: workspace?.role || null,
    organizations,
    groups,
    docs: AUTH_HINT_PATH,
  };
}

function mergeAuthClaims(accessClaims, idClaims) {
  return {
    ...(idClaims && typeof idClaims === "object" ? idClaims : {}),
    ...(accessClaims && typeof accessClaims === "object" ? accessClaims : {}),
  };
}

function normalizeAuthMemberships(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      id: firstNonEmptyString([
        entry.id,
        entry.group_id,
        entry.organization_id,
        entry.account_id,
      ]),
      title: firstNonEmptyString([
        entry.title,
        entry.name,
        entry.display_name,
      ]),
      role: firstNonEmptyString([entry.role]),
      type: firstNonEmptyString([entry.type]),
      isDefault: Boolean(entry.is_default || entry.isDefault),
    }));
}

function pickPrimaryWorkspace(groups, organizations) {
  return (
    groups.find((entry) => entry.title) ||
    organizations.find((entry) => entry.isDefault && entry.title) ||
    organizations.find((entry) => entry.title) ||
    null
  );
}

function firstNonEmptyString(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

async function fetchCodexRemoteUsage(options = {}) {
  const auth =
    options.auth && typeof options.auth === "object" ? structuredClone(options.auth) : null;
  const authSummary = extractAuthSummary(auth);
  const fetchedAt = new Date().toISOString();

  if (!authSummary.loggedIn || authSummary.authMode === "api_key") {
    return {
      auth,
      remoteUsage: {
        available: false,
        source: "openai-usage-api",
        fetchedAt,
        error: "No ChatGPT OAuth session is stored for this slot.",
      },
    };
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return {
      auth,
      remoteUsage: {
        available: false,
        source: "openai-usage-api",
        fetchedAt,
        error: "Global fetch is unavailable in this Node runtime.",
      },
    };
  }

  let nextAuth = auth;
  let nextSummary = authSummary;
  const usageBaseUrl = normalizeBaseUrl(options.usageBaseUrl || DEFAULT_OPENAI_USAGE_BASE_URL);
  const usageUrl = `${usageBaseUrl}/wham/usage`;
  const refreshUrl = options.refreshUrl || DEFAULT_OPENAI_REFRESH_URL;
  const rpcFallbackImpl = options.rpcFallbackImpl || fetchCodexRpcUsage;
  let refreshed = false;

  try {
    if (shouldRefreshAccessToken(nextAuth?.tokens?.access_token) && nextAuth?.tokens?.refresh_token) {
      nextAuth = await refreshCodexAuth(nextAuth, {
        fetchImpl,
        refreshUrl,
      });
      nextSummary = extractAuthSummary(nextAuth);
      refreshed = true;
      if (options.persistAuth !== false && options.authPath) {
        await writeJson(options.authPath, nextAuth);
      }
    }

    let response = await requestJson(fetchImpl, usageUrl, {
      headers: makeCodexUsageHeaders(nextAuth, nextSummary),
      method: "GET",
    });

    if ((response.status === 401 || response.status === 403) && nextAuth?.tokens?.refresh_token && !refreshed) {
      nextAuth = await refreshCodexAuth(nextAuth, {
        fetchImpl,
        refreshUrl,
      });
      nextSummary = extractAuthSummary(nextAuth);
      refreshed = true;
      if (options.persistAuth !== false && options.authPath) {
        await writeJson(options.authPath, nextAuth);
      }

      response = await requestJson(fetchImpl, usageUrl, {
        headers: makeCodexUsageHeaders(nextAuth, nextSummary),
        method: "GET",
      });
    }

    if (response.status < 200 || response.status >= 300 || !response.body) {
      const errorMessage =
        response.body?.error?.message ||
        response.body?.detail ||
        response.text ||
        `Usage request failed with status ${response.status}.`;
      return tryCodexRpcFallback(rpcFallbackImpl, options.homeDir, nextAuth, fetchedAt, {
        error: errorMessage,
        status: response.status,
      });
    }

    return {
      auth: nextAuth,
      remoteUsage: normalizeRemoteUsagePayload(response.body, {
        accountId: nextSummary.accountId,
        fetchedAt,
        planType: nextSummary.planType,
        userId: nextSummary.userId,
      }),
    };
  } catch (error) {
    return tryCodexRpcFallback(rpcFallbackImpl, options.homeDir, nextAuth, fetchedAt, {
      error: error.message || String(error),
    });
  }
}

async function refreshCodexAuth(auth, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("Global fetch is unavailable in this Node runtime.");
  }

  const refreshToken = auth?.tokens?.refresh_token;
  if (!refreshToken) {
    throw new Error("This slot has no refresh token.");
  }

  const response = await requestJson(fetchImpl, options.refreshUrl || DEFAULT_OPENAI_REFRESH_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": REMOTE_USAGE_USER_AGENT,
    },
    body: JSON.stringify({
      client_id: OPENAI_REFRESH_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: "openid profile email",
    }),
  });

  if (response.status < 200 || response.status >= 300 || !response.body) {
    const errorCode =
      response.body?.error?.code ||
      response.body?.error ||
      response.body?.code ||
      null;
    if (typeof errorCode === "string") {
      switch (errorCode.toLowerCase()) {
        case "refresh_token_expired":
          throw new Error("Refresh token expired. Run codex login again for this slot.");
        case "refresh_token_invalidated":
          throw new Error("Refresh token was revoked. Run codex login again for this slot.");
        case "refresh_token_reused":
          throw new Error("Refresh token was already used. Run codex login again for this slot.");
        default:
          break;
      }
    }

    const detail =
      response.body?.error_description ||
      response.body?.message ||
      response.text ||
      `Refresh request failed with status ${response.status}.`;
    throw new Error(detail);
  }

  const body = response.body;
  const tokens = auth?.tokens && typeof auth.tokens === "object" ? { ...auth.tokens } : {};

  if (typeof body.access_token === "string" && body.access_token) {
    tokens.access_token = body.access_token;
  }
  if (typeof body.refresh_token === "string" && body.refresh_token) {
    tokens.refresh_token = body.refresh_token;
  }
  if (typeof body.id_token === "string" && body.id_token) {
    tokens.id_token = body.id_token;
  }

  return {
    ...(auth || {}),
    auth_mode: auth?.auth_mode || "chatgpt",
    last_refresh: new Date().toISOString(),
    tokens,
  };
}

function normalizeRemoteUsagePayload(body, fallback = {}) {
  return {
    available: true,
    source: "openai-usage-api",
    fetchedAt: fallback.fetchedAt || new Date().toISOString(),
    userId: body.user_id || fallback.userId || null,
    email: body.email || null,
    accountId: body.account_id || fallback.accountId || null,
    planType: body.plan_type || fallback.planType || null,
    primaryWindow: normalizeRemoteWindow(body.rate_limit?.primary_window, "5h"),
    secondaryWindow: normalizeRemoteWindow(body.rate_limit?.secondary_window, "weekly"),
    codeReviewWindow: normalizeRemoteWindow(
      body.code_review_rate_limit?.primary_window || body.code_review_rate_limit,
      "code-review",
    ),
    credits: {
      hasCredits: Boolean(body.credits?.has_credits),
      unlimited: Boolean(body.credits?.unlimited),
      balance:
        typeof body.credits?.balance === "number"
          ? body.credits.balance
          : typeof body.credits?.balance === "string" && body.credits.balance
            ? Number(body.credits.balance)
            : null,
    },
    status: 200,
  };
}

function normalizeRemoteWindow(window, label) {
  if (!window || typeof window !== "object") {
    return null;
  }

  const usedPercent = toFiniteNumber(window.used_percent);
  const limitWindowSeconds = toFiniteNumber(window.limit_window_seconds);
  const resetAtEpoch = toFiniteNumber(window.reset_at);
  const resetAfterSeconds = toFiniteNumber(window.reset_after_seconds);

  return {
    label,
    usedPercent,
    remainingPercent:
      typeof usedPercent === "number"
        ? clamp(100 - usedPercent, 0, 100)
        : null,
    limitWindowSeconds,
    resetAfterSeconds,
    resetAtEpoch,
    resetAt: epochToIso(resetAtEpoch),
  };
}

function shouldRefreshAccessToken(accessToken) {
  const payload = decodeJwtPayload(accessToken);
  const expiry = payload?.exp;
  if (typeof expiry !== "number") {
    return false;
  }
  return expiry * 1000 <= Date.now() + 60_000;
}

function makeCodexUsageHeaders(auth, authSummary) {
  const headers = {
    accept: "application/json",
    authorization: `Bearer ${auth?.tokens?.access_token || ""}`,
    "user-agent": REMOTE_USAGE_USER_AGENT,
  };

  if (authSummary?.accountId) {
    headers["chatgpt-account-id"] = authSummary.accountId;
  }

  return headers;
}

async function requestJson(fetchImpl, targetUrl, options = {}) {
  const response = await fetchImpl(targetUrl, options);
  const text = await response.text();
  let body = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  return {
    status: response.status,
    ok: response.ok,
    body,
    text,
  };
}

function buildProxyProbeUrls(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  const urls = [`${normalized}/models`];
  if (!/\/v1$/i.test(normalized)) {
    urls.push(`${normalized}/v1/models`);
  }
  return [...new Set(urls)];
}

function extractModelIds(body) {
  const entries = Array.isArray(body?.data)
    ? body.data
    : Array.isArray(body?.models)
      ? body.models
      : Array.isArray(body)
        ? body
        : [];

  return entries
    .map((entry) => {
      if (typeof entry === "string") {
        return entry.trim();
      }
      if (!entry || typeof entry !== "object") {
        return "";
      }
      return firstNonEmptyString([
        entry.id,
        entry.name,
        entry.model,
      ]) || "";
    })
    .filter(Boolean);
}

function buildProxyTestFailureSummary(result) {
  const parts = [];
  if (result.url) {
    parts.push(`Proxy test failed at ${result.url}`);
  } else {
    parts.push("Proxy test failed");
  }
  if (typeof result.status === "number") {
    parts.push(`HTTP ${result.status}`);
  }
  if (result.keySource === "missing") {
    parts.push(`No ${result.envKey} value was available`);
  }
  if (result.error) {
    parts.push(result.error);
  }
  return parts.join(" · ");
}

async function tryCodexRpcFallback(rpcFallbackImpl, homeDir, auth, fetchedAt, primaryFailure = {}) {
  if (typeof rpcFallbackImpl !== "function" || !homeDir) {
    return {
      auth,
      remoteUsage: {
        available: false,
        source: "openai-usage-api",
        fetchedAt,
        error: primaryFailure.error || "Live quota is unavailable.",
        status: primaryFailure.status || null,
      },
    };
  }

  try {
    const fallbackUsage = await rpcFallbackImpl(homeDir, { fetchedAt });
    return {
      auth,
      remoteUsage: {
        ...fallbackUsage,
        fallbackReason: primaryFailure.error || null,
      },
    };
  } catch (fallbackError) {
    return {
      auth,
      remoteUsage: {
        available: false,
        source: "openai-usage-api",
        fetchedAt,
        error: primaryFailure.error || "Live quota is unavailable.",
        fallbackError: fallbackError.message || String(fallbackError),
        status: primaryFailure.status || null,
      },
    };
  }
}

async function fetchCodexRpcUsage(homeDir, options = {}) {
  const fetchedAt = options.fetchedAt || new Date().toISOString();
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 8_000;

  return new Promise((resolve, reject) => {
    const child = spawn("codex", ["-s", "read-only", "-a", "untrusted", "app-server"], {
      env: makeAccountEnv(homeDir),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });
    const pending = new Map();
    let nextId = 1;
    let settled = false;

    const finish = (handler, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      rl.close();
      child.stdout.destroy();
      child.stderr.destroy();
      if (!child.killed) {
        child.kill("SIGTERM");
      }
      handler(value);
    };

    const timer = setTimeout(() => {
      finish(reject, new Error("Codex RPC timed out."));
    }, timeoutMs);

    const sendRpc = (method, params = {}) =>
      new Promise((resolveMessage, rejectMessage) => {
        const id = nextId++;
        pending.set(id, { resolve: resolveMessage, reject: rejectMessage });
        child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
      });

    child.once("error", (error) => {
      finish(reject, error);
    });

    child.stderr.on("data", () => {
      // app-server emits notifications and debug logs on stderr; quota probing does not need them.
    });

    rl.on("line", (line) => {
      if (!line.trim()) {
        return;
      }

      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }

      if (!message.id || !pending.has(message.id)) {
        return;
      }

      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        entry.reject(new Error(message.error.message || JSON.stringify(message.error)));
        return;
      }
      entry.resolve(message.result);
    });

    void (async () => {
      try {
        await sendRpc("initialize", {
          clientInfo: {
            name: REMOTE_USAGE_USER_AGENT,
            version: "0.1.0",
          },
        });
        child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
        const rateLimitsResult = await sendRpc("account/rateLimits/read");
        const accountResult = await sendRpc("account/read").catch(() => null);
        finish(resolve, normalizeRpcUsagePayload(rateLimitsResult, accountResult, fetchedAt));
      } catch (error) {
        finish(reject, error);
      }
    })();
  });
}

function normalizeRpcUsagePayload(rateLimitsResult, accountResult, fetchedAt) {
  const snapshot =
    rateLimitsResult?.rateLimitsByLimitId?.codex ||
    rateLimitsResult?.rateLimits ||
    rateLimitsResult ||
    {};
  const account = accountResult?.account || {};

  return {
    available: true,
    source: "codex-rpc",
    fetchedAt,
    userId: null,
    email: account.email || null,
    accountId: null,
    planType: snapshot.planType || account.planType || null,
    primaryWindow: normalizeRpcWindow(snapshot.primary, "5h"),
    secondaryWindow: normalizeRpcWindow(snapshot.secondary, "weekly"),
    codeReviewWindow: null,
    credits: {
      hasCredits: Boolean(snapshot.credits?.hasCredits),
      unlimited: Boolean(snapshot.credits?.unlimited),
      balance: toFiniteNumber(snapshot.credits?.balance),
    },
    status: 200,
  };
}

function normalizeRpcWindow(window, label) {
  if (!window || typeof window !== "object") {
    return null;
  }

  const usedPercent = toFiniteNumber(window.usedPercent);
  const windowMinutes = toFiniteNumber(window.windowDurationMins);
  const resetAtEpoch = toFiniteNumber(window.resetsAt);

  return {
    label,
    usedPercent,
    remainingPercent:
      typeof usedPercent === "number"
        ? clamp(100 - usedPercent, 0, 100)
        : null,
    limitWindowSeconds:
      typeof windowMinutes === "number" ? windowMinutes * 60 : null,
    resetAfterSeconds:
      typeof resetAtEpoch === "number"
        ? Math.max(0, Math.round(resetAtEpoch - Date.now() / 1000))
        : null,
    resetAtEpoch,
    resetAt: epochToIso(resetAtEpoch),
  };
}

function deriveAccountHealth({ auth, meta = {}, usage = {} }) {
  if (!auth?.loggedIn) {
    return {
      state: "empty",
      label: "Not connected",
      tone: "muted",
      detail: "No local auth has been stored for this account yet.",
      connected: false,
      accessTokenExpired: false,
      subscriptionExpired: false,
      lastUpdatedAt: latestIso([
        meta.updatedAt,
        meta.createdAt,
        usage.latestActivityAt,
      ]),
    };
  }

  const accessExpiry = auth.accessTokenExpiresAt
    ? new Date(auth.accessTokenExpiresAt)
    : null;
  const subscriptionExpiry = auth.subscriptionActiveUntil
    ? new Date(auth.subscriptionActiveUntil)
    : null;
  const now = Date.now();
  const accessValid =
    accessExpiry && !Number.isNaN(accessExpiry.valueOf())
      ? accessExpiry.valueOf() > now
      : null;
  const subscriptionValid =
    subscriptionExpiry && !Number.isNaN(subscriptionExpiry.valueOf())
      ? subscriptionExpiry.valueOf() > now
      : null;
  const lastUpdatedAt = latestIso([
    usage.latestActivityAt,
    auth.lastRefresh,
    auth.subscriptionLastChecked,
    meta.lastImportedAt,
    meta.updatedAt,
    meta.createdAt,
  ]);

  if (auth.authMode === "api_key") {
    return {
      state: "api-key",
      label: "API key",
      tone: "good",
      detail: "This account is configured with an API key.",
      connected: true,
      accessTokenExpired: false,
      subscriptionExpired: false,
      lastUpdatedAt,
    };
  }

  if (accessValid) {
    return {
      state: subscriptionValid === false ? "subscription-ended" : "online",
      label: subscriptionValid === false ? "Subscription ended" : "Online",
      tone: subscriptionValid === false ? "warn" : "good",
      detail:
        subscriptionValid === false
          ? "Auth is present, but the cached subscription window has ended."
          : "Access token is currently valid.",
      connected: true,
      accessTokenExpired: false,
      subscriptionExpired: subscriptionValid === false,
      lastUpdatedAt,
    };
  }

  if (auth.hasRefreshToken) {
    return {
      state: "refreshable",
      label: "Refreshable",
      tone: "warn",
      detail: "Access token may be stale, but a refresh token exists.",
      connected: true,
      accessTokenExpired: true,
      subscriptionExpired: subscriptionValid === false,
      lastUpdatedAt,
    };
  }

  return {
    state: "stale",
    label: "Needs login",
    tone: "danger",
    detail: "Stored auth looks stale and there is no refresh token.",
    connected: true,
    accessTokenExpired: accessValid === false,
    subscriptionExpired: subscriptionValid === false,
    lastUpdatedAt,
  };
}

function decodeJwtPayload(token) {
  if (!token || typeof token !== "string") {
    return null;
  }

  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  const payload = parts[1];
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);

  try {
    const raw = Buffer.from(normalized + padding, "base64").toString("utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// OpenAI Codex (o3-pro / gpt-5.4 tier) pricing per 1M tokens (USD).
// cached_input is billed at 50% of input; reasoning_output at output rate.
const TOKEN_PRICING = {
  input_per_m: 2.50,
  cached_input_per_m: 1.25,
  output_per_m: 10.00,
};

function estimateTokenCost(breakdown) {
  if (!breakdown || !breakdown.total_tokens) return null;
  const uncachedInput = breakdown.input_tokens - breakdown.cached_input_tokens;
  const inputCost = (uncachedInput / 1_000_000) * TOKEN_PRICING.input_per_m;
  const cachedCost = (breakdown.cached_input_tokens / 1_000_000) * TOKEN_PRICING.cached_input_per_m;
  const outputCost = (breakdown.output_tokens / 1_000_000) * TOKEN_PRICING.output_per_m;
  const totalCost = inputCost + cachedCost + outputCost;
  return {
    inputCost: round2(inputCost),
    cachedCost: round2(cachedCost),
    outputCost: round2(outputCost),
    totalCost: round2(totalCost),
    savedByCaching: round2(
      ((breakdown.cached_input_tokens / 1_000_000) * TOKEN_PRICING.input_per_m) - cachedCost,
    ),
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

async function readFinalTokenUsage(filePath) {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  let lastUsage = null;

  try {
    for await (const line of rl) {
      if (!line || !line.includes("\"token_count\"")) {
        continue;
      }

      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }

      const directUsage = row?.info?.total_token_usage;
      const eventPayload = row?.payload?.type === "token_count" ? row.payload : null;
      const eventUsage = eventPayload?.info?.total_token_usage;
      const usage = eventUsage || directUsage;
      if (usage && typeof usage.total_tokens === "number") {
        lastUsage = usage;
      }
    }
  } finally {
    rl.close();
    stream.close();
  }

  if (!lastUsage) return null;

  return {
    total_tokens: lastUsage.total_tokens || 0,
    input_tokens: lastUsage.input_tokens || 0,
    output_tokens: lastUsage.output_tokens || 0,
    cached_input_tokens: lastUsage.cached_input_tokens || 0,
    reasoning_output_tokens: lastUsage.reasoning_output_tokens || 0,
  };
}

/** @deprecated Use readFinalTokenUsage instead */
async function readFinalTokenCount(filePath) {
  const usage = await readFinalTokenUsage(filePath);
  return usage ? usage.total_tokens : null;
}

async function countLines(filePath) {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  let lines = 0;
  try {
    for await (const _line of rl) {
      lines += 1;
    }
  } finally {
    rl.close();
    stream.close();
  }
  return lines;
}

async function walkJsonlFiles(rootDir) {
  if (!(await pathExists(rootDir))) {
    return [];
  }

  const result = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const dir = queue.pop();
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        result.push(fullPath);
      }
    }
  }

  result.sort();
  return result;
}

async function pathExists(targetPath) {
  try {
    await fsp.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function statOrNull(targetPath) {
  try {
    return await fsp.stat(targetPath);
  } catch {
    return null;
  }
}

async function readJson(filePath) {
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function epochToIso(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return new Date(value * 1000).toISOString();
}

function toEpochMs(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return null;
  }
  return date.getTime();
}

function latestIso(values) {
  const valid = values
    .map((value) => toEpochMs(value))
    .filter((value) => typeof value === "number");
  if (valid.length === 0) {
    return null;
  }
  return new Date(Math.max(...valid)).toISOString();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeBaseUrl(value) {
  const trimmed = String(value || "").trim() || DEFAULT_OPENAI_USAGE_BASE_URL;
  return trimmed.replace(/\/+$/, "");
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function detectShell() {
  const shellPath = process.env.SHELL || "";
  if (shellPath.endsWith("/fish")) {
    return "fish";
  }
  if (shellPath.endsWith("/pwsh") || shellPath.endsWith("/powershell")) {
    return "pwsh";
  }
  return "sh";
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return String(value);
  }
  return date.toISOString().replace(".000Z", "Z");
}

function formatBytes(value) {
  const units = ["B", "KB", "MB", "GB"];
  let size = Number(value || 0);
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return value.toLocaleString("en-US");
}

module.exports = {
  AUTH_HINT_PATH,
  DEFAULT_OPENAI_REFRESH_URL,
  DEFAULT_OPENAI_USAGE_BASE_URL,
  WEB_DEFAULT_PORT,
  buildDashboardPayload,
  buildProjectLaunchState,
  buildProjectProxyStartCommand,
  collectAccountStatuses,
  collectUsageStats,
  copyCurrentAuth,
  createAccount,
  deleteAccount,
  buildCodexLoginCommand,
  decodeJwtPayload,
  detectShell,
  extractAuthSummary,
  fetchCodexRemoteUsage,
  formatBytes,
  formatDateTime,
  formatEnvExport,
  formatNumber,
  getAccountPaths,
  getAccountsDir,
  getProjectLaunchSettingsPath,
  getProjectLaunchState,
  getProjectLaunchStateSync,
  getProjectHome,
  getProjectStateDir,
  listAccounts,
  makeAccountEnv,
  mergeProjectLaunchSettings,
  readProjectLaunchSettings,
  readProjectLaunchSettingsSync,
  readFinalTokenCount,
  readFinalTokenUsage,
  estimateTokenCost,
  TOKEN_PRICING,
  refreshCodexAuth,
  runCodexForAccount,
  slugifyName,
  spawnShellForAccount,
  deriveAccountHealth,
  testProxyLaunchSettings,
  updateProjectLaunchSettings,
  updateAccountMeta,
};
