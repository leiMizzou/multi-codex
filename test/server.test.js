"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { startDashboardServer } = require("../lib/server");

function makeJwt(payload) {
  return [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature",
  ].join(".");
}

test("dashboard server supports account onboarding APIs", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "multi-codex-server-"));
  const sourceHome = path.join(tempRoot, "source-home");
  await fs.mkdir(sourceHome, { recursive: true });
  await fs.writeFile(
    path.join(sourceHome, "auth.json"),
    JSON.stringify({
      auth_mode: "chatgpt",
      last_refresh: "2026-03-10T09:51:15+00:00",
      tokens: {
        access_token: makeJwt({
          exp: 1_900_000_000,
          "https://api.openai.com/auth": {
            chatgpt_account_id: "acct_server",
            chatgpt_plan_type: "team",
          },
        }),
        refresh_token: "refresh_server",
      },
    }),
    "utf8",
  );

  const started = await startDashboardServer({
    cacheTtlMs: 0,
    port: 0,
    projectHome: tempRoot,
    remote: false,
  });
  t.after(
    () =>
      new Promise((resolve, reject) => {
        started.server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  );

  let response = await fetch(`${started.url}/api/status`);
  let payload = await response.json();
  assert.equal(payload.summary.accountCount, 0);

  response = await fetch(`${started.url}/api/accounts`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: "alpha" }),
  });
  payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.account.slug, "alpha");

  response = await fetch(`${started.url}/api/accounts/alpha/import-current`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ sourceHome }),
  });
  payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.imported.slug, "alpha");
  assert.equal(payload.dashboard.summary.accountCount, 1);
  assert.equal(payload.dashboard.accounts[0].auth.planType, "team");

  response = await fetch(`${started.url}/api/accounts/alpha/meta`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      teamLabel: "Team Blue",
      subscriptionLabel: "Enterprise",
      ownerLabel: "Auth A",
      notes: "Primary workspace",
    }),
  });
  payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.account.meta.teamLabel, "Team Blue");
  assert.equal(payload.dashboard.accounts[0].meta.subscriptionLabel, "Enterprise");

  response = await fetch(`${started.url}/api/accounts/alpha`, {
    method: "DELETE",
  });
  payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.removed.slug, "alpha");
  assert.equal(payload.dashboard.summary.accountCount, 0);
});
