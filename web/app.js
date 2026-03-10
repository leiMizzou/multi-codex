const AUTO_REFRESH_MS = 6 * 60 * 60 * 1000;

const state = {
  data: null,
  fast: false,
  loading: false,
  jsonVisible: false,
  loadPromise: null,
  selectedSlug: null,
};

const summaryGrid = document.querySelector("#summary-grid");
const accountsGrid = document.querySelector("#accounts-grid");
const emptyState = document.querySelector("#empty-state");
const accountForm = document.querySelector("#account-form");
const accountNameInput = document.querySelector("#account-name");
const createAccountButton = document.querySelector("#create-account-button");
const importAccountButton = document.querySelector("#import-account-button");
const openChatgptButton = document.querySelector("#open-chatgpt-button");
const openSettingsButton = document.querySelector("#open-settings-button");
const openUsageButton = document.querySelector("#open-usage-button");
const feedbackBanner = document.querySelector("#feedback-banner");
const projectHome = document.querySelector("#project-home");
const rawJson = document.querySelector("#raw-json");
const generatedAt = document.querySelector("#generated-at");
const statusPill = document.querySelector("#status-pill");
const refreshButton = document.querySelector("#refresh-button");
const jsonToggle = document.querySelector("#json-toggle");
const fastToggle = document.querySelector("#fast-toggle");
const connectedTableBody = document.querySelector("#connected-table-body");
const summaryCardTemplate = document.querySelector("#summary-card-template");
const accountCardTemplate = document.querySelector("#account-card-template");

refreshButton.addEventListener("click", () => loadSnapshot({ force: true }));
jsonToggle.addEventListener("click", () => {
  state.jsonVisible = !state.jsonVisible;
  rawJson.classList.toggle("hidden", !state.jsonVisible);
});
accountForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void createAccountFromForm();
});
importAccountButton.addEventListener("click", () => {
  void importCurrentFromForm();
});
openChatgptButton.addEventListener("click", () => {
  void openSurface("chatgpt-home");
});
openSettingsButton.addEventListener("click", () => {
  void openSurface("account-settings");
});
openUsageButton.addEventListener("click", () => {
  void openSurface("codex-usage");
});
fastToggle.addEventListener("change", () => {
  state.fast = fastToggle.checked;
  loadSnapshot({ force: true });
});

