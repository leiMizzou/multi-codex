"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_PROXY_ENV_KEY,
  DEFAULT_PROXY_MODE,
  DEFAULT_PROXY_PROVIDER_ID,
  resolveProxyLaunchOptions,
} = require("../lib/launch");

test("resolveProxyLaunchOptions keeps proxy disabled by default", () => {
  const proxy = resolveProxyLaunchOptions();

  assert.equal(proxy.mode, DEFAULT_PROXY_MODE);
  assert.equal(proxy.enabled, false);
  assert.equal(proxy.requiresSlotLogin, true);
  assert.equal(proxy.summary, "Proxy off");
  assert.deepEqual(proxy.configEntries, []);
  assert.deepEqual(proxy.env, {});
});

test("resolveProxyLaunchOptions builds OPENAI_BASE_URL launches", () => {
  const proxy = resolveProxyLaunchOptions({
    mode: "openaiBaseUrl",
    baseUrl: "http://127.0.0.1:8317",
    apiKey: "sk-proxy",
  });

  assert.equal(proxy.enabled, true);
  assert.equal(proxy.requiresSlotLogin, false);
  assert.equal(proxy.env.OPENAI_BASE_URL, "http://127.0.0.1:8317");
  assert.equal(proxy.env.OPENAI_API_KEY, "sk-proxy");
  assert.deepEqual(proxy.configEntries, []);
});

test("resolveProxyLaunchOptions builds custom provider overrides for responses proxies", () => {
  const proxy = resolveProxyLaunchOptions({
    mode: "customProvider",
    baseUrl: "http://127.0.0.1:8317",
    providerId: "cli-proxy-api",
    envKey: "cli proxy key",
    apiKey: "secret",
  });

  assert.equal(proxy.enabled, true);
  assert.equal(proxy.requiresSlotLogin, false);
  assert.equal(proxy.providerId, "cli_proxy_api");
  assert.equal(proxy.envKey, "CLI_PROXY_KEY");
  assert.deepEqual(proxy.configEntries, [
    'model_provider="cli_proxy_api"',
    'model_providers.cli_proxy_api.base_url="http://127.0.0.1:8317"',
    'model_providers.cli_proxy_api.env_key="CLI_PROXY_KEY"',
    'model_providers.cli_proxy_api.wire_api="responses"',
  ]);
  assert.deepEqual(proxy.env, {
    CLI_PROXY_KEY: "secret",
  });
});

test("resolveProxyLaunchOptions reports missing base URL when proxy mode is enabled", () => {
  const proxy = resolveProxyLaunchOptions({
    mode: "customProvider",
    providerId: DEFAULT_PROXY_PROVIDER_ID,
    envKey: DEFAULT_PROXY_ENV_KEY,
  });

  assert.equal(proxy.enabled, false);
  assert.equal(proxy.issues.length, 1);
  assert.match(proxy.summary, /Proxy misconfigured/);
});
