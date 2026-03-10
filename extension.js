"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vscode = require("vscode");

const {
  buildDashboardPayload,
  copyCurrentAuth,
  createAccount,
  deleteAccount,
} = require("./lib/core");

const CONFIG_PREFIX = "multiCodex";
const VIEW_ID = "multiCodex.sidebar";
const PANEL_ID = "multiCodex.panel";
const ACTIVE_SLOT_KEY = "multiCodex.activeSlot";
const ACTIVE_SLOT_CONFIG_KEY = "activeSlot";
const SORT_ORDER_CONFIG_KEY = "primarySortOrder";
const MANAGED_HOME_SEGMENT = "store";

function activate(context) {
  const controller = new MultiCodexController(context);
  context.subscriptions.push(controller);
}

function deactivate() {}

class MultiCodexController {
  constructor(context) {
    this.context = context;
    this.sidebarView = null;
    this.panel = null;
    this.cachedSnapshot = null;
    this.cachedProjectHome = null;
    this.cachedAt = 0;
    this.state = {
      loading: true,
      error: null,
      missingProjectHome: false,
      projectHome: null,
      activeSlug: null,
      autoRefreshMs: this.getAutoRefreshMs(),
      viewMode: this.getViewMode(),
      sortOrder: this.getSortOrder(),
      summary: null,
      accounts: [],
    };

    this.statusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.statusBar.command = "multiCodex.quickSwitch";
    this.statusBar.show();

    this.refreshTimer = null;
    this.envCollection = context.environmentVariableCollection;
    this.disposables = [
      this.statusBar,
      vscode.window.registerWebviewViewProvider(
        VIEW_ID,
        {
          resolveWebviewView: (view) => this.resolveSidebarView(view),
        },
        { webviewOptions: { retainContextWhenHidden: true } },
      ),
      vscode.commands.registerCommand("multiCodex.refresh", () =>
        this.refresh(true),
      ),
      vscode.commands.registerCommand("multiCodex.createSlot", () =>
        this.createSlot(),
      ),
      vscode.commands.registerCommand("multiCodex.importCurrentAuth", () =>
        this.importCurrentAuth(),
      ),
      vscode.commands.registerCommand("multiCodex.removeSlot", () =>
        this.removeSlot(),
      ),
      vscode.commands.registerCommand("multiCodex.setViewMode", () =>
        this.pickViewMode(),
      ),
      vscode.commands.registerCommand("multiCodex.toggleSortOrder", () =>
        this.toggleSortOrder(),
      ),
      vscode.commands.registerCommand("multiCodex.selectProjectHome", () =>
        this.selectProjectHome(),
      ),
      vscode.commands.registerCommand("multiCodex.useManagedStorage", () =>
        this.useManagedStorage(),
      ),
      vscode.commands.registerCommand("multiCodex.quickSwitch", () =>
        this.quickSwitch(),
      ),
      vscode.commands.registerCommand("multiCodex.quickLaunch", () =>
        this.quickLaunch(),
      ),
      vscode.commands.registerCommand("multiCodex.quickLogin", () =>
        this.quickLogin(),
      ),
      vscode.commands.registerCommand("multiCodex.resumeActiveSlot", () =>
        this.launchResumeForSlot(this.state.activeSlug),
      ),
      vscode.commands.registerCommand("multiCodex.openPanel", () =>
        this.openPanel(),
      ),
      vscode.commands.registerCommand("multiCodex.launchActiveCodex", () =>
        this.launchCodexForSlot(this.state.activeSlug),
      ),
      vscode.commands.registerCommand("multiCodex.loginActiveSlot", () =>
        this.launchLoginForSlot(this.state.activeSlug),
      ),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration(CONFIG_PREFIX)) {
          return;
        }
        this.cachedAt = 0;
        this.state.autoRefreshMs = this.getAutoRefreshMs();
        this.resetRefreshTimer();
        void this.refresh(true, true);
      }),
    ];

    this.resetRefreshTimer();
    void this.refresh(false, true);
  }

  dispose() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    if (this.panel) {
      this.panel.dispose();
    }
  }

  async resolveSidebarView(view) {
    this.sidebarView = view;
    this.configureWebview(view.webview);

    const subscriptions = [
      view.webview.onDidReceiveMessage((message) => this.handleMessage(message)),
      view.onDidChangeVisibility(() => {
        if (!view.visible) {
          return;
        }
        void this.refresh(false, true);
      }),
      view.onDidDispose(() => {
        if (this.sidebarView === view) {
          this.sidebarView = null;
        }
      }),
    ];

    for (const subscription of subscriptions) {
      this.context.subscriptions.push(subscription);
    }

    await this.pushState();
  }

  configureWebview(webview) {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };
    webview.html = this.renderHtml(webview);
  }

  renderHtml(webview) {
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "extension.css"),
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "extension.js"),
    );
    const nonce = createNonce();

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="${cssUri}" />
    <title>Multi Codex</title>
  </head>
  <body>
    <div id="app"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }

  async openPanel() {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside, true);
      await this.pushState();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      PANEL_ID,
      "Multi Codex",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
      },
    );
    this.panel = panel;
    this.configureWebview(panel.webview);

    const subscriptions = [
      panel.webview.onDidReceiveMessage((message) => this.handleMessage(message)),
      panel.onDidDispose(() => {
        if (this.panel === panel) {
          this.panel = null;
        }
      }),
      panel.onDidChangeViewState(() => {
        if (!panel.visible) {
          return;
        }
        void this.refresh(false, true);
      }),
    ];

    for (const subscription of subscriptions) {
      this.context.subscriptions.push(subscription);
    }

    await this.pushState();
  }

  async handleMessage(message) {
    switch (message?.type) {
      case "ready":
        await this.pushState();
        return;
      case "refresh":
        await this.refresh(true);
        return;
      case "setViewMode":
        await this.setViewMode(message.value);
        return;
      case "toggleSortOrder":
        await this.toggleSortOrder();
        return;
      case "createSlot":
        await this.createSlot();
        return;
      case "importCurrent":
        await this.importCurrentAuth();
        return;
      case "removeSlot":
        await this.removeSlot(message.slug || null);
        return;
      case "useManagedStorage":
        await this.useManagedStorage();
        return;
      case "selectProjectHome":
        await this.selectProjectHome();
        return;
      case "activateSlot":
        await this.setActiveSlot(message.slug);
        return;
      case "launchCodex":
      case "launchActiveCodex":
        await this.launchCodexForSlot(message.slug || this.state.activeSlug);
        return;
      case "loginSlot":
      case "loginActiveSlot":
        await this.launchLoginForSlot(message.slug || this.state.activeSlug);
        return;
      case "resumeSlot":
      case "resumeActiveSlot":
        await this.launchResumeForSlot(message.slug || this.state.activeSlug);
        return;
      default:
        return;
    }
  }

  async refresh(force = false, background = false) {
    try {
      this.state = await this.buildState(force);
      this.updateStatusBar();
      await this.pushState();
    } catch (error) {
      this.state = {
        ...this.state,
        loading: false,
        error: error.message || String(error),
      };
      this.updateStatusBar();
      await this.pushState();
      if (!background) {
        void vscode.window.showErrorMessage(this.state.error);
      }
    }
  }

  async buildState(force = false) {
    const projectHome = await this.resolveProjectHome();
    const autoRefreshMs = this.getAutoRefreshMs();

    if (!projectHome) {
      return {
        loading: false,
        error: null,
        missingProjectHome: true,
        projectHome: null,
        activeSlug: null,
        autoRefreshMs,
        viewMode: this.getViewMode(),
        sortOrder: this.getSortOrder(),
        summary: null,
        accounts: [],
      };
    }

    const now = Date.now();
    if (
      !force &&
      this.cachedSnapshot &&
      this.cachedProjectHome === projectHome &&
      now - this.cachedAt < autoRefreshMs
    ) {
      return this.composeState(this.cachedSnapshot, projectHome, autoRefreshMs);
    }

    const snapshot = await buildDashboardPayload({
      projectHome,
      deep: !this.getFastScan(),
      remote: true,
    });
    this.cachedSnapshot = snapshot;
    this.cachedProjectHome = projectHome;
    this.cachedAt = now;
    return this.composeState(snapshot, projectHome, autoRefreshMs);
  }

  composeState(snapshot, projectHome, autoRefreshMs) {
    const sortOrder = this.getSortOrder();
    const accounts = sortAccounts(snapshot.accounts || [], sortOrder).map((account, _, all) =>
      normalizeAccount(account, all),
    );
    const activeSlug = this.resolveActiveSlug(accounts);
    this.syncTerminalEnvironment(accounts, activeSlug);

    return {
      loading: false,
      error: null,
      missingProjectHome: false,
      projectHome,
      activeSlug,
      autoRefreshMs,
      viewMode: this.getViewMode(),
      sortOrder,
      summary: snapshot.summary,
      accounts,
    };
  }

  resolveActiveSlug(accounts) {
    const saved = String(
      vscode.workspace.getConfiguration(CONFIG_PREFIX).get(ACTIVE_SLOT_CONFIG_KEY, ""),
    ).trim() || this.context.globalState.get(ACTIVE_SLOT_KEY);
    if (saved && accounts.some((account) => account.slug === saved)) {
      return saved;
    }
    return accounts.find((account) => account.connected)?.slug || accounts[0]?.slug || null;
  }

  async setActiveSlot(slug) {
    if (!slug) {
      return;
    }
    await this.context.globalState.update(ACTIVE_SLOT_KEY, slug);
    await vscode.workspace
      .getConfiguration(CONFIG_PREFIX)
      .update(ACTIVE_SLOT_CONFIG_KEY, slug, vscode.ConfigurationTarget.Global);
    this.state = {
      ...this.state,
      activeSlug: slug,
    };
    this.syncTerminalEnvironment(this.state.accounts || [], slug);
    this.updateStatusBar();
    await this.pushState();
  }

  async quickSwitch() {
    const picked = await this.pickAccount("Choose the active multi-codex slot");
    if (!picked) {
      return;
    }
    await this.setActiveSlot(picked.account.slug);
  }

  async quickLaunch() {
    const picked = await this.pickAccount("Choose a slot to launch Codex");
    if (!picked) {
      return;
    }
    await this.launchCodexForSlot(picked.account.slug);
  }

  async quickLogin() {
    const picked = await this.pickAccount("Choose a slot to launch Codex login");
    if (!picked) {
      return;
    }
    await this.launchLoginForSlot(picked.account.slug);
  }

  async quickResume() {
    const picked = await this.pickAccount("Choose a slot to resume Codex");
    if (!picked) {
      return;
    }
    await this.launchResumeForSlot(picked.account.slug);
  }

  async createSlot() {
    try {
      const projectHome = await this.resolveProjectHome();
      const name = await this.promptForSlotName({
        placeHolder: "team-a, personal, client-1",
        prompt: "Create a new slot in the current account store",
      });
      if (!name) {
        return;
      }
      const account = await createAccount(name, projectHome);
      this.invalidateCache();
      await this.refresh(true, true);
      await this.setActiveSlot(account.slug);
      void vscode.window.showInformationMessage(`Created slot '${account.slug}'.`);
    } catch (error) {
      void vscode.window.showErrorMessage(error.message || String(error));
    }
  }

  async importCurrentAuth() {
    try {
      const projectHome = await this.resolveProjectHome();
      const target = await this.pickImportTarget();
      if (!target) {
        return;
      }

      const imported = await copyCurrentAuth(target, { projectHome });
      this.invalidateCache();
      await this.refresh(true, true);
      await this.setActiveSlot(imported.slug);

      if (Array.isArray(imported.copied) && imported.copied.length > 0) {
        void vscode.window.showInformationMessage(
          `Imported current login into '${imported.slug}'.`,
        );
        return;
      }

      void vscode.window.showWarningMessage(
        `No auth files were found in ~/.codex. Slot '${imported.slug}' was created, but nothing was imported.`,
      );
    } catch (error) {
      void vscode.window.showErrorMessage(error.message || String(error));
    }
  }

  async removeSlot(slug = null) {
    try {
      let targetSlug = slug;
      if (!targetSlug) {
        const picked = await this.pickAccount("Choose a slot to delete");
        targetSlug = picked?.account?.slug || null;
      }
      if (!targetSlug) {
        return;
      }

      const confirmed = await vscode.window.showWarningMessage(
        `Delete slot '${targetSlug}'? This removes its saved auth and local session history.`,
        { modal: true },
        "Delete",
      );
      if (confirmed !== "Delete") {
        return;
      }

      await deleteAccount(targetSlug, await this.resolveProjectHome());
      this.invalidateCache();
      await this.refresh(true, true);
      void vscode.window.showInformationMessage(`Deleted slot '${targetSlug}'.`);
    } catch (error) {
      void vscode.window.showErrorMessage(error.message || String(error));
    }
  }

  async selectProjectHome() {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Use as account store",
      title: "Select the multi-codex account store",
    });
    if (!picked || picked.length === 0) {
      return;
    }

    const candidate = picked[0].fsPath;
    if (!isAccountStoreHome(candidate)) {
      void vscode.window.showErrorMessage(
        "That folder does not look like a multi-codex account store. It must contain accounts/ or be an existing multi-codex project root.",
      );
      return;
    }

    await vscode.workspace
      .getConfiguration(CONFIG_PREFIX)
      .update("projectHome", candidate, vscode.ConfigurationTarget.Global);
    this.invalidateCache();
    await this.refresh(true);
  }

  async useManagedStorage() {
    try {
      const home = this.ensureManagedProjectHome();
      await vscode.workspace
        .getConfiguration(CONFIG_PREFIX)
        .update("projectHome", home, vscode.ConfigurationTarget.Global);
      this.invalidateCache();
      await this.refresh(true);
      void vscode.window.showInformationMessage(
        `Switched Multi Codex to extension storage: ${home}`,
      );
    } catch (error) {
      void vscode.window.showErrorMessage(error.message || String(error));
    }
  }

  async setViewMode(value) {
    const next = normalizeViewMode(value);
    this.state = {
      ...this.state,
      viewMode: next,
    };
    await this.pushState();
    await vscode.workspace
      .getConfiguration(CONFIG_PREFIX)
      .update("viewMode", next, vscode.ConfigurationTarget.Global);
  }

  async toggleSortOrder() {
    const next = this.getSortOrder() === "desc" ? "asc" : "desc";
    this.state = {
      ...this.state,
      sortOrder: next,
    };
    await this.pushState();
    await vscode.workspace
      .getConfiguration(CONFIG_PREFIX)
      .update(SORT_ORDER_CONFIG_KEY, next, vscode.ConfigurationTarget.Global);
  }

  async pickViewMode() {
    const current = this.getViewMode();
    const picked = await vscode.window.showQuickPick(
      [
        {
          label: "Minimal",
          description: "Only 5h left, 5h reset, and one open button",
          value: "minimal",
        },
        {
          label: "Standard",
          description: "Default slot information and common actions",
          value: "standard",
        },
        {
          label: "Detailed",
          description: "Full quota, plan, path, and extra metadata",
          value: "detailed",
        },
      ],
      {
        placeHolder: `Current mode: ${current}`,
        matchOnDescription: true,
      },
    );
    if (!picked) {
      return;
    }
    await this.setViewMode(picked.value);
  }

  async launchCodexForSlot(slug) {
    const account = await this.getAccountBySlug(slug);
    if (!account) {
      return;
    }
    await this.setActiveSlot(account.slug);
    this.openTerminal(account, this.buildPrimaryLaunchCommand(account));
  }

  async launchLoginForSlot(slug) {
    const account = await this.getAccountBySlug(slug);
    if (!account) {
      return;
    }
    await this.setActiveSlot(account.slug);
    this.openTerminal(account, `${this.getCodexCommand()} login`);
  }

  async launchResumeForSlot(slug) {
    const account = await this.getAccountBySlug(slug);
    if (!account) {
      return;
    }
    await this.setActiveSlot(account.slug);
    this.openTerminal(account, `${this.buildCodexLaunchPrefix()} resume --all`);
  }

  buildPrimaryLaunchCommand(account) {
    if (Number(account?.sessionFiles || 0) > 0) {
      return `${this.buildCodexLaunchPrefix()} resume --last --all`;
    }
    return this.buildCodexLaunchPrefix();
  }

  buildCodexLaunchPrefix() {
    const parts = [this.getCodexCommand()];

    if (this.getBypassApprovalsAndSandbox()) {
      parts.push("--dangerously-bypass-approvals-and-sandbox");
    }

    const model = this.getDefaultModel();
    if (model) {
      parts.push("-m", shellQuote(model));
    }

    const reasoningEffort = this.getDefaultReasoningEffort();
    if (reasoningEffort) {
      parts.push("-c", shellQuote(`model_reasoning_effort="${reasoningEffort}"`));
    }

    return parts.join(" ");
  }

  openTerminal(account, command) {
    const cwd =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
      this.state.projectHome ||
      account.homeDir;
    const targetViewColumn = vscode.ViewColumn.One;
    const terminalOptions = {
      name: `Codex · ${account.title}`,
      cwd,
      env: {
        CODEX_HOME: account.homeDir,
      },
    };
    if (this.getTerminalLocation() === "editor") {
      terminalOptions.location = {
        viewColumn: targetViewColumn,
        preserveFocus: false,
      };
    }
    const terminal = vscode.window.createTerminal(terminalOptions);
    terminal.show(true);
    terminal.sendText(command, true);
  }

  async getAccountBySlug(slug) {
    await this.refresh(false, true);
    if (this.state.missingProjectHome) {
      await this.selectProjectHome();
      return null;
    }

    const account = (this.state.accounts || []).find((item) => item.slug === slug);
    if (!account) {
      void vscode.window.showErrorMessage("That multi-codex slot is no longer available.");
      return null;
    }
    return account;
  }

  async pickAccount(placeHolder) {
    await this.refresh(false, true);
    if (this.state.missingProjectHome) {
      await this.selectProjectHome();
      return null;
    }

    if (!Array.isArray(this.state.accounts) || this.state.accounts.length === 0) {
      void vscode.window.showInformationMessage("No multi-codex slots are available yet.");
      return null;
    }

    return vscode.window.showQuickPick(
      this.state.accounts.map((account) => ({
        label: account.title,
        description: `${account.primaryLabel} · ${account.secondaryLabel}`,
        detail: `${account.slug} · ${account.statusLabel} · expires ${formatDate(account.subscriptionActiveUntil)}`,
        account,
      })),
      {
        placeHolder,
        matchOnDescription: true,
        matchOnDetail: true,
      },
    );
  }

  async pickImportTarget() {
    await this.refresh(false, true);
    const createNew = {
      label: "$(add) Create new slot",
      description: "Import the current ~/.codex login into a new slot",
      create: true,
    };

    const items = [
      createNew,
      ...((this.state.accounts || []).map((account) => ({
        label: account.title,
        description: `${account.slug} · overwrite the saved auth for this slot`,
        detail: `${account.statusLabel} · expires ${formatDate(account.subscriptionActiveUntil)}`,
        account,
      }))),
    ];

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Choose where to import the current ~/.codex login",
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!picked) {
      return null;
    }

    if (picked.create) {
      return this.promptForSlotName({
        placeHolder: "personal, team-a, client-1",
        prompt: "Name the new slot that should receive the current ~/.codex login",
        value: this.state.activeSlug || "",
      });
    }

    return picked.account.slug;
  }

  async promptForSlotName(options = {}) {
    return vscode.window.showInputBox({
      prompt: options.prompt || "Enter a slot name",
      placeHolder: options.placeHolder || "team-a",
      value: options.value || "",
      validateInput: (value) =>
        String(value || "").trim()
          ? null
          : "A slot name is required.",
    });
  }

  async resolveProjectHome() {
    const configHome = String(
      vscode.workspace.getConfiguration(CONFIG_PREFIX).get("projectHome", ""),
    ).trim();
    const candidates = [
      configHome,
      process.env.MULTI_CODEX_HOME || "",
      ...(vscode.workspace.workspaceFolders || []).map((folder) => folder.uri.fsPath),
      path.join(os.homedir(), "Documents", "GitHub", "multi-codex"),
      path.join(os.homedir(), "github", "multi-codex"),
    ];

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }
      if (isAccountStoreHome(candidate)) {
        return path.resolve(candidate);
      }
    }

    return this.ensureManagedProjectHome();
  }

  ensureManagedProjectHome() {
    const storageRoot =
      this.context.globalStorageUri?.fsPath ||
      this.context.globalStoragePath ||
      path.join(os.homedir(), ".multi-codex-vscode");
    const home = path.join(storageRoot, MANAGED_HOME_SEGMENT);
    fs.mkdirSync(path.join(home, "accounts"), { recursive: true });
    return home;
  }

  invalidateCache() {
    this.cachedSnapshot = null;
    this.cachedProjectHome = null;
    this.cachedAt = 0;
  }

  updateStatusBar() {
    if (this.state.missingProjectHome) {
      this.statusBar.text = "$(warning) Multi Codex: select home";
      this.statusBar.tooltip = "Select the multi-codex project home";
      this.statusBar.command = "multiCodex.selectProjectHome";
      return;
    }

    const active = (this.state.accounts || []).find(
      (account) => account.slug === this.state.activeSlug,
    );
    if (!active) {
      this.statusBar.text = "$(plug) Multi Codex";
      this.statusBar.tooltip = "No active slot selected";
      this.statusBar.command = "multiCodex.quickSwitch";
      return;
    }

    this.statusBar.text = `$(plug) ${active.title} ${active.primaryLabel} · ${active.secondaryLabel}`;
    this.statusBar.tooltip = `${active.slug}
Workspace: ${active.workspace || "—"}
Subscription: ${formatDateTime(active.subscriptionActiveUntil)}
5h reset: ${formatDateTime(active.primaryResetAt)}
Week reset: ${formatDateTime(active.secondaryResetAt)}
Quota refresh: ${formatDateTime(active.quotaFetchedAt)}
Click to quick switch`;
    this.statusBar.command = "multiCodex.quickSwitch";
  }

  async pushState() {
    for (const webview of this.getWebviews()) {
      await webview.postMessage({
        type: "state",
        payload: this.state,
      });
    }
  }

  getWebviews() {
    const webviews = [];
    if (this.sidebarView) {
      webviews.push(this.sidebarView.webview);
    }
    if (this.panel) {
      webviews.push(this.panel.webview);
    }
    return webviews;
  }

  getAutoRefreshMs() {
    const hours = Number(
      vscode.workspace
        .getConfiguration(CONFIG_PREFIX)
        .get("autoRefreshHours", 6),
    );
    if (!Number.isFinite(hours) || hours <= 0) {
      return 0;
    }
    return Math.round(hours * 60 * 60 * 1000);
  }

  getFastScan() {
    return Boolean(
      vscode.workspace.getConfiguration(CONFIG_PREFIX).get("fastScan", true),
    );
  }

  getCodexCommand() {
    const raw = String(
      vscode.workspace
        .getConfiguration(CONFIG_PREFIX)
        .get("codexCommand", "codex"),
    ).trim();
    return raw || "codex";
  }

  getDefaultModel() {
    const raw = String(
      vscode.workspace
        .getConfiguration(CONFIG_PREFIX)
        .get("defaultModel", "gpt-5.4"),
    ).trim();
    return raw || "gpt-5.4";
  }

  getDefaultReasoningEffort() {
    const raw = String(
      vscode.workspace
        .getConfiguration(CONFIG_PREFIX)
        .get("defaultReasoningEffort", "xhigh"),
    ).trim();
    return raw || "xhigh";
  }

  getBypassApprovalsAndSandbox() {
    return Boolean(
      vscode.workspace
        .getConfiguration(CONFIG_PREFIX)
        .get("bypassApprovalsAndSandbox", true),
    );
  }

  getViewMode() {
    return normalizeViewMode(
      vscode.workspace.getConfiguration(CONFIG_PREFIX).get("viewMode", "standard"),
    );
  }

  getSortOrder() {
    const raw = String(
      vscode.workspace
        .getConfiguration(CONFIG_PREFIX)
        .get(SORT_ORDER_CONFIG_KEY, "asc"),
    ).trim();
    return raw === "desc" ? "desc" : "asc";
  }

  getTerminalLocation() {
    const raw = String(
      vscode.workspace
        .getConfiguration(CONFIG_PREFIX)
        .get("terminalLocation", "editor"),
    ).trim();
    return raw === "panel" ? "panel" : "editor";
  }

  resetRefreshTimer() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }

    const ms = this.getAutoRefreshMs();
    if (!ms) {
      return;
    }

    this.refreshTimer = setInterval(() => {
      if (!this.sidebarView?.visible && !this.panel?.visible) {
        return;
      }
      void this.refresh(true, true);
    }, ms);
  }

  syncTerminalEnvironment(accounts, activeSlug) {
    if (!this.envCollection) {
      return;
    }

    const active = (accounts || []).find((account) => account.slug === activeSlug);
    if (!active?.homeDir) {
      this.envCollection.delete("CODEX_HOME");
      this.envCollection.delete("MULTI_CODEX_ACTIVE_SLOT");
      return;
    }

    this.envCollection.replace("CODEX_HOME", active.homeDir);
    this.envCollection.replace("MULTI_CODEX_ACTIVE_SLOT", active.slug);
    this.envCollection.description = `Multi Codex active slot: ${active.slug}`;
  }
}

