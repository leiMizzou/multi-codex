"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCodexLoginCommand,
  buildDashboardPayload,
  collectUsageStats,
  decodeJwtPayload,
  deriveAccountHealth,
  extractAuthSummary,
  fetchCodexRemoteUsage,
  slugifyName,
} = require("../lib/core");

function makeJwt(payload) {
  return [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature",
  ].join(".");
}

test("slugifyName normalizes labels", () => {
  assert.equal(slugifyName(" Personal Team "), "personal-team");
  assert.equal(slugifyName("中文 空格"), "account");
});

test("decodeJwtPayload parses a JWT payload", () => {
  const token = makeJwt({
    exp: 1_800_000_000,
    "https://api.openai.com/auth": {
      chatgpt_plan_type: "team",
    },
  });

  assert.deepEqual(decodeJwtPayload(token), {
    exp: 1_800_000_000,
    "https://api.openai.com/auth": {
      chatgpt_plan_type: "team",
    },
  });
});

test("extractAuthSummary reads account and subscription metadata", () => {
  const accessToken = makeJwt({
    exp: 1_800_000_000,
    "https://api.openai.com/auth": {
      chatgpt_account_id: "acct_123",
      chatgpt_plan_type: "team",
      chatgpt_user_id: "user_123",
    },
  });
  const idToken = makeJwt({
    exp: 1_700_000_000,
    email: "owner@example.com",
    "https://api.openai.com/auth": {
      chatgpt_subscription_active_start: "2026-03-01T00:00:00+00:00",
      chatgpt_subscription_active_until: "2026-12-31T00:00:00+00:00",
      chatgpt_subscription_last_checked: "2026-03-10T09:00:00+00:00",
      organizations: [
        {
          id: "org_123",
          title: "Personal",
          role: "owner",
          is_default: true,
        },
      ],
      groups: [
        {
          id: "grp_456",
          title: "Team Blue",
          role: "member",
        },
      ],
    },
  });

  const summary = extractAuthSummary({
    auth_mode: "chatgpt",
    last_refresh: "2026-03-10T09:05:00+00:00",
    tokens: {
      access_token: accessToken,
      id_token: idToken,
      refresh_token: "refresh_123",
    },
  });

  assert.equal(summary.loggedIn, true);
  assert.equal(summary.authMode, "chatgpt");
  assert.equal(summary.accountId, "acct_123");
  assert.equal(summary.planType, "team");
  assert.equal(summary.subscriptionActiveStart, "2026-03-01T00:00:00+00:00");
  assert.equal(summary.subscriptionActiveUntil, "2026-12-31T00:00:00+00:00");
  assert.equal(summary.subscriptionLastChecked, "2026-03-10T09:00:00+00:00");
  assert.equal(summary.userId, "user_123");
  assert.equal(summary.email, "owner@example.com");
  assert.equal(summary.workspaceTitle, "Team Blue");
  assert.equal(summary.workspaceId, "grp_456");
  assert.equal(summary.workspaceRole, "member");
  assert.equal(summary.organizations[0].title, "Personal");
  assert.equal(summary.groups[0].title, "Team Blue");
  assert.equal(summary.hasRefreshToken, true);
  assert.match(summary.accessTokenExpiresAt, /^2027-/);
});

test("collectUsageStats sums final token counts from session logs", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "multi-codex-test-"));
  const homeDir = path.join(tempRoot, "home");
  const sessionsDir = path.join(homeDir, "sessions", "2026", "03", "10");
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.writeFile(path.join(homeDir, "history.jsonl"), "{}\n{}\n", "utf8");
  await fs.writeFile(
    path.join(sessionsDir, "rollout-a.jsonl"),
    [
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              total_tokens: 100,
            },
          },
        },
      }),
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              total_tokens: 250,
            },
          },
        },
      }),
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    path.join(sessionsDir, "rollout-b.jsonl"),
    `${JSON.stringify({
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            total_tokens: 50,
          },
        },
      },
    })}\n`,
    "utf8",
  );

  const usage = await collectUsageStats(homeDir);

  assert.equal(usage.historyLines, 2);
  assert.equal(usage.sessionFiles, 2);
  assert.equal(usage.tokenFileCount, 2);
  assert.equal(usage.localTotalTokens, 300);
});

