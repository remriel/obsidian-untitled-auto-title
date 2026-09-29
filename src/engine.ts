import { isExcluded, isUntitled, meaningfulLength, sanitizeTitle, uniquePath, type TitleSettings } from "./core";

export interface NoteFile {
  path: string;
  basename: string;
  extension: string;
}

export interface EngineDependencies<T extends NoteFile> {
  settings: () => TitleSettings;
  read: (file: T) => Promise<string>;
  exists: (path: string) => boolean | Promise<boolean>;
  contains: (file: T) => boolean;
  canTitle: (content: string) => boolean;
  generate: (content: string, settings: TitleSettings) => Promise<string>;
  rename: (file: T, path: string, stillCurrent?: () => boolean) => Promise<void>;
  onRename?: (title: string) => void;
  onError?: (message: string) => void;
  onStatus?: () => void;
}

export class TitleEngine<T extends NoteFile> {
  private readonly dependencies: EngineDependencies<T>;
  private readonly timers = new Map<T, ReturnType<typeof window.setTimeout>>();
  private readonly revisions = new WeakMap<T, number>();
  private readonly suspended = new WeakSet<T>();
  private readonly queued = new Set<T>();
  private readonly history: { file: T; oldPath: string; newPath: string }[] = [];
  private serial: Promise<unknown> = Promise.resolve();
  private epoch = 0;
  private disposed = false;
  private pauseUntil = 0;
  busy = false;
  renamedCount = 0;
  lastError = "";

  constructor(dependencies: EngineDependencies<T>) {
    this.dependencies = dependencies;
  }

  eligible(file: T): boolean {
    const settings = this.dependencies.settings();
    return file.extension.toLowerCase() === "md"
      && this.dependencies.contains(file)
      && isUntitled(file.basename, settings.untitledPrefixes)
      && !isExcluded(file.path, settings.excludedFolders);
  }

  schedule(file: T, edited = false): void {
    this.revisions.set(file, (this.revisions.get(file) ?? 0) + 1);
    if (edited) this.suspended.delete(file);
    this.cancelTimer(file);
    const settings = this.dependencies.settings();
    if (this.disposed || !settings.enabled || !this.eligible(file) || this.suspended.has(file)) return;
    const delay = Math.max(settings.delaySeconds * 1000, this.pauseUntil - Date.now());
    this.timers.set(file, window.setTimeout(() => {
      this.timers.delete(file);
      void this.enqueue(file, false);
    }, delay));
  }

  cancel(file: T): void {
    this.revisions.set(file, (this.revisions.get(file) ?? 0) + 1);
    this.cancelTimer(file);
  }

  private cancelTimer(file: T): void {
    const timer = this.timers.get(file);
    if (timer !== undefined) window.clearTimeout(timer);
    this.timers.delete(file);
  }

  invalidate(): void {
    this.epoch++;
    for (const timer of this.timers.values()) window.clearTimeout(timer);
    this.timers.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.invalidate();
  }

  enqueue(file: T, manual = true): Promise<boolean> {
    this.cancelTimer(file);
    if (this.disposed || this.queued.has(file)) return Promise.resolve(false);
    this.queued.add(file);
    const epoch = this.epoch;
    const job = this.serial.then(async () => {
      this.queued.delete(file);
      return this.process(file, manual, epoch);
    });
    this.serial = job.catch(() => undefined);
    return job;
  }

  private async process(file: T, manual: boolean, epoch: number): Promise<boolean> {
    const settings = { ...this.dependencies.settings() };
    if (this.disposed || epoch !== this.epoch || !this.eligible(file)
      || (!manual && (!settings.enabled || this.suspended.has(file) || Date.now() < this.pauseUntil))) return false;
    const oldPath = file.path;
    const revision = this.revisions.get(file) ?? 0;
    try {
      const content = await this.dependencies.read(file);
      if (!this.dependencies.canTitle(content) || meaningfulLength(content) < settings.minimumCharacters) return false;
      if (this.disposed || epoch !== this.epoch || file.path !== oldPath || !this.eligible(file)) return false;
      this.busy = true;
      this.dependencies.onStatus?.();
      const rawTitle = await this.dependencies.generate(content, settings);
      // Discard stale AI results. The next idle event will generate a fresh title.
      if (this.disposed || epoch !== this.epoch || file.path !== oldPath
        || (this.revisions.get(file) ?? 0) !== revision || !this.eligible(file)
        || await this.dependencies.read(file) !== content) return false;
      const title = sanitizeTitle(rawTitle, settings.maximumTitleLength);
      if (!title || isUntitled(title, settings.untitledPrefixes)) throw new Error("No useful title was generated. The note was left untitled.");
      const newPath = await uniquePath(oldPath, title, path => this.dependencies.exists(path));
      // A read can yield to other editor events, so guard once more immediately before the rename.
      if (this.disposed || epoch !== this.epoch || file.path !== oldPath || !this.eligible(file)
        || (this.revisions.get(file) ?? 0) !== revision) return false;
      await this.dependencies.rename(file, newPath, () => !this.disposed && epoch === this.epoch
        && file.path === oldPath && this.eligible(file) && (this.revisions.get(file) ?? 0) === revision);
      this.history.push({ file, oldPath, newPath });
      if (this.history.length > 25) this.history.shift();
      this.renamedCount++;
      this.lastError = "";
      this.pauseUntil = 0;
      this.dependencies.onRename?.(newPath.slice(newPath.lastIndexOf("/") + 1, -3));
      return true;
    } catch (error: unknown) {
      if (this.disposed || epoch !== this.epoch) return false;
      this.lastError = error instanceof Error ? error.message : "Title generation failed. The note was left untitled.";
      this.pauseUntil = Date.now() + 60000;
      this.dependencies.onError?.(this.lastError);
      return false;
    } finally {
      this.busy = false;
      this.dependencies.onStatus?.();
    }
  }

  undo(): Promise<boolean> {
    const epoch = this.epoch;
    const job = this.serial.then(() => this.undoCurrent(epoch));
    this.serial = job.catch(() => undefined);
    return job;
  }

  private async undoCurrent(epoch: number): Promise<boolean> {
    const entry = this.history.at(-1);
    if (this.disposed || epoch !== this.epoch || !entry || !this.dependencies.contains(entry.file) || entry.file.path !== entry.newPath) return false;
    if (await this.dependencies.exists(entry.oldPath)) throw new Error("The original Untitled filename is now in use. Nothing was overwritten.");
    const stillCurrent = (): boolean => !this.disposed && epoch === this.epoch
      && this.dependencies.contains(entry.file) && entry.file.path === entry.newPath;
    if (!stillCurrent()) return false;
    this.cancel(entry.file);
    this.suspended.add(entry.file);
    await this.dependencies.rename(entry.file, entry.oldPath, stillCurrent);
    this.history.pop();
    this.dependencies.onStatus?.();
    return true;
  }
}