function normalizeAccount(account, accounts) {
  return {
    slug: account.slug,
    title: resolveAccountTitle(account, accounts),
    homeDir: account.homeDir,
    sessionFiles: account.usage?.sessionFiles || 0,
    latestActivityAt: account.usage?.latestActivityAt || null,
    connected: Boolean(account.health?.connected),
    statusLabel: account.health?.label || "Unknown",
    statusTone: account.health?.tone || "muted",
    detail: account.health?.detail || "",
    workspace: account.auth?.workspaceTitle || account.meta?.teamLabel || "",
    plan: account.remoteUsage?.planType || account.auth?.planType || "—",
    primaryLabel: formatQuotaWindow(account.remoteUsage?.primaryWindow),
    primaryRemainingPercent:
      account.remoteUsage?.primaryWindow?.remainingPercent ?? null,
    primaryResetAt: account.remoteUsage?.primaryWindow?.resetAt || null,
    secondaryLabel: formatQuotaWindow(account.remoteUsage?.secondaryWindow),
    secondaryRemainingPercent:
      account.remoteUsage?.secondaryWindow?.remainingPercent ?? null,
    secondaryResetAt: account.remoteUsage?.secondaryWindow?.resetAt || null,
    subscriptionActiveUntil: account.auth?.subscriptionActiveUntil || null,
    quotaFetchedAt:
      account.remoteUsage?.fetchedAt || account.auth?.lastRefresh || null,
  };
}

