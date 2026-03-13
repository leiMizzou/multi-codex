const vscode = acquireVsCodeApi();
const state = vscode.getState() || {
  loading: true,
  error: null,
  missingProjectHome: false,
  projectHome: null,
  activeSlug: null,
  autoRefreshMs: 0,
  viewMode: "standard",
  tokenWindow: "all",
  sortOrder: "asc",
  proxyMode: "off",
  proxySummary: "Proxy off",
  launchRequiresConnectedSlot: true,
  summary: null,
  accounts: [],
};
const TOKEN_WINDOW_OPTIONS = [
  ["all", "All"],
  ["1d", "1d"],
  ["7d", "7d"],
  ["30d", "30d"],
];

const app = document.querySelector("#app");

window.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || message.type !== "state") {
    return;
  }
  Object.assign(state, message.payload || {});
  vscode.setState(state);
  render();
});

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) {
    return;
  }

  vscode.postMessage({
    type: target.dataset.action,
    slug: target.dataset.slug || null,
    value: target.dataset.value || null,
  });
});

function render() {
  app.replaceChildren();

  const shell = document.createElement("div");
  shell.className = "shell";
  shell.appendChild(renderToolbar());

  if (state.loading) {
    shell.appendChild(renderEmpty("Loading slots", "Reading the saved multi-codex accounts and quota windows."));
    app.appendChild(shell);
    return;
  }

  if (state.missingProjectHome) {
    shell.appendChild(
      renderEmpty(
        "Project home required",
        "Select an account store or switch to the extension storage first.",
        [
          makeButton("Use Local Store", "useManagedStorage", null, "action"),
          makeButton("Select Home", "selectProjectHome", null, "ghost"),
        ],
      ),
    );
    app.appendChild(shell);
    return;
  }

  if (state.error) {
    shell.appendChild(renderEmpty("Refresh failed", state.error));
    app.appendChild(shell);
    return;
  }

  if (state.viewMode !== "minimal") {
    shell.appendChild(renderSummary());
  }

  if (!Array.isArray(state.accounts) || state.accounts.length === 0) {
    shell.appendChild(
      renderEmpty(
        "No slots yet",
        "Create a slot here or import the current ~/.codex login. The extension can store slots on its own.",
        [
          makeButton("New Slot", "createSlot", null, "action"),
          makeButton("Import Current", "importCurrent", null, "secondary"),
          makeButton("Select Home", "selectProjectHome", null, "ghost"),
        ],
      ),
    );
    app.appendChild(shell);
    return;
  }

  const cards = document.createElement("section");
  cards.className = "cards";
  for (const account of state.accounts) {
    cards.appendChild(renderCard(account));
  }
  shell.appendChild(cards);
  app.appendChild(shell);
  applyMeterWidths();
}

function renderToolbar() {
  const section = document.createElement("section");
  section.className = "toolbar";
  const activeAccount = (state.accounts || []).find((account) => account.slug === state.activeSlug);
  const disableOpen = !activeAccount || activeAccount.canOpen === false;
  const disableResume = !activeAccount || activeAccount.canResume === false;
  const disableLogin = !activeAccount;

  if (state.viewMode === "minimal") {
    section.classList.add("toolbar-minimal");
    const actions = document.createElement("div");
    actions.className = "toolbar-actions";
    actions.appendChild(makeButton(getSortButtonLabel(), "toggleSortOrder", null, "secondary"));
    section.appendChild(actions);
    section.appendChild(renderTokenWindowPicker());
    section.appendChild(renderModePicker());
    return section;
  }

  const header = document.createElement("div");
  header.className = "toolbar-header";
  header.innerHTML = `
    <h2>${escapeHtml(getActiveTitle())}</h2>
    <div class="toolbar-meta">${escapeHtml(state.proxySummary || "Proxy off")} · refresh ${escapeHtml(formatDuration(state.autoRefreshMs))}</div>
  `;
  section.appendChild(header);

  const primary = document.createElement("div");
  primary.className = "toolbar-actions";
  primary.appendChild(
    makeButton("Open", "launchActiveCodex", state.activeSlug, "action", disableOpen),
  );
  primary.appendChild(
    makeButton("Resume", "resumeActiveSlot", state.activeSlug, "secondary", disableResume),
  );
  primary.appendChild(makeButton("Refresh", "refresh", null, "secondary"));
  primary.appendChild(makeButton(getSortButtonLabel(), "toggleSortOrder", null, "ghost"));
  section.appendChild(primary);

  const manage = document.createElement("div");
  manage.className = "toolbar-actions";
  manage.appendChild(makeButton("New", "createSlot", null, "secondary"));
  manage.appendChild(makeButton("Import", "importCurrent", null, "secondary"));
  manage.appendChild(
    makeButton("Login", "loginActiveSlot", state.activeSlug, "ghost", disableLogin),
  );
  manage.appendChild(makeButton("Home", "selectProjectHome", null, "ghost"));
  section.appendChild(manage);

  section.appendChild(renderTokenWindowPicker());
  section.appendChild(renderModePicker());
  return section;
}

