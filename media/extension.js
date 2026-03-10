const vscode = acquireVsCodeApi();
const state = vscode.getState() || {
  loading: true,
  error: null,
  missingProjectHome: false,
  projectHome: null,
  activeSlug: null,
  autoRefreshMs: 0,
  viewMode: "standard",
  sortOrder: "asc",
  summary: null,
  accounts: [],
};

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

  if (state.viewMode === "minimal") {
    section.classList.add("toolbar-minimal");
    const actions = document.createElement("div");
    actions.className = "toolbar-actions";
    actions.appendChild(makeButton(getSortButtonLabel(), "toggleSortOrder", null, "secondary"));
    section.appendChild(actions);
    section.appendChild(renderModePicker());
    return section;
  }

  const top = document.createElement("div");
  top.className = "toolbar-top";

  const copy = document.createElement("div");
  copy.className = "toolbar-copy";
  copy.innerHTML = `
    <p class="eyebrow">multi-codex vscode</p>
    <h2>${escapeHtml(getActiveTitle())}</h2>
    <div class="toolbar-meta">${escapeHtml(state.projectHome || "No project home selected")}<br>Open resumes the latest slot session when local history exists. Auto refresh ${escapeHtml(formatDuration(state.autoRefreshMs))} · manual refresh for immediate quota updates</div>
  `;

  const actions = document.createElement("div");
  actions.className = "toolbar-actions toolbar-action-grid";
  actions.appendChild(makeButton("Refresh", "refresh", null, "secondary"));
  actions.appendChild(makeButton(getSortButtonLabel(), "toggleSortOrder", null, "secondary"));
  actions.appendChild(makeButton("New", "createSlot", null, "action"));
  actions.appendChild(makeButton("Import", "importCurrent", null, "secondary"));
  actions.appendChild(makeButton("Home", "selectProjectHome", null, "ghost"));
  actions.appendChild(makeButton("Open", "launchActiveCodex", state.activeSlug, "action"));
  actions.appendChild(makeButton("Resume", "resumeActiveSlot", state.activeSlug, "secondary"));
  actions.appendChild(makeButton("Login", "loginActiveSlot", state.activeSlug, "ghost"));
  top.append(copy, actions);
  section.appendChild(top);
  section.appendChild(renderModePicker());
  return section;
}

function renderModePicker() {
  const wrap = document.createElement("div");
  wrap.className = "mode-picker";

  const label = document.createElement("div");
  label.className = "mode-label";
  label.textContent = "View";

  const options = [
    ["minimal", "Minimal"],
    ["standard", "Standard"],
    ["detailed", "Detailed"],
  ];

  const group = document.createElement("div");
  group.className = "mode-buttons";
  for (const [value, text] of options) {
    const button = makeButton(text, "setViewMode", null, "ghost");
    button.dataset.value = value;
    button.dataset.current = state.viewMode === value ? "true" : "false";
    button.classList.add("mode-button");
    group.appendChild(button);
  }

  wrap.append(label, group);
  return wrap;
}

function renderSummary() {
  const section = document.createElement("section");
  section.className = "summary";

  const summary = state.summary || {};
  section.innerHTML = `
    <h3>Slot summary</h3>
    <div class="summary-meta">Active slot: ${escapeHtml(getActiveTitle())}</div>
  `;

  const grid = document.createElement("div");
  grid.className = "summary-grid";
  const items = [
    ["5h sort", state.sortOrder === "desc" ? "High to low" : "Low to high"],
    ["Connected", formatNumber(summary.connectedCount)],
    ["Active", formatNumber(summary.activeCount)],
    ["Refreshable", formatNumber(summary.refreshableCount)],
    ["Latest update", formatRelative(summary.latestUpdateAt)],
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
  if (mode === "minimal") {
    return `
      <div class="minimal-inline">
        <div class="minimal-primary">${renderMeter(account.primaryRemainingPercent, account.primaryLabel)}</div>
        <div class="minimal-reset">Reset ${escapeHtml(formatDateTime(account.primaryResetAt))}</div>
      </div>
    `;
  }

  if (mode === "detailed") {
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
      <div class="card-detail">${escapeHtml(account.detail || "")}</div>
      <div class="card-path">${escapeHtml(account.homeDir)}</div>
    `;
  }

  return `
    <div class="card-grid">
      ${renderKv("5h left", renderMeter(account.primaryRemainingPercent, account.primaryLabel))}
      ${renderKv("5h reset", escapeHtml(formatDateTime(account.primaryResetAt)))}
      ${renderKv("Week left", renderMeter(account.secondaryRemainingPercent, account.secondaryLabel))}
      ${renderKv("Week reset", escapeHtml(formatDateTime(account.secondaryResetAt)))}
    </div>
  `;
}

function buildCardActions(account, mode) {
  if (mode === "minimal") {
    return [makeButton("Use + Open", "launchCodex", account.slug, "action", !account.connected)];
  }

  if (mode === "detailed") {
    return [
      makeButton("Use", "activateSlot", account.slug, "secondary"),
      makeButton("Use + Open", "launchCodex", account.slug, "action", !account.connected),
      makeButton("Use + Resume", "resumeSlot", account.slug, "secondary", !account.connected || Number(account.sessionFiles || 0) === 0),
      makeButton("Use + Login", "loginSlot", account.slug, "ghost"),
      makeButton("Delete", "removeSlot", account.slug, "ghost"),
    ];
  }

  return [
    makeButton("Use", "activateSlot", account.slug, "secondary"),
    makeButton("Use + Open", "launchCodex", account.slug, "action", !account.connected),
    makeButton("Use + Resume", "resumeSlot", account.slug, "secondary", !account.connected || Number(account.sessionFiles || 0) === 0),
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

render();
vscode.postMessage({ type: "ready" });