async function loadSnapshot(options = {}) {
  if (state.loadPromise) {
    if (!options.force) {
      return state.loadPromise;
    }
    await state.loadPromise;
  }

  state.loading = true;
  state.loadPromise = (async () => {
    setStatusPill("loading", "connecting");

    try {
      const search = new URLSearchParams();
      if (state.fast) {
        search.set("fast", "1");
      }
      if (options.force) {
        search.set("force", "1");
      }

      const response = await fetch(`/api/status${search.size > 0 ? `?${search}` : ""}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }

      state.data = await response.json();
      render();
      setStatusPill("ok", "live");
    } catch (error) {
      setStatusPill("error", "error");
      generatedAt.textContent = error.message || String(error);
    } finally {
      state.loading = false;
      state.loadPromise = null;
    }
  })();

  return state.loadPromise;
}

function render() {
  const payload = state.data;
  if (!payload) {
    return;
  }

  generatedAt.textContent = `Last snapshot ${formatDateTime(payload.generatedAt)}`;
  projectHome.textContent = payload.projectHome || "-";
  rawJson.textContent = JSON.stringify(payload, null, 2);

  renderSummary(payload);
  renderConnectedSnapshot(payload.accounts || []);
  renderAccounts(payload.accounts || []);
  renderEmptyState(payload);
}

async function createAccountFromForm() {
  const name = readAccountName();
  if (!name) {
    setFeedback("Enter an account label first.", "error");
    accountNameInput.focus();
    return;
  }

  try {
    createAccountButton.disabled = true;
    const result = await mutate("/api/accounts", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    accountForm.reset();
    setFeedback(`Created account slot '${result.account.slug}'.`, "good");
  } catch (error) {
    setFeedback(error.message || String(error), "error");
  } finally {
    createAccountButton.disabled = false;
  }
}

async function importCurrentFromForm() {
  const name = readAccountName();
  if (!name) {
    setFeedback("Enter the slot name to import into.", "error");
    accountNameInput.focus();
    return;
  }

  try {
    importAccountButton.disabled = true;
    const result = await mutate("/api/accounts/import-current", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    accountForm.reset();
    setFeedback(
      `Imported current ~/.codex into '${result.imported.slug}'.`,
      "good",
    );
  } catch (error) {
    setFeedback(error.message || String(error), "error");
  } finally {
    importAccountButton.disabled = false;
  }
}

async function mutate(url, options = {}) {
  const payload = await requestJson(url, options);
  await loadSnapshot({ force: true });
  return payload;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "content-type": "application/json",
    },
    ...options,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

async function openSurface(surface) {
  try {
    const result = await requestJson("/api/open/surface", {
      method: "POST",
      body: JSON.stringify({ surface }),
    });
    setFeedback(`Opened ${result.surface} in your browser.`, "good");
  } catch (error) {
    setFeedback(error.message || String(error), "error");
  }
}

function renderSummary(payload) {
  const attentionCount =
    (payload.summary.refreshableCount || 0) + (payload.summary.staleCount || 0);
  const cards = [
    {
      label: "Online",
      value: formatNumber(payload.summary.activeCount),
      meta: `${formatNumber(payload.summary.accountCount)} configured homes`,
    },
    {
      label: "Attention",
      value: formatNumber(attentionCount),
      meta: "Refreshable, stale, or ended subscriptions",
    },
    {
      label: "Local tokens",
      value: formatNumber(payload.summary.localTotalTokens),
      meta: state.fast ? "Fast scan enabled" : "Summed from session logs",
    },
    {
      label: "Last update",
      value: formatRelative(payload.summary.latestUpdateAt),
      meta: payload.summary.latestUpdateAt
        ? `${formatDateTime(payload.summary.latestUpdateAt)} · auto refresh ${formatDuration(AUTO_REFRESH_MS)}`
        : `No local activity yet · auto refresh ${formatDuration(AUTO_REFRESH_MS)}`,
    },
  ];

  summaryGrid.replaceChildren(
    ...cards.map((card) => {
      const node = summaryCardTemplate.content.firstElementChild.cloneNode(true);
      node.querySelector(".summary-label").textContent = card.label;
      node.querySelector(".summary-value").textContent = card.value;
      node.querySelector(".summary-meta").textContent = card.meta;
      return node;
    }),
  );
}

function renderAccounts(accounts) {
  if ((accounts || []).length === 0) {
    accountsGrid.replaceChildren();
    state.selectedSlug = null;
    return;
  }

  syncSelectedSlug(accounts);
  const rankedAccounts = sortAccountsForCompare(accounts);
  const selectedAccount =
    rankedAccounts.find((account) => account.slug === state.selectedSlug) || rankedAccounts[0];

  const shell = document.createElement("section");
  shell.className = "slot-browser";

  const switcher = makeAccountSwitcher(rankedAccounts, selectedAccount);

  const stage = document.createElement("div");
  stage.className = "account-stage";
  stage.appendChild(makeAccountCard(selectedAccount));

  shell.append(switcher, stage);
  accountsGrid.replaceChildren(shell);
}

function makeAccountCard(account) {
  const node = accountCardTemplate.content.firstElementChild.cloneNode(true);
  const remoteUsage = account.remoteUsage || {};
  const allAccounts = state.data?.accounts || [];
  node.querySelector(".account-name").textContent = `slot ${account.slug}`;
  node.querySelector(".account-slug").textContent = resolveAccountTitle(account, allAccounts);

  const healthPill = node.querySelector(".health-pill");
  healthPill.textContent = account.health?.label || "Unknown";
  healthPill.dataset.tone = account.health?.tone || "muted";

  node.querySelector(".account-detail").textContent = describeAccountDetail(account);

  const metricRibbon = node.querySelector(".metric-ribbon");
  metricRibbon.replaceChildren(
    makeMetricChip(remoteUsage.planType || account.auth.planType || "—", "Plan"),
    makeMetricChip(formatQuotaWindow(remoteUsage.primaryWindow), "5h left"),
    makeMetricChip(formatQuotaWindow(remoteUsage.secondaryWindow), "Week left"),
    makeMetricChip(formatNumber(account.usage.localTotalTokens), "Local tokens"),
  );

  const identityRibbon = node.querySelector(".identity-ribbon");
  const identityEntries = uniqueIdentityEntries([
    ["Detected workspace", account.auth.workspaceTitle],
    ["Team", account.meta.teamLabel],
    ["Subscription", account.meta.subscriptionLabel],
    ["Owner/Auth", account.meta.ownerLabel],
  ]);
  identityRibbon.replaceChildren(
    ...(identityEntries.length > 0
      ? identityEntries.map(([label, value]) => makeIdentityChip(label, value))
      : [makeIdentityChip("Slot", "No labels saved yet")]),
  );

  const infoGrid = node.querySelector(".info-grid");
  const infoCells = [
    ["Mode", account.auth.authMode || "—"],
    ["Quota source", remoteUsage.source || "—"],
    ["Detected workspace", account.auth.workspaceTitle || "—"],
    ["Workspace role", account.auth.workspaceRole || "—"],
    ["Account ID", truncate(remoteUsage.accountId || account.auth.accountId || "—", 20)],
    ["Usage email", remoteUsage.email || account.auth.email || "—"],
    ["Subscription until", formatDateTime(account.auth.subscriptionActiveUntil)],
    ["Subscription checked", formatDateTime(account.auth.subscriptionLastChecked)],
    ["Access expires", formatDateTime(account.auth.accessTokenExpiresAt)],
    ["Last refresh", formatDateTime(account.auth.lastRefresh)],
    ["5h reset", formatDateTime(remoteUsage.primaryWindow?.resetAt)],
    ["Week reset", formatDateTime(remoteUsage.secondaryWindow?.resetAt)],
    ["Code review", formatQuotaWindow(remoteUsage.codeReviewWindow)],
    ["Latest activity", formatDateTime(account.usage.latestActivityAt)],
  ];
  infoGrid.replaceChildren(...infoCells.map(([label, value]) => makeInfoCell(label, value)));

  const metaForm = node.querySelector(".meta-form");
  metaForm.querySelector(".meta-name").value = account.meta.name || account.slug;
  metaForm.querySelector(".meta-team").value = account.meta.teamLabel || "";
  metaForm.querySelector(".meta-subscription").value =
    account.meta.subscriptionLabel || "";
  metaForm.querySelector(".meta-owner").value = account.meta.ownerLabel || "";
  metaForm.querySelector(".meta-notes").value = account.meta.notes || "";

  const commandStrip = node.querySelector(".command-strip");
  const commandEntries = [
    ["Login", account.commands.login],
    ["Import", account.commands.importCurrent],
    ["Shell", account.commands.shell],
    ["Status", account.commands.status],
  ];
  commandStrip.replaceChildren(
    ...commandEntries.map(([label, command]) => makeCommandButton(label, command)),
  );

  const adminStrip = node.querySelector(".admin-strip");
  adminStrip.replaceChildren(
    makeActionButton("Use detected name", async () => {
      const suggestedName = getSuggestedDetectedName(account, allAccounts);
      if (!suggestedName || suggestedName === account.slug) {
        setFeedback(
          `No distinct workspace name is available yet for '${account.slug}'.`,
          "warn",
        );
        return;
      }
      metaForm.querySelector(".meta-name").value = suggestedName;
      if (!metaForm.querySelector(".meta-team").value && account.auth.workspaceTitle) {
        metaForm.querySelector(".meta-team").value = account.auth.workspaceTitle;
      }
      setFeedback(
        `Filled the detected workspace name for '${account.slug}'. Save labels to persist it.`,
        "good",
      );
    }),
    makeActionButton("Save labels", async () => {
      const payload = {
        name: metaForm.querySelector(".meta-name").value,
        teamLabel: metaForm.querySelector(".meta-team").value,
        subscriptionLabel: metaForm.querySelector(".meta-subscription").value,
        ownerLabel: metaForm.querySelector(".meta-owner").value,
        notes: metaForm.querySelector(".meta-notes").value,
      };
      await mutate(`/api/accounts/${encodeURIComponent(account.slug)}/meta`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setFeedback(`Saved labels for '${account.slug}'.`, "good");
    }, "good"),
    makeActionButton("Launch Codex Login", async () => {
      const result = await requestJson(
        `/api/accounts/${encodeURIComponent(account.slug)}/launch-login`,
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      );
      setFeedback(
        `Opened a terminal for '${result.slug}'. Complete the login there, then refresh this page.`,
        "good",
      );
    }, "good"),
    makeActionButton("Sync current ~/.codex", async () => {
      const result = await mutate(`/api/accounts/${encodeURIComponent(account.slug)}/import-current`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setFeedback(
        `Synced current ~/.codex into '${result.imported.slug}'.`,
        "good",
      );
    }),
    makeActionButton("Remove slot", async () => {
      const confirmed = window.confirm(
        `Remove account slot '${account.slug}' from multi-codex?`,
      );
      if (!confirmed) {
        return;
      }
      const result = await mutate(`/api/accounts/${encodeURIComponent(account.slug)}`, {
        method: "DELETE",
      });
      setFeedback(`Removed '${result.removed.slug}'.`, "warn");
    }, "danger"),
  );

  return node;
}

function makeAccountSwitcher(accounts, selectedAccount) {
  const shell = document.createElement("div");
  shell.className = "account-switcher";

  const head = document.createElement("div");
  head.className = "switcher-head";

  const title = document.createElement("strong");
  title.textContent = "Detail focus";

  const hint = document.createElement("span");
  hint.className = "switcher-hint";
  hint.textContent = `${formatNumber(accounts.filter((account) => account.health?.connected).length)} connected · auto refresh ${formatDuration(AUTO_REFRESH_MS)} · manual refresh for immediate quota updates`;
  head.append(title, hint);

  const controls = document.createElement("div");
  controls.className = "switcher-controls";

  const previousButton = document.createElement("button");
  previousButton.type = "button";
  previousButton.className = "mini-action";
  previousButton.textContent = "Prev";
  previousButton.addEventListener("click", () => stepSelectedAccount(accounts, -1));

  const select = document.createElement("select");
  select.className = "switcher-select";
  for (const account of accounts) {
    const option = document.createElement("option");
    option.value = account.slug;
    option.textContent = `${resolveAccountTitle(account, accounts)} · ${account.health?.label || "Unknown"}`;
    select.appendChild(option);
  }
  select.value = selectedAccount.slug;
  select.addEventListener("change", () => {
    state.selectedSlug = select.value;
    renderAccounts(state.data?.accounts || []);
  });

  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.className = "mini-action";
  nextButton.textContent = "Next";
  nextButton.addEventListener("click", () => stepSelectedAccount(accounts, 1));

  controls.append(previousButton, select, nextButton);
  shell.append(head, controls);
  return shell;
}

function stepSelectedAccount(accounts, offset) {
  const index = accounts.findIndex((account) => account.slug === state.selectedSlug);
  const currentIndex = index >= 0 ? index : 0;
  const nextIndex = (currentIndex + offset + accounts.length) % accounts.length;
  state.selectedSlug = accounts[nextIndex].slug;
  renderAccounts(state.data?.accounts || []);
}

function syncSelectedSlug(accounts) {
  if ((accounts || []).length === 0) {
    state.selectedSlug = null;
    return;
  }

  const exists = accounts.some((account) => account.slug === state.selectedSlug);
  if (exists) {
    return;
  }

  const preferred =
    accounts.find((account) => account.health?.connected) ||
    accounts[0];
  state.selectedSlug = preferred.slug;
}

function renderConnectedSnapshot(accounts) {
  const connectedAccounts = sortAccountsForCompare(
    accounts.filter((account) => account.health?.connected),
  );
  if (connectedAccounts.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 11;
    cell.className = "snapshot-empty";
    cell.textContent = "No connected slots yet. Login to at least one slot to compare saved auth details here.";
    row.appendChild(cell);
    connectedTableBody.replaceChildren(row);
    return;
  }

  connectedTableBody.replaceChildren(
    ...connectedAccounts.map((account) => {
      const row = document.createElement("tr");
      row.dataset.selected = account.slug === state.selectedSlug ? "true" : "false";
      row.dataset.clickable = "true";
      row.tabIndex = 0;
      const remoteUsage = account.remoteUsage || {};
      const labels = [
        account.meta.teamLabel,
        account.meta.subscriptionLabel,
        account.meta.ownerLabel,
      ].filter(Boolean);

      const cells = [
        {
          label: "Account",
          value: resolveAccountTitle(account, connectedAccounts),
          emphasize: true,
          title: `slot: ${account.slug}`,
        },
        {
          label: "Status",
          value: account.health?.label || "Unknown",
          tone: account.health?.tone || "muted",
        },
        {
          label: "Plan",
          value: remoteUsage.planType || account.auth.planType || "—",
        },
        {
          label: "Workspace",
          value: account.auth.workspaceTitle || "—",
        },
        {
          label: "5h left",
          value: formatQuotaWindow(remoteUsage.primaryWindow),
          meter: remoteUsage.primaryWindow?.remainingPercent,
        },
        {
          label: "5h reset",
          value: formatDateTime(remoteUsage.primaryWindow?.resetAt),
        },
        {
          label: "Week left",
          value: formatQuotaWindow(remoteUsage.secondaryWindow),
          meter: remoteUsage.secondaryWindow?.remainingPercent,
        },
        {
          label: "Week reset",
          value: formatDateTime(remoteUsage.secondaryWindow?.resetAt),
        },
        {
          label: "Sub until",
          value: formatShortDate(account.auth.subscriptionActiveUntil),
        },
        {
          label: "Account ID",
          value: truncate(remoteUsage.accountId || account.auth.accountId || "—", 18),
          title: remoteUsage.accountId || account.auth.accountId || "",
          mono: true,
        },
        {
          label: "Labels",
          value:
            labels.length > 0
              ? labels.join(" | ")
              : remoteUsage.error
                ? truncate(remoteUsage.error, 56)
                : "No labels yet",
        },
      ];

      for (const cellConfig of cells) {
        row.appendChild(makeSnapshotCell(cellConfig));
      }
      row.addEventListener("click", () => {
        state.selectedSlug = account.slug;
        render();
      });
      row.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }
        event.preventDefault();
        state.selectedSlug = account.slug;
        render();
      });
      return row;
    }),
  );
}

function renderEmptyState(payload) {
  const hasAccounts = (payload.accounts || []).length > 0;
  emptyState.classList.toggle("hidden", hasAccounts);
  if (hasAccounts) {
    emptyState.replaceChildren();
    return;
  }

  const title = document.createElement("h3");
  title.textContent = payload.emptyState?.title || "No accounts connected";
  const body = document.createElement("p");
  body.textContent = payload.emptyState?.body || "Add at least one account slot to start.";
  const steps = document.createElement("div");
  steps.className = "step-list";
  for (const step of payload.emptyState?.steps || []) {
    steps.appendChild(makeCommandButton("Next step", step));
  }

  emptyState.replaceChildren(title, body, steps);
}

function makeMetricChip(value, label) {
  const chip = document.createElement("div");
  chip.className = "metric-chip";
  const strong = document.createElement("strong");
  strong.textContent = value;
  const span = document.createElement("span");
  span.textContent = label;
  chip.append(strong, span);
  return chip;
}

function makeIdentityChip(label, value) {
  const chip = document.createElement("div");
  chip.className = "identity-chip";
  const span = document.createElement("span");
  span.textContent = label;
  const strong = document.createElement("strong");
  strong.textContent = value;
  chip.append(span, strong);
  return chip;
}

function makeInfoCell(label, value) {
  const cell = document.createElement("div");
  cell.className = "info-cell";
  const span = document.createElement("span");
  span.textContent = label;
  const strong = document.createElement("strong");
  strong.textContent = value;
  cell.append(span, strong);
  return cell;
}

function makeSnapshotCell(config) {
  const cell = document.createElement("td");
  cell.dataset.label = config.label;

  if (config.title) {
    cell.title = config.title;
  }

  if (config.emphasize) {
    const strong = document.createElement("strong");
    strong.textContent = config.value;
    cell.appendChild(strong);
    return cell;
  }

  if (config.tone) {
    const badge = document.createElement("span");
    badge.className = "table-pill";
    badge.dataset.tone = config.tone;
    badge.textContent = config.value;
    cell.appendChild(badge);
    return cell;
  }

  if (typeof config.meter === "number") {
    const meter = document.createElement("div");
    meter.className = "quota-meter";
    const label = document.createElement("strong");
    label.textContent = config.value;
    const track = document.createElement("div");
    track.className = "quota-track";
    const fill = document.createElement("div");
    fill.className = "quota-fill";
    fill.style.width = `${Math.max(0, Math.min(100, config.meter))}%`;
    track.appendChild(fill);
    meter.append(label, track);
    cell.appendChild(meter);
    return cell;
  }

  const span = document.createElement("span");
  span.textContent = config.value;
  if (config.mono) {
    span.className = "mono";
  }
  cell.appendChild(span);
  return cell;
}

function describeAccountDetail(account) {
  const base = account.health?.detail || "No health information available.";
  const remoteUsage = account.remoteUsage;
  const detectedWorkspace = account.auth.workspaceTitle;
  const subscriptionUntil = account.auth.subscriptionActiveUntil
    ? formatDateTime(account.auth.subscriptionActiveUntil)
    : null;
  const prefix = [
    detectedWorkspace ? `Detected workspace ${detectedWorkspace}.` : null,
    subscriptionUntil ? `Subscription active until ${subscriptionUntil}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  if (remoteUsage?.available) {
    const sourceNote =
      remoteUsage.source === "codex-rpc" ? " Source: local Codex RPC fallback." : "";
    return `${prefix ? `${prefix} ` : ""}${base} 5h left ${formatQuotaWindow(remoteUsage.primaryWindow)}, weekly left ${formatQuotaWindow(remoteUsage.secondaryWindow)}.${sourceNote}`;
  }
  if (remoteUsage?.error) {
    return `${prefix ? `${prefix} ` : ""}${base} Live quota is unavailable right now: ${remoteUsage.error}`;
  }
  return prefix ? `${prefix} ${base}` : base;
}

function makeCommandButton(label, command) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "command-button";
  button.innerHTML = `<span>${label}</span><strong>${escapeHtml(command)}</strong>`;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(command);
      button.dataset.copied = "true";
      const previous = button.querySelector("span").textContent;
      button.querySelector("span").textContent = "Copied";
      window.setTimeout(() => {
        button.querySelector("span").textContent = previous;
        delete button.dataset.copied;
      }, 1000);
    } catch {
      window.prompt("Copy command", command);
    }
  });
  return button;
}