function renderModePicker() {
  return renderButtonPicker("View", "setViewMode", state.viewMode, [
    ["minimal", "Minimal"],
    ["standard", "Standard"],
    ["detailed", "Detailed"],
  ]);
}

function renderTokenWindowPicker() {
  return renderButtonPicker(
    "Tokens",
    "setTokenWindow",
    normalizeTokenWindow(state.tokenWindow),
    TOKEN_WINDOW_OPTIONS,
  );
}

function renderButtonPicker(labelText, action, currentValue, options) {
  const wrap = document.createElement("div");
  wrap.className = "mode-picker";

  const label = document.createElement("div");
  label.className = "mode-label";
  label.textContent = labelText;

  const group = document.createElement("div");
  group.className = "mode-buttons";
  for (const [value, text] of options) {
    const button = makeButton(text, action, null, "ghost");
    button.dataset.value = value;
    button.dataset.current = currentValue === value ? "true" : "false";
    button.classList.add("mode-button");
    group.appendChild(button);
  }

  wrap.append(label, group);
  return wrap;
}

function renderSummary() {
  const section = document.createElement("section");
  section.className = "summary";

  const summary = getWindowedUsage(state.summary || {}, state.tokenWindow);
  const bd = summary.tokenBreakdown || {};
  const cost = summary.tokenCost;
  section.innerHTML = `
    <h3>Token usage · ${escapeHtml(getTokenWindowShortLabel(state.tokenWindow))} · ${escapeHtml(formatNumber((state.summary || {}).activeCount))} active / ${escapeHtml(formatNumber((state.summary || {}).accountCount))} slots</h3>
  `;

  const grid = document.createElement("div");
  grid.className = "summary-grid";
  const items = [
    ["Total tokens", formatNumber(summary.localTotalTokens)],
    ["Input", formatNumber(bd.input_tokens)],
    ["Output", formatNumber(bd.output_tokens)],
    ["Cached input", formatNumber(bd.cached_input_tokens)],
    ["Reasoning", formatNumber(bd.reasoning_output_tokens)],
    ["Est. cost", cost ? `$${cost.totalCost.toFixed(2)}` : "—"],
    ["Saved by cache", cost ? `$${cost.savedByCaching.toFixed(2)}` : "—"],
  ];
  for (const [label, value] of items) {
    const metric = document.createElement("div");
    metric.className = "metric";
    metric.innerHTML = `
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric-value">${escapeHtml(value)}</div>
      `;
    grid.appendChild(metric);
  }
  section.appendChild(grid);

  const meta = document.createElement("div");
  meta.className = "summary-meta";
  meta.textContent = `Window ${getTokenWindowLongLabel(state.tokenWindow)} from local session logs.`;
  section.appendChild(meta);

  return section;
}

function renderCard(account) {
  const mode = state.viewMode || "standard";
  const article = document.createElement("article");
  article.className = "card";
  article.dataset.active = account.slug === state.activeSlug ? "true" : "false";

  const statusTone = escapeHtml(account.statusTone || "muted");
  article.innerHTML = `
    <div class="card-head">
      <div class="card-main">
        <div class="card-title" data-action="activateSlot" data-slug="${escapeHtml(account.slug)}">${escapeHtml(account.title)}</div>
        <div class="card-subtitle">${escapeHtml(account.slug)} · ${escapeHtml(account.workspace || "No workspace title")} · plan ${escapeHtml(account.plan || "—")} · ${escapeHtml(formatSessionCount(account.sessionFiles))}</div>
      </div>
      <div class="pill ${statusTone}">${escapeHtml(account.statusLabel || "Unknown")}</div>
    </div>
    ${renderCardContent(account, mode)}
  `;

  const actions = document.createElement("div");
  actions.className = "card-actions";
  for (const action of buildCardActions(account, mode)) {
    actions.appendChild(action);
  }
  article.appendChild(actions);
  return article;
}

