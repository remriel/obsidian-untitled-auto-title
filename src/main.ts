import { MarkdownView, Notice, Plugin, PluginSettingTab, TFile, normalizePath, parseYaml, requestUrl, type App, type SettingDefinitionControl, type SettingDefinitionItem } from "obsidian";
import { DEFAULT_SETTINGS, frontmatterText, isRecord, loadSettings, localTitle, type TitleSettings } from "./core";
import { TitleEngine } from "./engine";
import { readApiKey } from "./environment";
import { groqTitle } from "./groq";

export default class UntitledAutoTitle extends Plugin {
  settings: TitleSettings = loadSettings(DEFAULT_SETTINGS);
  engine!: TitleEngine<TFile>;
  private statusElement!: HTMLElement;
  private ready = false;
  private unloaded = false;
  private lastErrorNotice = 0;

  async onload(): Promise<void> {
    this.settings = loadSettings(await this.loadData());
    this.statusElement = this.addStatusBarItem();
    this.statusElement.addClass("auto-title-status");
    this.statusElement.setAttribute("aria-label", "Untitled Auto Title status");
    this.engine = new TitleEngine<TFile>({
      settings: () => this.settings,
      read: file => this.readCurrentContent(file),
      contains: file => this.app.vault.getAbstractFileByPath(file.path) === file,
      exists: path => this.app.vault.adapter.exists(path),
      canTitle: content => this.canTitle(content),
      generate: (content, settings) => this.generateTitle(content, settings),
      rename: async (file, path, stillCurrent) => {
        if (await this.app.vault.adapter.exists(path)) throw new Error("The generated filename is now in use. Nothing was overwritten.");
        if (stillCurrent && !stillCurrent()) throw new Error("The note changed before its title could be applied. It was left unchanged.");
        await this.app.fileManager.renameFile(file, normalizePath(path));
      },
      onRename: title => {
        if (this.settings.showNotices) new Notice(`Untitled Auto Title: ${title}`);
      },
      onError: message => {
        if (Date.now() - this.lastErrorNotice > 60000) {
          this.lastErrorNotice = Date.now();
          new Notice(`Untitled Auto Title: ${message}`, 10000);
        }
      },
      onStatus: () => this.updateStatus(),
    });
    this.addSettingTab(new AutoTitleSettings(this.app, this));

    this.registerEvent(this.app.vault.on("create", file => {
      if (this.ready && file instanceof TFile) this.engine.schedule(file);
    }));
    this.registerEvent(this.app.vault.on("modify", file => {
      if (this.ready && file instanceof TFile) this.engine.schedule(file);
    }));
    this.registerEvent(this.app.vault.on("rename", file => {
      if (file instanceof TFile) {
        this.engine.cancel(file);
        if (this.ready) this.engine.schedule(file);
      }
    }));
    this.registerEvent(this.app.vault.on("delete", file => {
      if (file instanceof TFile) this.engine.cancel(file);
    }));
    this.registerEvent(this.app.workspace.on("editor-change", (_editor, view) => {
      if (this.ready && view.file) this.engine.schedule(view.file, true);
    }));
    this.registerEvent(this.app.workspace.on("file-open", file => {
      if (this.ready && file) this.engine.schedule(file);
    }));
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (!(file instanceof TFile) || !this.engine.eligible(file)) return;
      menu.addItem(item => item.setTitle("Generate note title").setIcon("text-cursor-input").onClick(() => { void this.titleCurrent(file); }));
    }));

    this.addCommand({
      id: "title-current-note", name: "Generate title for current untitled note",
      checkCallback: checking => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !this.engine.eligible(file)) return false;
        if (!checking) void this.titleCurrent(file);
        return true;
      },
    });
    this.addCommand({ id: "undo-last-title", name: "Undo last generated title", callback: () => { void this.undoTitle(); } });
    this.addCommand({ id: "test-groq-connection", name: "Test Groq connection with a sample note", callback: () => { void this.testConnection(); } });

    this.app.workspace.onLayoutReady(() => {
      if (this.unloaded) return;
      this.ready = true;
      if (this.settings.enabled && this.settings.processOnStartup) {
        const file = this.app.workspace.getActiveFile();
        if (file && this.engine.eligible(file)) this.engine.schedule(file);
      }
      this.updateStatus();
    });
    this.updateStatus();
  }

  onunload(): void {
    this.unloaded = true;
    this.engine?.dispose();
  }

  async onExternalSettingsChange(): Promise<void> {
    this.settings = loadSettings(await this.loadData());
    this.engine.invalidate();
    this.updateStatus();
  }

  async saveSettings(): Promise<void> {
    // Whitelist settings before saving: credentials can never be persisted here.
    this.settings = loadSettings(this.settings);
    this.engine.invalidate();
    await this.saveData(this.settings);
    this.updateStatus();
  }

  async generateTitle(content: string, settings: TitleSettings = this.settings): Promise<string> {
    if (settings.provider === "local") return localTitle(content, settings.maximumTitleLength);
    return groqTitle(content, settings, await readApiKey(settings.environmentVariable), async options => {
      const response = await requestUrl({ ...options, throw: false });
      let json: unknown;
      try { json = response.json; } catch { json = null; }
      return { status: response.status, json, headers: response.headers };
    });
  }

  private canTitle(content: string): boolean {
    const properties = frontmatterText(content);
    if (properties === null) return true;
    try {
      const parsed: unknown = parseYaml(properties);
      if (parsed === null || parsed === undefined) return true;
      return isRecord(parsed) && parsed["auto-title"] !== false && parsed.autotitle !== false;
    } catch {
      return false; // Wait until partially typed YAML becomes valid.
    }
  }

  private async readCurrentContent(file: TFile): Promise<string> {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view instanceof MarkdownView && leaf.view.file === file && leaf.view.editor) return leaf.view.editor.getValue();
    }
    return this.app.vault.read(file);
  }

  private updateStatus(): void {
    if (!this.statusElement || this.unloaded) return;
    const state = !this.settings.enabled ? "paused" : this.engine?.busy ? "generating" : this.engine?.lastError ? "check connection" : "ready";
    this.statusElement.setText(`Auto title: ${state}`);
    this.statusElement.setAttribute("title", this.engine?.lastError || `${this.engine?.renamedCount ?? 0} note(s) titled this session`);
    this.statusElement.toggleClass("auto-title-error", Boolean(this.engine?.lastError));
  }

  private async titleCurrent(file: TFile): Promise<void> {
    const changed = await this.engine.enqueue(file);
    if (!changed && !this.engine.lastError) new Notice("This note needs more content, is opted out, or changed while its title was being generated.");
  }

  private async undoTitle(): Promise<void> {
    try {
      const undone = await this.engine.undo();
      new Notice(undone ? "Restored the original Untitled filename. Automatic titling resumes when you edit this note." : "There is no generated title to undo in this session.");
    } catch (error: unknown) {
      new Notice(error instanceof Error ? error.message : "Could not undo this title.");
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const title = await this.generateTitle("We are planning a community garden with raised beds, composting, and a shared watering schedule.", { ...this.settings, provider: "groq" });
      this.engine.lastError = "";
      this.updateStatus();
      new Notice(`Groq is connected. Sample title: ${title}`, 8000);
      return true;
    } catch (error: unknown) {
      this.engine.lastError = error instanceof Error ? error.message : "Could not reach Groq.";
      this.updateStatus();
      new Notice(this.engine.lastError, 10000);
      return false;
    }
  }
}