test("deriveAccountHealth reports refreshable auth when access is stale but refresh token exists", () => {
  const health = deriveAccountHealth({
    auth: {
      loggedIn: true,
      authMode: "chatgpt",
      accessTokenExpiresAt: "2024-01-01T00:00:00.000Z",
      subscriptionActiveUntil: "2026-12-31T00:00:00+00:00",
      hasRefreshToken: true,
      lastRefresh: "2026-03-10T09:05:00+00:00",
    },
    meta: {
      updatedAt: "2026-03-10T09:00:00+00:00",
    },
    usage: {
      latestActivityAt: "2026-03-10T09:10:00+00:00",
    },
  });

  assert.equal(health.state, "refreshable");
  assert.equal(health.connected, true);
  assert.equal(health.accessTokenExpired, true);
  assert.equal(health.subscriptionExpired, false);
  assert.equal(health.lastUpdatedAt, "2026-03-10T09:10:00.000Z");
});

test("buildDashboardPayload summarizes connected account data for the web API", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "multi-codex-project-"));
  const projectHome = tempRoot;
  const accountDir = path.join(projectHome, "accounts", "alpha");
  const homeDir = path.join(accountDir, "home");
  const sessionsDir = path.join(homeDir, "sessions", "2026", "03", "10");
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.writeFile(
    path.join(accountDir, "meta.json"),
    JSON.stringify({
      name: "Alpha",
      slug: "alpha",
      createdAt: "2026-03-10T09:00:00+00:00",
      updatedAt: "2026-03-10T09:10:00+00:00",
    }),
    "utf8",
  );
  await fs.writeFile(path.join(homeDir, "history.jsonl"), "{}\n", "utf8");
  await fs.writeFile(
    path.join(homeDir, "auth.json"),
    JSON.stringify({
      auth_mode: "chatgpt",
      last_refresh: "2026-03-10T09:11:00+00:00",
      tokens: {
        access_token: makeJwt({
          exp: 1_900_000_000,
          "https://api.openai.com/auth": {
            chatgpt_account_id: "acct_456",
            chatgpt_plan_type: "pro",
          },
        }),
        refresh_token: "refresh_456",
      },
    }),
    "utf8",
  );
  await fs.writeFile(
    path.join(sessionsDir, "rollout.jsonl"),
    `${JSON.stringify({
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            total_tokens: 777,
          },
        },
      },
    })}\n`,
    "utf8",
  );

  const payload = await buildDashboardPayload({
    projectHome,
  });

  assert.equal(payload.summary.accountCount, 1);
  assert.equal(payload.summary.connectedCount, 1);
  assert.equal(payload.summary.activeCount, 1);
  assert.equal(payload.summary.localTotalTokens, 777);
  assert.equal(payload.accounts[0].health.state, "online");
  assert.equal(payload.accounts[0].commands.login, "./bin/multi-codex.js login alpha");
});

test("fetchCodexRemoteUsage reads 5-hour and weekly windows from the usage API", async () => {
  const accessToken = makeJwt({
    exp: 1_900_000_000,
    "https://api.openai.com/auth": {
      chatgpt_account_id: "acct_live",
      chatgpt_plan_type: "team",
      chatgpt_user_id: "user_live",
    },
  });
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          user_id: "user_live",
          account_id: "acct_live",
          plan_type: "team",
          rate_limit: {
            primary_window: {
              used_percent: 25,
              limit_window_seconds: 18_000,
              reset_after_seconds: 9_000,
              reset_at: 1_900_100_000,
            },
            secondary_window: {
              used_percent: 40,
              limit_window_seconds: 604_800,
              reset_after_seconds: 123_456,
              reset_at: 1_900_200_000,
            },
          },
          credits: {
            has_credits: false,
            unlimited: false,
            balance: null,
          },
        }),
    };
  };

  const result = await fetchCodexRemoteUsage({
    auth: {
      auth_mode: "chatgpt",
      tokens: {
        access_token: accessToken,
        refresh_token: "refresh_live",
      },
    },
    fetchImpl,
    persistAuth: false,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://chatgpt.com/backend-api/wham/usage");
  assert.equal(calls[0].options.headers["chatgpt-account-id"], "acct_live");
  assert.equal(result.remoteUsage.available, true);
  assert.equal(result.remoteUsage.primaryWindow.remainingPercent, 75);
  assert.equal(result.remoteUsage.secondaryWindow.remainingPercent, 60);
  assert.equal(result.remoteUsage.planType, "team");
});