function renderCardContent(account, mode) {
  const tokenMetrics = getWindowedUsage(account, state.tokenWindow);
  if (mode === "minimal") {
    return `
      <div class="minimal-inline">
        <div class="minimal-primary">${renderMeter(account.primaryRemainingPercent, account.primaryLabel)}</div>
        <div class="minimal-reset">Reset ${escapeHtml(formatDateTime(account.primaryResetAt))}</div>
      </div>
    `;
  }

  if (mode === "detailed") {
    const dbd = tokenMetrics.tokenBreakdown || {};
    const dcost = tokenMetrics.tokenCost;
    return `
      <div class="card-grid">
        ${renderKv("5h left", renderMeter(account.primaryRemainingPercent, account.primaryLabel))}
        ${renderKv("5h reset", escapeHtml(formatDateTime(account.primaryResetAt)))}
        ${renderKv("Week left", renderMeter(account.secondaryRemainingPercent, account.secondaryLabel))}
        ${renderKv("Week reset", escapeHtml(formatDateTime(account.secondaryResetAt)))}
        ${renderKv("Expires", escapeHtml(formatDate(account.subscriptionActiveUntil)))}
        ${renderKv("Quota refresh", escapeHtml(formatDateTime(account.quotaFetchedAt)))}
      </div>
      <div class="card-grid">
        ${renderKv("Workspace", escapeHtml(account.workspace || "—"))}
        ${renderKv("Plan", escapeHtml(account.plan || "—"))}
      </div>
      <div class="card-grid token-stats">
        ${renderKv(withTokenWindowLabel("Total tokens"), escapeHtml(formatNumber(tokenMetrics.localTotalTokens)))}
        ${renderKv(withTokenWindowLabel("Input"), escapeHtml(formatNumber(dbd.input_tokens)))}
        ${renderKv(withTokenWindowLabel("Output"), escapeHtml(formatNumber(dbd.output_tokens)))}
        ${renderKv(withTokenWindowLabel("Cached"), escapeHtml(formatNumber(dbd.cached_input_tokens)))}
        ${renderKv(withTokenWindowLabel("Reasoning"), escapeHtml(formatNumber(dbd.reasoning_output_tokens)))}
        ${renderKv(withTokenWindowLabel("Est. cost"), escapeHtml(dcost ? '$' + dcost.totalCost.toFixed(2) : '—'))}
      </div>
      <div class="card-detail">${escapeHtml(account.detail || "")}</div>
      <div class="card-path">${escapeHtml(account.homeDir)}</div>
    `;
  }

  const sbd = tokenMetrics.tokenBreakdown || {};
  const scost = tokenMetrics.tokenCost;
  return `
    <div class="card-grid">
      ${renderKv("5h left", renderMeter(account.primaryRemainingPercent, account.primaryLabel))}
      ${renderKv("5h reset", escapeHtml(formatDateTime(account.primaryResetAt)))}
      ${renderKv("Week left", renderMeter(account.secondaryRemainingPercent, account.secondaryLabel))}
      ${renderKv("Week reset", escapeHtml(formatDateTime(account.secondaryResetAt)))}
    </div>
    <div class="card-grid token-stats">
      ${renderKv(withTokenWindowLabel("Tokens"), escapeHtml(formatNumber(tokenMetrics.localTotalTokens)))}
      ${renderKv(withTokenWindowLabel("In/Out"), escapeHtml(formatNumber(sbd.input_tokens) + ' / ' + formatNumber(sbd.output_tokens)))}
      ${renderKv(withTokenWindowLabel("Cached"), escapeHtml(formatNumber(sbd.cached_input_tokens)))}
      ${renderKv(withTokenWindowLabel("Cost"), escapeHtml(scost ? '$' + scost.totalCost.toFixed(2) : '—'))}
    </div>
  `;
}

