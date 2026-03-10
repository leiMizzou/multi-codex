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
  shouldForceSnapshotRefresh,
} = require("../lib/extension-support");

test("buildSlotLaunchCommand keeps Use + Open as a fresh session", () => {
  assert.equal(buildSlotLaunchCommand("codex -m gpt-5.4", "open"), "codex -m gpt-5.4");
});

test("buildSlotLaunchCommand appends resume only for explicit resume actions", () => {
  assert.equal(
    buildSlotLaunchCommand("codex -m gpt-5.4", "resume"),
    "codex -m gpt-5.4 resume --all",
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