function makeActionButton(label, handler, tone = "default") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mini-action";
  button.dataset.tone = tone;
  button.textContent = label;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await handler();
    } catch (error) {
      setFeedback(error.message || String(error), "error");
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

function setStatusPill(mode, text) {
  statusPill.textContent = text;
  statusPill.dataset.mode = mode;
}

function setFeedback(message, tone = "good") {
  if (!message) {
    feedbackBanner.textContent = "";
    feedbackBanner.classList.add("hidden");
    return;
  }

  feedbackBanner.textContent = message;
  feedbackBanner.dataset.tone = tone;
  feedbackBanner.classList.remove("hidden");
}

function formatNumber(value) {
  return typeof value === "number" ? value.toLocaleString("en-US") : "—";
}

function formatDateTime(value) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return String(value);
  }
  return date.toLocaleString();
}

function formatShortDate(value) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return String(value);
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatDuration(value) {
  const minutes = Math.round(value / 60_000);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.round(minutes / 60);
  return `${hours}h`;
}

function formatRelative(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return String(value);
  }

  const deltaMs = Date.now() - date.valueOf();
  const absMs = Math.abs(deltaMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (absMs < minute) {
    return "just now";
  }
  if (absMs < hour) {
    return `${Math.round(absMs / minute)}m ago`;
  }
  if (absMs < day) {
    return `${Math.round(absMs / hour)}h ago`;
  }
  return `${Math.round(absMs / day)}d ago`;
}