function buildCardActions(account, mode) {
  const disableOpen = account.canOpen === false;
  const disableResume = account.canResume === false;

  if (mode === "minimal") {
    return [makeButton("Use + Open", "launchCodex", account.slug, "action", disableOpen)];
  }

  if (mode === "detailed") {
    return [
      makeButton("Use", "activateSlot", account.slug, "secondary"),
      makeButton("Use + Open", "launchCodex", account.slug, "action", disableOpen),
      makeButton("Use + Resume", "resumeSlot", account.slug, "secondary", disableResume),
      makeButton("Use + Login", "loginSlot", account.slug, "ghost"),
      makeButton("Delete", "removeSlot", account.slug, "ghost"),
    ];
  }

  return [
    makeButton("Use", "activateSlot", account.slug, "secondary"),
    makeButton("Use + Open", "launchCodex", account.slug, "action", disableOpen),
    makeButton("Use + Resume", "resumeSlot", account.slug, "secondary", disableResume),
    makeButton("Use + Login", "loginSlot", account.slug, "ghost"),
  ];
}

function formatSessionCount(value) {
  const count = Number(value || 0);
  return `${count} session${count === 1 ? "" : "s"}`;
}

function getSortButtonLabel() {
  return state.sortOrder === "desc" ? "Sort 5h ↓" : "Sort 5h ↑";
}

function getWindowedUsage(source, tokenWindow) {
  const normalizedWindow = normalizeTokenWindow(tokenWindow);
  const usage = source?.tokenWindows?.[normalizedWindow];
  if (usage) {
    return usage;
  }
  return {
    localTotalTokens: source?.localTotalTokens || 0,
    tokenBreakdown: source?.tokenBreakdown || null,
    tokenCost: source?.tokenCost || null,
  };
}

function withTokenWindowLabel(label) {
  const suffix = getTokenWindowShortLabel(state.tokenWindow);
  return suffix === "All" ? label : `${label} (${suffix})`;
}

function getTokenWindowShortLabel(value) {
  switch (normalizeTokenWindow(value)) {
    case "1d":
      return "1d";
    case "7d":
      return "7d";
    case "30d":
      return "30d";
    default:
      return "All";
  }
}

function getTokenWindowLongLabel(value) {
  switch (normalizeTokenWindow(value)) {
    case "1d":
      return "Last 24 hours";
    case "7d":
      return "Last 7 days";
    case "30d":
      return "Last 30 days";
    default:
      return "All time";
  }
}

function renderKv(label, valueHtml) {
  return `
    <div class="kv">
      <div class="kv-label">${escapeHtml(label)}</div>
      <div class="kv-value">${valueHtml}</div>
    </div>
  `;
}

function renderMeter(value, label) {
  if (typeof value !== "number") {
    return escapeHtml(label || "—");
  }
  const safe = Math.max(0, Math.min(100, value));
  return `
    <div class="meter">
      <div>${escapeHtml(label || `${safe}% left`)}</div>
      <div class="track"><div class="fill" data-width="${safe}"></div></div>
    </div>
  `;
}

function applyMeterWidths() {
  for (const fill of app.querySelectorAll(".fill[data-width]")) {
    const value = Number(fill.dataset.width);
    const safe = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
    fill.style.width = `${safe}%`;
  }
}

function renderEmpty(title, body, actions = []) {
  const section = document.createElement("section");
  section.className = "empty";
  section.innerHTML = `
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(body)}</p>
  `;
  if (Array.isArray(actions) && actions.length > 0) {
    const actionRow = document.createElement("div");
    actionRow.className = "toolbar-actions";
    for (const action of actions) {
      actionRow.appendChild(action);
    }
    section.appendChild(actionRow);
  }
  return section;
}

function makeButton(label, action, slug, tone = "action", disabled = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `action ${tone}`;
  button.dataset.action = action;
  if (slug) {
    button.dataset.slug = slug;
  }
  button.disabled = disabled;
  button.textContent = label;
  return button;
}

function getActiveTitle() {
  const active = (state.accounts || []).find((account) => account.slug === state.activeSlug);
  return active ? active.title : "No active slot";
}

function formatNumber(value) {
  return typeof value === "number" ? value.toLocaleString("en-US") : "—";
}

function formatDuration(value) {
  if (!value) {
    return "off";
  }
  const hours = Math.round(value / 3_600_000);
  return `${hours}h`;
}

function formatDate(value) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return String(value);
  }
  return date.toLocaleDateString();
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

function normalizeTokenWindow(value) {
  return value === "1d" || value === "7d" || value === "30d" ? value : "all";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

render();
vscode.postMessage({ type: "ready" });
