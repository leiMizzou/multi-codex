"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSlotLaunchCommand,
  getProjectHomeSelectionKind,
  getSlotActionState,
  isAccountStoreHome,
  resolveAccountStoreHome,
  shouldForceSnapshotRefresh,
} = require("../lib/extension-support");

test("buildSlotLaunchCommand keeps Use + Open as a fresh session", () => {
  assert.equal(
    buildSlotLaunchCommand("codex -m gpt-5.4", {
      action: "open",
      cwd: "/tmp/project",
    }),
    "codex -m gpt-5.4 -C '/tmp/project'",
  );
});

test("buildSlotLaunchCommand appends resume only for explicit resume actions", () => {
  assert.equal(
    buildSlotLaunchCommand("codex -m gpt-5.4", {
      action: "resume",
      cwd: "/tmp/project",
    }),
    "codex -m gpt-5.4 -C '/tmp/project' resume --all",
  );
});

test("getSlotActionState requires connected slots when launches depend on slot login", () => {
  const state = getSlotActionState(
    {
      connected: false,
      sessionFiles: 3,
    },
    { requiresSlotLogin: true },
  );

  assert.equal(state.canOpen, false);
  assert.equal(state.canResume, false);
  assert.match(state.openBlockedReason, /not connected/i);
  assert.equal(state.resumeBlockedReason, state.openBlockedReason);
});

test("getSlotActionState allows open through proxy auth but still blocks resume without sessions", () => {
  const state = getSlotActionState(
    {
      connected: false,
      sessionFiles: 0,
    },
    { requiresSlotLogin: false },
  );

  assert.equal(state.canOpen, true);
  assert.equal(state.openBlockedReason, null);
  assert.equal(state.canResume, false);
  assert.match(state.resumeBlockedReason, /No saved Codex sessions/i);
});

test("shouldForceSnapshotRefresh only invalidates for data-affecting settings", () => {
  assert.equal(shouldForceSnapshotRefresh("projectHome"), true);
  assert.equal(shouldForceSnapshotRefresh("fastScan"), true);
  assert.equal(shouldForceSnapshotRefresh("viewMode"), false);
  assert.equal(shouldForceSnapshotRefresh("primarySortOrder"), false);
});

test("project home selection accepts stores and empty directories only", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "multi-codex-extension-"));
  const storeDir = path.join(tempRoot, "store");
  const emptyDir = path.join(tempRoot, "empty");
  const otherDir = path.join(tempRoot, "other");

  await fs.mkdir(path.join(storeDir, "accounts"), { recursive: true });
  await fs.mkdir(emptyDir, { recursive: true });
  await fs.mkdir(otherDir, { recursive: true });
  await fs.writeFile(path.join(otherDir, "README.md"), "not a store", "utf8");

  assert.equal(isAccountStoreHome(storeDir), true);
  assert.equal(getProjectHomeSelectionKind(storeDir), "store");
  assert.equal(getProjectHomeSelectionKind(emptyDir), "empty");
  assert.equal(getProjectHomeSelectionKind(otherDir), null);
});

test("resolveAccountStoreHome collapses nested store paths back to the root", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "multi-codex-extension-home-"));
  const storeDir = path.join(tempRoot, "store");
  const slotDir = path.join(storeDir, "accounts", "alpha");
  const slotHomeDir = path.join(slotDir, "home");
  const projectStateDir = path.join(storeDir, "accounts", "_project");

  await fs.mkdir(slotHomeDir, { recursive: true });
  await fs.mkdir(projectStateDir, { recursive: true });

  assert.equal(resolveAccountStoreHome(storeDir), storeDir);
  assert.equal(resolveAccountStoreHome(slotDir), storeDir);
  assert.equal(resolveAccountStoreHome(slotHomeDir), storeDir);
  assert.equal(resolveAccountStoreHome(projectStateDir), storeDir);
  assert.equal(isAccountStoreHome(slotHomeDir), true);
  assert.equal(getProjectHomeSelectionKind(slotHomeDir), "store");
});

test("resolveAccountStoreHome maps a repo accounts directory back to the repo root", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "multi-codex-extension-repo-"));
  const repoDir = path.join(tempRoot, "multi-codex");
  const accountsDir = path.join(repoDir, "accounts");

  await fs.mkdir(path.join(repoDir, "lib"), { recursive: true });
  await fs.mkdir(accountsDir, { recursive: true });
  await fs.writeFile(path.join(repoDir, "lib", "core.js"), "\"use strict\";\n", "utf8");

  assert.equal(resolveAccountStoreHome(accountsDir), repoDir);
  assert.equal(getProjectHomeSelectionKind(accountsDir), "store");
});
