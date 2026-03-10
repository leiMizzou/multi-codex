"use strict";

const fs = require("node:fs");
const path = require("node:path");

const FORCE_SNAPSHOT_REFRESH_KEYS = new Set(["projectHome", "fastScan"]);

function buildSlotLaunchCommand(commandPrefix, action = "open") {
  return action === "resume" ? `${commandPrefix} resume --all` : commandPrefix;
}

function getSlotActionState(account, options = {}) {
  const requiresSlotLogin = Boolean(options.requiresSlotLogin);
  const connected = Boolean(account?.connected);
  const sessionFiles = Number(account?.sessionFiles || 0);
  const hasSessions = Number.isFinite(sessionFiles) && sessionFiles > 0;

  const openBlockedReason =
    requiresSlotLogin && !connected
      ? "This slot is not connected. Run Codex login for the slot before opening it."
      : null;
  const resumeBlockedReason = openBlockedReason || (
    hasSessions ? null : "No saved Codex sessions were found for this slot."
  );

  return {
    canOpen: !openBlockedReason,
    canResume: !resumeBlockedReason,
    openBlockedReason,
    resumeBlockedReason,
  };
}

function shouldForceSnapshotRefresh(key) {
  return FORCE_SNAPSHOT_REFRESH_KEYS.has(String(key || "").trim());
}

function isAccountStoreHome(candidate) {
  if (!candidate) {
    return false;
  }

  const home = path.resolve(candidate);
  return (
    fs.existsSync(path.join(home, "accounts")) ||
    fs.existsSync(path.join(home, "lib", "core.js"))
  );
}

function isEmptyDirectory(candidate) {
  if (!candidate) {
    return false;
  }

  try {
    return fs.statSync(candidate).isDirectory() && fs.readdirSync(candidate).length === 0;
  } catch {
    return false;
  }
}

function getProjectHomeSelectionKind(candidate) {
  if (isAccountStoreHome(candidate)) {
    return "store";
  }
  if (isEmptyDirectory(candidate)) {
    return "empty";
  }
  return null;
}

module.exports = {
  buildSlotLaunchCommand,
  getProjectHomeSelectionKind,
  getSlotActionState,
  isAccountStoreHome,
  shouldForceSnapshotRefresh,
};