function formatQuotaWindow(window) {
  if (!window || typeof window.remainingPercent !== "number") {
    return "—";
  }

  const rounded = Math.round(window.remainingPercent * 10) / 10;
  const display = Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
  return `${display}% left`;
}

function truncate(value, maxLength) {
  if (!value || value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function readAccountName() {
  return accountNameInput.value.trim();
}

function uniqueIdentityEntries(entries) {
  const seen = new Set();
  return entries.filter(([label, value]) => {
    if (!value) {
      return false;
    }
    const key = String(value).trim().toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function resolveAccountTitle(account, accounts) {
  const manualName =
    typeof account.meta?.name === "string" ? account.meta.name.trim() : "";
  if (manualName && manualName !== account.slug) {
    return manualName;
  }

  const detectedName = getDetectedWorkspaceName(account);
  if (!detectedName) {
    return account.slug;
  }

  const duplicates = (accounts || []).filter((candidate) => {
    const candidateManual =
      typeof candidate.meta?.name === "string" ? candidate.meta.name.trim() : "";
    return !candidateManual || candidateManual === candidate.slug
      ? getDetectedWorkspaceName(candidate) === detectedName
      : false;
  });
  if (duplicates.length <= 1) {
    return detectedName;
  }

  const suffix = getShortAccountSuffix(account);
  return suffix ? `${detectedName} · ${suffix}` : detectedName;
}

function getSuggestedDetectedName(account, accounts) {
  const detectedName = getDetectedWorkspaceName(account);
  if (!detectedName) {
    return null;
  }
  return resolveAccountTitle(
    {
      ...account,
      meta: {
        ...account.meta,
        name: account.slug,
      },
    },
    accounts,
  );
}

function getDetectedWorkspaceName(account) {
  return account.auth?.workspaceTitle || null;
}

function getShortAccountSuffix(account) {
  const id = account.remoteUsage?.accountId || account.auth?.accountId || "";
  if (!id) {
    return null;
  }
  const compact = id.replace(/[^a-z0-9]/gi, "");
  return compact ? compact.slice(-4).toUpperCase() : null;
}

function describeTabSubline(account) {
  const pieces = [`slot ${account.slug}`];
  if (account.auth?.workspaceTitle) {
    pieces.push(account.auth.workspaceTitle);
  }
  if (account.auth?.subscriptionActiveUntil) {
    pieces.push(`until ${formatShortDate(account.auth.subscriptionActiveUntil)}`);
  } else if (account.meta?.teamLabel) {
    pieces.push(account.meta.teamLabel);
  } else if (account.meta?.subscriptionLabel) {
    pieces.push(account.meta.subscriptionLabel);
  }
  return pieces.join(" • ");
}

function sortAccountsForCompare(accounts) {
  return [...(accounts || [])].sort((left, right) => {
    const leftConnected = left.health?.connected ? 0 : 1;
    const rightConnected = right.health?.connected ? 0 : 1;
    if (leftConnected !== rightConnected) {
      return leftConnected - rightConnected;
    }

    const leftPrimary =
      typeof left.remoteUsage?.primaryWindow?.remainingPercent === "number"
        ? left.remoteUsage.primaryWindow.remainingPercent
        : Number.POSITIVE_INFINITY;
    const rightPrimary =
      typeof right.remoteUsage?.primaryWindow?.remainingPercent === "number"
        ? right.remoteUsage.primaryWindow.remainingPercent
        : Number.POSITIVE_INFINITY;
    if (leftPrimary !== rightPrimary) {
      return leftPrimary - rightPrimary;
    }

    const leftSecondary =
      typeof left.remoteUsage?.secondaryWindow?.remainingPercent === "number"
        ? left.remoteUsage.secondaryWindow.remainingPercent
        : Number.POSITIVE_INFINITY;
    const rightSecondary =
      typeof right.remoteUsage?.secondaryWindow?.remainingPercent === "number"
        ? right.remoteUsage.secondaryWindow.remainingPercent
        : Number.POSITIVE_INFINITY;
    if (leftSecondary !== rightSecondary) {
      return leftSecondary - rightSecondary;
    }

    const leftExpiry = parseSortDate(left.auth?.subscriptionActiveUntil);
    const rightExpiry = parseSortDate(right.auth?.subscriptionActiveUntil);
    if (leftExpiry !== rightExpiry) {
      return leftExpiry - rightExpiry;
    }

    return resolveAccountTitle(left, accounts).localeCompare(
      resolveAccountTitle(right, accounts),
    );
  });
}

function parseSortDate(value) {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }
  const parsed = new Date(value).valueOf();
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

loadSnapshot();
window.setInterval(() => {
  if (document.hidden) {
    return;
  }
  void loadSnapshot();
}, AUTO_REFRESH_MS);