class AutoTitleSettings extends PluginSettingTab {
  private readonly plugin: UntitledAutoTitle;

  constructor(app: App, plugin: UntitledAutoTitle) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getSettingDefinitions(): SettingDefinitionItem<keyof TitleSettings>[] {
    this.containerEl?.addClass("auto-title-settings");
    const groqVisible = (): boolean => this.plugin.settings.provider === "groq";
    return [
      {
        name: "Make untitled notes findable.",
        desc: "Write your note, then pause to get a title. Groq receives the eligible note's text; local mode works offline without an API key. Your environment key is never saved in the vault.",
        searchable: false,
        render: setting => {
          setting.setHeading();
          setting.settingEl.addClass("auto-title-banner");
        },
      },
      {
        name: "Automatic titles",
        desc: "Rename eligible Untitled notes after you stop typing.",
        control: { type: "toggle", key: "enabled", defaultValue: DEFAULT_SETTINGS.enabled },
      },
      {
        name: "Title generator",
        aliases: ["offline", "local", "AI", "Groq", "API key"],
        control: {
          type: "dropdown", key: "provider", defaultValue: DEFAULT_SETTINGS.provider,
          options: { groq: "Groq AI", local: "Local heading or phrase (no key)" },
        },
      },
      {
        type: "group", heading: "Groq connection", visible: groqVisible,
        items: [
          {
            name: "Environment variable",
            desc: "Name of the variable containing your Groq API key. The key itself is never shown or saved.",
            aliases: ["API key", "GROQ_API_KEY"],
            control: {
              type: "text", key: "environmentVariable", defaultValue: DEFAULT_SETTINGS.environmentVariable,
              placeholder: "GROQ_API_KEY",
              validate: value => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value.trim()) ? undefined : "Enter a valid environment variable name.",
            },
          },
          {
            name: "Environment key",
            searchable: false,
            render: setting => {
              setting.settingEl.addClass("auto-title-key-status");
              setting.setDesc("Checking environment key...");
              void readApiKey(this.plugin.settings.environmentVariable).then(key => {
                if (setting.settingEl.isConnected) setting.setDesc(key
                  ? "Environment key found. Ready to connect."
                  : "Environment key not found. Restart Obsidian from a terminal where the variable is available, or choose local mode.");
              });
            },
          },
          {
            name: "Groq model",
            desc: "Default: openai/gpt-oss-20b. Enter another supported Groq text model if needed.",
            control: {
              type: "text", key: "model", defaultValue: DEFAULT_SETTINGS.model,
              validate: value => /^[A-Za-z0-9_./-]{1,120}$/.test(value.trim()) ? undefined : "Enter a valid Groq model ID.",
            },
          },
          {
            name: "Check connection",
            desc: "Generate a title from a built-in sample. No personal note is sent.",
            render: setting => {
              setting.addButton(button => button.setButtonText("Test Groq").setCta().onClick(async () => {
                button.setDisabled(true).setButtonText("Testing...");
                await this.plugin.testConnection();
                button.setDisabled(false).setButtonText("Test Groq");
              }));
            },
          },
        ],
      },
      {
        type: "group", heading: "When to title",
        items: [
          this.numberDefinition("Pause before generation", "Seconds of inactivity before generating a title.", "delaySeconds", 2, 120),
          this.numberDefinition("Minimum note content", "Minimum number of letters and digits before a note is eligible.", "minimumCharacters", 5, 2000),
          {
            name: "Title the active untitled note on startup",
            desc: "Check the current note when Obsidian opens. Other notes are checked when you open or edit them.",
            control: { type: "toggle", key: "processOnStartup", defaultValue: DEFAULT_SETTINGS.processOnStartup },
          },
          {
            name: "Untitled names",
            desc: "One exact placeholder per line. Numbered copies such as Untitled 1 are included.",
            control: { type: "textarea", key: "untitledPrefixes", defaultValue: DEFAULT_SETTINGS.untitledPrefixes.join("\n"), rows: 3 },
          },
          {
            name: "Excluded folders",
            desc: "Vault-relative folder paths, one per line. Hidden folders and the trash are always excluded.",
            control: { type: "textarea", key: "excludedFolders", defaultValue: DEFAULT_SETTINGS.excludedFolders.join("\n"), rows: 3 },
          },
        ],
      },
      {
        type: "group", heading: "Title details",
        items: [
          this.numberDefinition("Maximum title length", "Maximum characters in the generated filename.", "maximumTitleLength", 20, 120),
          {
            ...this.numberDefinition("Maximum note text sent", "Long notes use an excerpt from the beginning and end. Properties and hidden comments are excluded.", "maximumContentCharacters", 1000, 30000),
            visible: groqVisible,
          },
          {
            name: "Show rename notices",
            control: { type: "toggle", key: "showNotices", defaultValue: DEFAULT_SETTINGS.showNotices },
          },
        ],
      },
      {
        name: "Keep control",
        desc: "Set the note property auto-title to false to skip it. Use the command palette to title the current untitled note or undo the last generated title. Generated titles stay fixed when you continue editing.",
        render: setting => { setting.settingEl.addClass("auto-title-help"); },
      },
    ];
  }

  getControlValue(key: string): unknown {
    if (key === "untitledPrefixes" || key === "excludedFolders") return this.plugin.settings[key].join("\n");
    if (!Object.hasOwn(DEFAULT_SETTINGS, key)) return undefined;
    return this.plugin.settings[key as keyof TitleSettings];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (!Object.hasOwn(DEFAULT_SETTINGS, key)) return;
    let candidate: unknown = value;
    if (key === "untitledPrefixes" || key === "excludedFolders") {
      if (typeof value !== "string") return;
      candidate = value.split("\n").map(line => line.trim()).filter(Boolean);
    } else if ((key === "environmentVariable" || key === "model") && typeof value === "string") {
      candidate = value.trim();
    }
    this.plugin.settings = loadSettings({ ...this.plugin.settings, [key]: candidate });
    await this.plugin.saveSettings();
    if (key === "provider") this.refreshDomState();
  }

  private numberDefinition(name: string, desc: string, key: "delaySeconds" | "minimumCharacters" | "maximumTitleLength" | "maximumContentCharacters", min: number, max: number): SettingDefinitionControl<keyof TitleSettings> {
    return {
      name, desc,
      control: {
        type: "number", key, defaultValue: DEFAULT_SETTINGS[key], min, max, step: 1,
        validate: value => Number.isInteger(value) && value >= min && value <= max
          ? undefined : `Enter a whole number between ${min} and ${max}.`,
      },
    };
  }

}
