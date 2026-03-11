"use strict";

const fs = require("node:fs");
const path = require("node:path");

const FORCE_SNAPSHOT_REFRESH_KEYS = new Set(["projectHome", "fastScan"]);

function hasAccountsDir(candidate) {
  try {
    return fs.statSync(path.join(candidate, "accounts")).isDirectory();
  } catch {
    return false;
  }
}

function hasRepoCore(candidate) {
  try {
    return fs.statSync(path.join(candidate, "lib", "core.js")).isFile();
  } catch {
    return false;
  }
}

function buildSlotLaunchCommand(commandPrefix, options = {}) {
  const action =
    typeof options === "string" ? options : String(options.action || "open").trim() || "open";
  const cwd =
    typeof options === "object" && options !== null ? String(options.cwd || "").trim() : "";
  const parts = [commandPrefix];

  if (cwd) {
    parts.push("-C", shellQuote(cwd));
  }

  if (action === "resume") {
    parts.push("resume", "--all");
  }

  return parts.join(" ");
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
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

function resolveAccountStoreHome(candidate) {
  if (!candidate) {
    return null;
  }

  const home = path.resolve(candidate);
  const parent = path.dirname(home);
  const grandparent = path.dirname(parent);
  const greatGrandparent = path.dirname(grandparent);

  if (path.basename(home) === "_project" && path.basename(parent) === "accounts") {
    return hasAccountsDir(grandparent) ? grandparent : null;
  }

  if (
    path.basename(home) === "home" &&
    path.basename(grandparent) === "accounts"
  ) {
    return hasAccountsDir(greatGrandparent) ? greatGrandparent : null;
  }

  if (path.basename(parent) === "accounts" && hasAccountsDir(grandparent)) {
    return grandparent;
  }

  if (path.basename(home) === "accounts") {
    return hasRepoCore(parent) ? parent : null;
  }

  if (hasRepoCore(home) || hasAccountsDir(home)) {
    return home;
  }

  return null;
}

function isAccountStoreHome(candidate) {
  return Boolean(resolveAccountStoreHome(candidate));
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
  if (resolveAccountStoreHome(candidate)) {
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
  resolveAccountStoreHome,
  shouldForceSnapshotRefresh,
};
