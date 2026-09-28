import { MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath, parseYaml, requestUrl, type App } from "obsidian";
import { DEFAULT_SETTINGS, frontmatterText, loadSettings, localTitle, type TitleSettings } from "./core";
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
      exists: path => this.app.vault.getAllLoadedFiles().some(file => file.path.toLowerCase() === path.toLowerCase()),
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
    this.addCommand({ id: "title-all-untitled", name: "Generate titles for all untitled notes", callback: () => { void this.titleAll(); } });
    this.addCommand({ id: "undo-last-title", name: "Undo last generated title", callback: () => { void this.undoTitle(); } });
    this.addCommand({ id: "test-groq-connection", name: "Test Groq connection with a sample note", callback: () => { void this.testConnection(); } });

    this.app.workspace.onLayoutReady(() => {
      if (this.unloaded) return;
      this.ready = true;
      if (this.settings.enabled && this.settings.processOnStartup) {
        for (const file of this.app.vault.getMarkdownFiles()) {
          if (this.engine.eligible(file)) this.engine.schedule(file);
        }
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
      const parsed = parseYaml(properties);
      return parsed?.["auto-title"] !== false && parsed?.autotitle !== false;
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

  async titleAll(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles().filter(file => this.engine.eligible(file));
    if (!files.length) { new Notice("There are no eligible untitled notes."); return; }
    let count = 0;
    for (const file of files) {
      if (this.unloaded) return;
      if (await this.engine.enqueue(file)) count++;
      else if (this.engine.lastError) break;
    }
    new Notice(`Generated titles for ${count} of ${files.length} untitled notes.`);
  }

  private async undoTitle(): Promise<void> {
    try {
      const undone = await this.engine.undo();
      new Notice(undone ? "Restored the original Untitled filename. Automatic titling resumes when you edit this note." : "There is no generated title to undo in this session.");
    } catch (error) {
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
    } catch (error) {
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

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("auto-title-settings");
    const banner = containerEl.createDiv({ cls: "auto-title-banner" });
    banner.createEl("h2", { text: "MAKE UNTITLED NOTES FINDABLE." });
    banner.createEl("p", { text: "Write your note. Pause for a moment. Get a title that describes it." });
    banner.createEl("p", { cls: "auto-title-detail", text: "Groq receives text from the note being titled, up to the configured limit. Your API key is read from your system environment and is never saved in the vault." });

    new Setting(containerEl).setName("Automatic titles").setDesc("Rename eligible Untitled notes after you stop typing.")
      .addToggle(toggle => toggle.setValue(this.plugin.settings.enabled).onChange(async value => {
        this.plugin.settings.enabled = value;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl).setName("Title generator")
      .addDropdown(dropdown => dropdown.addOption("groq", "Groq AI").addOption("local", "Local heading or phrase")
        .setValue(this.plugin.settings.provider).onChange(async value => {
          this.plugin.settings.provider = value === "local" ? "local" : "groq";
          await this.plugin.saveSettings();
          this.display();
        }));

    if (this.plugin.settings.provider === "groq") {
      containerEl.createEl("h3", { text: "GROQ CONNECTION" });
      new Setting(containerEl).setName("Environment variable").setDesc("Name of the variable containing your Groq API key. The key itself is never shown or saved.")
        .addText(text => text.setValue(this.plugin.settings.environmentVariable).setPlaceholder("GROQ_API_KEY").onChange(async value => {
          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.trim())) {
            this.plugin.settings.environmentVariable = value.trim();
            await this.plugin.saveSettings();
          }
        }));
      const keyStatus = containerEl.createDiv({ cls: "auto-title-key-status", text: "Checking environment key..." });
      void readApiKey(this.plugin.settings.environmentVariable).then(key => {
        if (keyStatus.isConnected) keyStatus.setText(key ? "Environment key found. Ready to connect." : "Environment key not found. Set it in your system environment and restart Obsidian.");
      });
      new Setting(containerEl).setName("Groq model").setDesc("Default: openai/gpt-oss-20b. Enter another supported Groq text model if needed.")
        .addText(text => text.setValue(this.plugin.settings.model).onChange(async value => {
          if (/^[A-Za-z0-9_./-]{1,120}$/.test(value.trim())) {
            this.plugin.settings.model = value.trim();
            await this.plugin.saveSettings();
          }
        }));
      new Setting(containerEl).setName("Check connection").setDesc("Generate a title from a built-in sample. No personal note is sent.")
        .addButton(button => button.setButtonText("TEST GROQ").setCta().onClick(async () => {
          button.setDisabled(true).setButtonText("TESTING...");
          await this.plugin.testConnection();
          button.setDisabled(false).setButtonText("TEST GROQ");
        }));
    }

    containerEl.createEl("h3", { text: "WHEN TO TITLE" });
    this.numberSetting("Pause before generation", "Seconds of inactivity before generating a title.", "delaySeconds", 2, 120);
    this.numberSetting("Minimum note content", "Minimum number of letters and digits before a note is eligible.", "minimumCharacters", 5, 2000);
    new Setting(containerEl).setName("Include existing untitled notes on startup").setDesc("Check eligible notes when Obsidian opens. Existing chosen titles are preserved.")
      .addToggle(toggle => toggle.setValue(this.plugin.settings.processOnStartup).onChange(async value => {
        this.plugin.settings.processOnStartup = value;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl).setName("Untitled names").setDesc("One exact placeholder per line. Numbered copies such as Untitled 1 are included.")
      .addTextArea(text => text.setValue(this.plugin.settings.untitledPrefixes.join("\n")).onChange(async value => {
        this.plugin.settings.untitledPrefixes = value.split("\n").map(line => line.trim()).filter(Boolean);
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl).setName("Excluded folders").setDesc("Vault-relative folder paths, one per line. Hidden folders and the trash are always excluded.")
      .addTextArea(text => text.setValue(this.plugin.settings.excludedFolders.join("\n")).onChange(async value => {
        this.plugin.settings.excludedFolders = value.split("\n").map(line => line.trim()).filter(Boolean);
        await this.plugin.saveSettings();
      }));

    containerEl.createEl("h3", { text: "TITLE DETAILS" });
    this.numberSetting("Maximum title length", "Maximum characters in the generated filename.", "maximumTitleLength", 20, 120);
    if (this.plugin.settings.provider === "groq") this.numberSetting("Maximum note text sent", "Long notes use an excerpt from the beginning and end. Properties and hidden comments are excluded.", "maximumContentCharacters", 1000, 30000);
    new Setting(containerEl).setName("Show rename notices")
      .addToggle(toggle => toggle.setValue(this.plugin.settings.showNotices).onChange(async value => {
        this.plugin.settings.showNotices = value;
        await this.plugin.saveSettings();
      }));
    const help = containerEl.createDiv({ cls: "auto-title-help" });
    help.createEl("strong", { text: "KEEP CONTROL" });
    help.createEl("p", { text: "Set the note property auto-title to false to skip it. Use the command palette to title all untitled notes, title the current note, or undo the last generated title. Generated titles stay fixed when you continue editing." });
  }

  private numberSetting(name: string, description: string, key: "delaySeconds" | "minimumCharacters" | "maximumTitleLength" | "maximumContentCharacters", min: number, max: number): void {
    new Setting(this.containerEl).setName(name).setDesc(description)
      .addText(text => {
        text.inputEl.type = "number";
        text.inputEl.min = String(min);
        text.inputEl.max = String(max);
        text.setValue(String(this.plugin.settings[key])).onChange(async value => {
          const number = Number(value);
          if (value.trim() && Number.isFinite(number) && number >= min && number <= max) {
            this.plugin.settings[key] = Math.round(number);
            await this.plugin.saveSettings();
          }
        });
      });
  }
}
