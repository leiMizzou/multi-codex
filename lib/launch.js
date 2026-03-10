"use strict";

const DEFAULT_STATUS_LINE = Object.freeze([
  "model-with-reasoning",
  "current-dir",
  "five-hour-limit",
  "weekly-limit",
  "used-tokens",
]);

const DEFAULT_PROXY_MODE = "off";
const DEFAULT_PROXY_PROVIDER_ID = "proxy";
const DEFAULT_PROXY_ENV_KEY = "OPENAI_API_KEY";
const DEFAULT_PROXY_WIRE_API = "responses";

function normalizeProxyMode(value) {
  return value === "openaiBaseUrl" || value === "customProvider"
    ? value
    : DEFAULT_PROXY_MODE;
}

function normalizeProxyProviderId(value) {
  const raw = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!raw) {
    return DEFAULT_PROXY_PROVIDER_ID;
  }
  return /^[A-Za-z_]/.test(raw) ? raw : `provider_${raw}`;
}

function normalizeProxyEnvKey(value) {
  const raw = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!raw) {
    return DEFAULT_PROXY_ENV_KEY;
  }
  return /^[A-Za-z_]/.test(raw) ? raw.toUpperCase() : DEFAULT_PROXY_ENV_KEY;
}

function resolveProxyLaunchOptions(raw = {}) {
  const mode = normalizeProxyMode(raw.mode);
  const baseUrl = String(raw.baseUrl || "").trim();
  const providerId = normalizeProxyProviderId(raw.providerId);
  const envKey = normalizeProxyEnvKey(raw.envKey);
  const apiKey = typeof raw.apiKey === "string" ? raw.apiKey : "";
  const issues = [];

  if (mode !== DEFAULT_PROXY_MODE && !baseUrl) {
    issues.push("Proxy base URL is required when proxy mode is enabled.");
  }

  const enabled = mode !== DEFAULT_PROXY_MODE && issues.length === 0;
  const env = {};
  const configEntries = [];
  let requiresSlotLogin = true;
  let summary = "Proxy off";

  if (!enabled) {
    if (mode !== DEFAULT_PROXY_MODE && issues.length > 0) {
      summary = `Proxy misconfigured: ${issues[0]}`;
    }
    return {
      mode,
      baseUrl,
      providerId,
      envKey,
      apiKey,
      enabled,
      issues,
      env,
      configEntries,
      requiresSlotLogin,
      summary,
      wireApi: DEFAULT_PROXY_WIRE_API,
    };
  }

  if (mode === "openaiBaseUrl") {
    env.OPENAI_BASE_URL = baseUrl;
    if (apiKey) {
      env.OPENAI_API_KEY = apiKey;
      requiresSlotLogin = false;
    }
    summary = `Proxy via OPENAI_BASE_URL -> ${baseUrl}`;
  } else {
    configEntries.push(`model_provider=${JSON.stringify(providerId)}`);
    configEntries.push(
      `model_providers.${providerId}.base_url=${JSON.stringify(baseUrl)}`,
    );
    configEntries.push(
      `model_providers.${providerId}.env_key=${JSON.stringify(envKey)}`,
    );
    configEntries.push(
      `model_providers.${providerId}.wire_api=${JSON.stringify(DEFAULT_PROXY_WIRE_API)}`,
    );
    if (apiKey) {
      env[envKey] = apiKey;
    }
    requiresSlotLogin = false;
    summary =
      `Proxy via custom provider '${providerId}' -> ${baseUrl} ` +
      `(${DEFAULT_PROXY_WIRE_API}, env ${envKey})`;
  }

  return {
    mode,
    baseUrl,
    providerId,
    envKey,
    apiKey,
    enabled,
    issues,
    env,
    configEntries,
    requiresSlotLogin,
    summary,
    wireApi: DEFAULT_PROXY_WIRE_API,
  };
}

module.exports = {
  DEFAULT_PROXY_ENV_KEY,
  DEFAULT_PROXY_MODE,
  DEFAULT_PROXY_PROVIDER_ID,
  DEFAULT_PROXY_WIRE_API,
  DEFAULT_STATUS_LINE,
  normalizeProxyEnvKey,
  normalizeProxyMode,
  normalizeProxyProviderId,
  resolveProxyLaunchOptions,
};
