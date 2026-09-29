export interface TitleSettings {
  enabled: boolean;
  provider: "groq" | "local";
  environmentVariable: string;
  model: string;
  delaySeconds: number;
  minimumCharacters: number;
  maximumTitleLength: number;
  maximumContentCharacters: number;
  processOnStartup: boolean;
  showNotices: boolean;
  untitledPrefixes: string[];
  excludedFolders: string[];
}

export const DEFAULT_SETTINGS: TitleSettings = {
  enabled: true,
  provider: "groq",
  environmentVariable: "GROQ_API_KEY",
  model: "openai/gpt-oss-20b",
  delaySeconds: 10,
  minimumCharacters: 30,
  maximumTitleLength: 80,
  maximumContentCharacters: 12000,
  processOnStartup: true,
  showNotices: true,
  untitledPrefixes: ["Untitled"],
  excludedFolders: ["Templates", "docs"],
};

const clamp = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function loadSettings(value: unknown): TitleSettings {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const strings = (entry: unknown, fallback: string[]): string[] => Array.isArray(entry)
    ? entry.filter((item): item is string => typeof item === "string").map(item => item.trim()).filter(Boolean)
    : [...fallback];
  return {
    enabled: typeof data.enabled === "boolean" ? data.enabled : DEFAULT_SETTINGS.enabled,
    provider: data.provider === "local" ? "local" : "groq",
    environmentVariable: typeof data.environmentVariable === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(data.environmentVariable)
      ? data.environmentVariable : DEFAULT_SETTINGS.environmentVariable,
    model: typeof data.model === "string" && /^[A-Za-z0-9_./-]{1,120}$/.test(data.model)
      ? data.model : DEFAULT_SETTINGS.model,
    delaySeconds: clamp(data.delaySeconds, 10, 2, 120),
    minimumCharacters: clamp(data.minimumCharacters, 30, 5, 2000),
    maximumTitleLength: clamp(data.maximumTitleLength, 80, 20, 120),
    maximumContentCharacters: clamp(data.maximumContentCharacters, 12000, 1000, 30000),
    processOnStartup: typeof data.processOnStartup === "boolean" ? data.processOnStartup : true,
    showNotices: typeof data.showNotices === "boolean" ? data.showNotices : true,
    untitledPrefixes: strings(data.untitledPrefixes, DEFAULT_SETTINGS.untitledPrefixes),
    excludedFolders: strings(data.excludedFolders, DEFAULT_SETTINGS.excludedFolders),
  };
}

export function isUntitled(basename: string, prefixes: readonly string[]): boolean {
  return prefixes.some(prefix => {
    const escaped = prefix.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return escaped.length > 0 && new RegExp(`^${escaped}(?:[ -]?\\d+)?$`, "i").test(basename.trim());
  });
}

export function isExcluded(path: string, folders: readonly string[]): boolean {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  if (normalized.split("/").some(segment => segment.startsWith("."))) return true;
  return folders.some(folder => {
    const normalizedFolder = folder.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "").toLowerCase();
    return normalizedFolder && (normalized === normalizedFolder || normalized.startsWith(`${normalizedFolder}/`));
  });
}

export function frontmatterText(content: string): string | null {
  const normalized = content.replace(/^\uFEFF/, "");
  if (!/^---\r?\n/.test(normalized)) return null;
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/);
  return match?.[1] ?? "";
}

export function noteText(content: string): string {
  let body = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (/^---\n/.test(body)) {
    const match = body.match(/^---\n[\s\S]*?\n(?:---|\.\.\.)(?:\n|$)/);
    if (!match) return ""; // Do not send incomplete properties to a model.
    body = body.slice(match[0].length);
  }
  return body
    .replace(/%%[\s\S]*?%%/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[\[[^\]]*\]\]/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, "")
    .trim();
}

export function excerpt(content: string, limit: number): string {
  const text = noteText(content);
  if (text.length <= limit) return text;
  const start = Math.floor(limit * 0.7);
  const marker = "\n\n[Middle of long note omitted]\n\n";
  return text.slice(0, start) + marker + text.slice(-(limit - start - marker.length));
}

export function meaningfulLength(content: string): number {
  return (noteText(content).match(/[\p{L}\p{N}]/gu) ?? []).length;
}

export function sanitizeTitle(raw: string, maxLength: number): string {
  const printable = Array.from(raw, character => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127 ? " " : character;
  }).join("");
  let title = printable.trim()
    .replace(/^title\s*:\s*/i, "")
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "")
    .replace(/^#+\s*/, "")
    .replace(/\.md$/i, "")
    .replace(/[<>:"/\\|?*#^]/g, " ")
    .replaceAll("[", " ")
    .replaceAll("]", " ")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "");
  const points = Array.from(title);
  if (points.length > maxLength) {
    title = points.slice(0, maxLength).join("");
    const lastSpace = title.lastIndexOf(" ");
    if (lastSpace > maxLength * 0.65) title = title.slice(0, lastSpace);
    title = title.replace(/[.\s]+$/g, "");
  }
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(title)) title = `Note ${title}`;
  return title;
}

export function parseGeneratedTitle(response: unknown, maxLength: number): string {
  if (typeof response !== "string") throw new Error("Groq returned no title.");
  const cleaned = response.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  let parsed: unknown;
  try { parsed = JSON.parse(cleaned); } catch { throw new Error("Groq returned an invalid title. The note was left untitled."); }
  if (!parsed || typeof parsed !== "object" || !("title" in parsed) || typeof parsed.title !== "string" || /[\r\n]/.test(parsed.title)) {
    throw new Error("Groq returned an invalid title. The note was left untitled.");
  }
  const title = sanitizeTitle(parsed.title, maxLength);
  if (!title || isUntitled(title, ["Untitled"]) || /^(?:none|null|n\/a|no title|untitled note)$/i.test(title)) {
    throw new Error("Groq did not return a useful title. The note was left untitled.");
  }
  return title;
}

export function localTitle(content: string, maxLength: number): string {
  const text = noteText(content).replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, "");
  const heading = text.match(/^#{1,6}\s+(.+?)\s*#*$/m)?.[1];
  const firstLine = heading ?? text.split("\n").map(line => line.trim()).find(line => /[\p{L}\p{N}]/u.test(line)) ?? "";
  const phrase = firstLine
    .replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+|>\s*)/, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .split(/(?<=[.!?])\s/)[0]
    .split(/\s+/).slice(0, 10).join(" ");
  return sanitizeTitle(phrase, maxLength);
}

export function uniquePath(path: string, title: string, exists: (candidate: string) => boolean): string {
  const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
  for (let count = 1; count <= 10000; count++) {
    const candidate = `${folder}${title}${count === 1 ? "" : ` ${count}`}.md`;
    if (!exists(candidate)) return candidate;
  }
  throw new Error("There are too many notes with this title. The note was left untitled.");
}