function sortAccounts(accounts, sortOrder = "asc") {
  return [...(accounts || [])].sort((left, right) => {
    const leftConnected = left.health?.connected ? 0 : 1;
    const rightConnected = right.health?.connected ? 0 : 1;
    if (leftConnected !== rightConnected) {
      return leftConnected - rightConnected;
    }

    const primaryCmp = compareQuotaWindow(
      left.remoteUsage?.primaryWindow?.remainingPercent,
      right.remoteUsage?.primaryWindow?.remainingPercent,
      sortOrder,
    );
    if (primaryCmp !== 0) {
      return primaryCmp;
    }

    const secondaryCmp = compareQuotaWindow(
      left.remoteUsage?.secondaryWindow?.remainingPercent,
      right.remoteUsage?.secondaryWindow?.remainingPercent,
      sortOrder,
    );
    if (secondaryCmp !== 0) {
      return secondaryCmp;
    }

    const leftExpiry = dateSortValue(left.auth?.subscriptionActiveUntil);
    const rightExpiry = dateSortValue(right.auth?.subscriptionActiveUntil);
    if (leftExpiry !== rightExpiry) {
      return leftExpiry - rightExpiry;
    }

    return resolveAccountTitle(left, accounts).localeCompare(
      resolveAccountTitle(right, accounts),
    );
  });
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function resolveAccountTitle(account, accounts) {
  const manualName =
    typeof account.meta?.name === "string" ? account.meta.name.trim() : "";
  if (manualName && manualName !== account.slug) {
    return manualName;
  }

  const detectedName = account.auth?.workspaceTitle || null;
  if (!detectedName) {
    return account.slug;
  }

  const duplicates = (accounts || []).filter((candidate) => {
    const candidateManual =
      typeof candidate.meta?.name === "string" ? candidate.meta.name.trim() : "";
    return !candidateManual || candidateManual === candidate.slug
      ? candidate.auth?.workspaceTitle === detectedName
      : false;
  });
  if (duplicates.length <= 1) {
    return detectedName;
  }

  const accountId = account.remoteUsage?.accountId || account.auth?.accountId || "";
  const compact = accountId.replace(/[^a-z0-9]/gi, "");
  return compact ? `${detectedName} · ${compact.slice(-4).toUpperCase()}` : detectedName;
}

function quotaSortValue(value) {
  return typeof value === "number" ? value : Number.POSITIVE_INFINITY;
}

function compareQuotaWindow(leftValue, rightValue, sortOrder) {
  const leftHas = typeof leftValue === "number";
  const rightHas = typeof rightValue === "number";

  if (leftHas !== rightHas) {
    return leftHas ? -1 : 1;
  }

  if (!leftHas && !rightHas) {
    return 0;
  }

  if (leftValue === rightValue) {
    return 0;
  }

  return sortOrder === "desc"
    ? rightValue - leftValue
    : leftValue - rightValue;
}

function dateSortValue(value) {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }
  const parsed = new Date(value).valueOf();
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function normalizeViewMode(value) {
  return value === "minimal" || value === "detailed" ? value : "standard";
}

function formatQuotaWindow(window) {
  if (!window || typeof window.remainingPercent !== "number") {
    return "—";
  }
  const rounded = Math.round(window.remainingPercent * 10) / 10;
  const display = Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
  return `${display}% left`;
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

function createNonce() {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let output = "";
  for (let index = 0; index < 32; index += 1) {
    output += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return output;
}

module.exports = {
  activate,
  deactivate,
};