test("fetchCodexRemoteUsage refreshes the access token before requesting usage", async () => {
  const expiredToken = makeJwt({
    exp: 1,
    "https://api.openai.com/auth": {
      chatgpt_account_id: "acct_refresh",
      chatgpt_plan_type: "team",
    },
  });
  const refreshedToken = makeJwt({
    exp: 1_900_000_100,
    "https://api.openai.com/auth": {
      chatgpt_account_id: "acct_refresh",
      chatgpt_plan_type: "team",
      chatgpt_user_id: "user_refresh",
    },
  });
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url === "https://auth.openai.com/oauth/token") {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            access_token: refreshedToken,
            refresh_token: "refresh_new",
          }),
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          user_id: "user_refresh",
          account_id: "acct_refresh",
          plan_type: "team",
          rate_limit: {
            primary_window: {
              used_percent: 10,
              limit_window_seconds: 18_000,
              reset_after_seconds: 18_000,
              reset_at: 1_900_100_000,
            },
            secondary_window: {
              used_percent: 20,
              limit_window_seconds: 604_800,
              reset_after_seconds: 604_800,
              reset_at: 1_900_200_000,
            },
          },
        }),
    };
  };

  const result = await fetchCodexRemoteUsage({
    auth: {
      auth_mode: "chatgpt",
      tokens: {
        access_token: expiredToken,
        refresh_token: "refresh_old",
      },
    },
    fetchImpl,
    persistAuth: false,
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://auth.openai.com/oauth/token");
  assert.equal(calls[1].url, "https://chatgpt.com/backend-api/wham/usage");
  assert.equal(result.auth.tokens.access_token, refreshedToken);
  assert.equal(result.auth.tokens.refresh_token, "refresh_new");
  assert.equal(result.remoteUsage.available, true);
  assert.equal(result.remoteUsage.primaryWindow.remainingPercent, 90);
});

test("fetchCodexRemoteUsage falls back to Codex RPC when the usage API fails", async () => {
  const accessToken = makeJwt({
    exp: 1_900_000_000,
    "https://api.openai.com/auth": {
      chatgpt_account_id: "acct_rpc",
      chatgpt_plan_type: "team",
    },
  });

  const result = await fetchCodexRemoteUsage({
    auth: {
      auth_mode: "chatgpt",
      tokens: {
        access_token: accessToken,
        refresh_token: "refresh_rpc",
      },
    },
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      text: async () => "service unavailable",
    }),
    homeDir: "/tmp/example-slot",
    persistAuth: false,
    rpcFallbackImpl: async (_homeDir, options) => ({
      available: true,
      source: "codex-rpc",
      fetchedAt: options.fetchedAt,
      planType: "team",
      primaryWindow: {
        remainingPercent: 88,
      },
      secondaryWindow: {
        remainingPercent: 66,
      },
      codeReviewWindow: null,
      credits: {
        hasCredits: false,
        unlimited: false,
        balance: null,
      },
      status: 200,
    }),
  });

  assert.equal(result.remoteUsage.available, true);
  assert.equal(result.remoteUsage.source, "codex-rpc");
  assert.equal(result.remoteUsage.primaryWindow.remainingPercent, 88);
  assert.equal(result.remoteUsage.secondaryWindow.remainingPercent, 66);
  assert.equal(result.remoteUsage.fallbackReason, "service unavailable");
});

test("buildCodexLoginCommand isolates login by CODEX_HOME", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "multi-codex-command-"));
  const accountDir = path.join(tempRoot, "accounts", "alpha", "home");
  await fs.mkdir(accountDir, { recursive: true });

  const command = buildCodexLoginCommand("alpha", {
    projectHome: tempRoot,
  });

  assert.match(command, /export CODEX_HOME='.*accounts\/alpha\/home'/);
  assert.match(command, /codex login$/);
});
