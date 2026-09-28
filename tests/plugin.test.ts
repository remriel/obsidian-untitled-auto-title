import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { DEFAULT_SETTINGS, excerpt, isExcluded, isUntitled, loadSettings, localTitle, meaningfulLength, noteText, parseGeneratedTitle, sanitizeTitle, uniquePath, type TitleSettings } from "../src/core";
import { TitleEngine, type NoteFile } from "../src/engine";
import { GROQ_ENDPOINT, groqTitle, titleRequest, type Transport } from "../src/groq";

const sample = "We are planning a community garden with raised beds, composting, and a shared watering schedule.";

function fixture(generator: (content: string, settings: TitleSettings) => Promise<string> = async () => "Community garden planning") {
  const settings = loadSettings(DEFAULT_SETTINGS);
  const notes = new Set<NoteFile>();
  const contents = new Map<NoteFile, string>();
  const paths = new Set<string>();
  const renames: string[] = [];
  const errors: string[] = [];
  const engine = new TitleEngine<NoteFile>({
    settings: () => settings,
    contains: file => notes.has(file),
    read: async file => contents.get(file) ?? "",
    exists: path => paths.has(path.toLowerCase()),
    canTitle: content => !content.includes("auto-title: false"),
    generate: generator,
    rename: async (file, path, guard) => {
      if (guard && !guard()) throw new Error("The note changed.");
      paths.delete(file.path.toLowerCase());
      file.path = path;
      file.basename = path.slice(path.lastIndexOf("/") + 1, -3);
      paths.add(path.toLowerCase());
      renames.push(path);
    },
    onError: message => errors.push(message),
  });
  const add = (path = "Inbox/Untitled.md", content = sample) => {
    const file = { path, basename: path.slice(path.lastIndexOf("/") + 1, -3), extension: "md" };
    notes.add(file);
    paths.add(path.toLowerCase());
    contents.set(file, content);
    return file;
  };
  return { engine, settings, add, notes, contents, paths, renames, errors };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(callback => { resolve = callback; });
  return { promise, resolve };
}

test("only exact placeholder names and their numbered copies are eligible", () => {
  for (const name of ["Untitled", "untitled", "Untitled 1", "Untitled-2", "Untitled3"]) assert.equal(isUntitled(name, ["Untitled"]), true);
  for (const name of ["Untitled thoughts", "Untitled 1 draft", "2026-09-28", "My chosen title", ""]) assert.equal(isUntitled(name, ["Untitled"]), false);
  assert.equal(isUntitled("Draft+ 2", ["Draft+"]), true);
  assert.equal(isUntitled("Draft 2", ["Draft+"]), false);
  assert.equal(isUntitled("Untitled", []), false);
});

test("hidden directories and explicit excluded folders cannot be titled", () => {
  for (const path of [".trash/Untitled.md", ".obsidian/Untitled.md", "Inbox/.private/Untitled.md", "Templates/Untitled.md", "Templates/sub/Untitled.md"]) assert.equal(isExcluded(path, ["Templates"]), true);
  assert.equal(isExcluded("Templates extra/Untitled.md", ["Templates"]), false);
  assert.equal(isExcluded("Inbox/Untitled.md", ["Templates"]), false);
});

test("settings whitelist drops credential fields and bounds values", () => {
  const settings = loadSettings({ apiKey: "synthetic-secret", groqApiKey: "synthetic-secret", delaySeconds: -10, maximumTitleLength: 9999, environmentVariable: "bad; variable", provider: "other" });
  assert.equal(settings.delaySeconds, 2);
  assert.equal(settings.maximumTitleLength, 120);
  assert.equal(settings.environmentVariable, "GROQ_API_KEY");
  assert.equal(settings.provider, "groq");
  assert.equal(JSON.stringify(settings).includes("synthetic-secret"), false);
});

test("model input excludes properties, comments, and image attachments", () => {
  const content = "---\r\nprivate: metadata\r\n---\r\n" + sample + "\n%%hidden text%%\n<!--private comment-->\n![[photo.png]]\n![photo](photo.png)";
  assert.equal(noteText(content), sample);
  assert.equal(noteText("---\nunfinished: properties"), "");
  assert.equal(meaningfulLength("# \n ![[photo.png]]\n%%comment%%"), 0);
  assert.ok(meaningfulLength("这是一个关于社区花园的笔记。") > 5);
});

test("long excerpts remain within the limit and retain beginning and end", () => {
  const content = "Beginning " + "middle ".repeat(300) + " last central subject";
  const shortened = excerpt(content, 1000);
  assert.ok(shortened.length <= 1000);
  assert.ok(shortened.startsWith("Beginning"));
  assert.ok(shortened.endsWith("last central subject"));
});

test("titles are safe filenames, including reserved Windows names and Unicode", () => {
  assert.equal(sanitizeTitle('"Plan: gardens / compost?"', 80), "Plan gardens compost");
  assert.equal(sanitizeTitle("CON.md", 80), "Note CON");
  assert.equal(sanitizeTitle("../NUL", 80), "Note NUL");
  assert.equal(sanitizeTitle("## **Community garden**.md", 80), "Community garden");
  const unicode = sanitizeTitle("Garden 🌱 ".repeat(30), 25);
  assert.ok(Array.from(unicode).length <= 25);
  assert.equal(unicode.includes("\uFFFD"), false);
});

test("invalid model output cannot become a filename", () => {
  assert.equal(parseGeneratedTitle('{"title":"Community garden planning"}', 80), "Community garden planning");
  for (const response of [null, "explanations only", '{"title":""}', '{"title":"Untitled"}', '{"title":12}', '{"title":"One\\nTwo"}']) {
    assert.throws(() => parseGeneratedTitle(response, 80));
  }
});

test("local mode extracts a heading or readable phrase", () => {
  assert.equal(localTitle("---\ntags: [private]\n---\n# Community garden\n" + sample, 80), "Community garden");
  assert.equal(localTitle("- [ ] Plan [[garden|the garden]] together.", 80), "Plan the garden together");
});

test("duplicate filenames get a suffix in their original folder", () => {
  const occupied = new Set(["Inbox/Community garden.md", "Inbox/Community garden 2.md"]);
  assert.equal(uniquePath("Inbox/Untitled.md", "Community garden", path => occupied.has(path)), "Inbox/Community garden 3.md");
  assert.equal(uniquePath("Untitled.md", "Community garden", () => false), "Community garden.md");
});

test("Groq uses the fixed endpoint, bounded text, and a title-only JSON response", async () => {
  const settings = loadSettings(DEFAULT_SETTINGS);
  let request: Parameters<Transport>[0] | undefined;
  const result = await groqTitle("---\nprivate: hidden\n---\n" + sample, settings, "synthetic-key", async options => {
    request = options;
    return { status: 200, json: { choices: [{ message: { content: '{"title":"Community garden planning"}' } }] } };
  });
  assert.equal(result, "Community garden planning");
  assert.equal(request?.url, GROQ_ENDPOINT);
  assert.equal(request?.headers.Authorization, "Bearer synthetic-key");
  assert.equal(request?.body.includes("private: hidden"), false);
  assert.equal(request?.body.includes("synthetic-key"), false);
  assert.equal(titleRequest(sample, settings).reasoning_effort, "low");
});

test("Groq failures do not reveal credentials or note content", async () => {
  const settings = loadSettings(DEFAULT_SETTINGS);
  await assert.rejects(groqTitle(sample, settings, "synthetic-key", async () => { throw new Error("Authorization: synthetic-key " + sample); }), error => {
    assert.equal(String(error).includes("synthetic-key"), false);
    assert.equal(String(error).includes(sample), false);
    return true;
  });
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(groqTitle(sample, settings, "synthetic-key", async () => ({ status, json: { error: { message: "synthetic-key" } } })), /Groq/);
  }
});

test("a normal rename preserves the full note body", async () => {
  const f = fixture();
  const file = f.add();
  assert.equal(await f.engine.enqueue(file), true);
  assert.equal(file.path, "Inbox/Community garden planning.md");
  assert.equal(f.contents.get(file), sample);
  f.engine.dispose();
});

test("chosen titles, empty notes, opt-outs, and templates never call the model", async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return "Garden"; });
  for (const file of [f.add("Inbox/My chosen title.md"), f.add("Inbox/Untitled 1.md", ""), f.add("Inbox/Untitled 2.md", "---\nauto-title: false\n---\n" + sample), f.add("Templates/Untitled.md"), f.add(".trash/Untitled.md")]) {
    assert.equal(await f.engine.enqueue(file), false);
  }
  assert.equal(calls, 0);
  f.engine.dispose();
});

test("renaming is case-insensitive when checking collisions", async () => {
  const f = fixture();
  f.add("Inbox/COMMUNITY GARDEN PLANNING.md");
  const file = f.add();
  assert.equal(await f.engine.enqueue(file), true);
  assert.equal(file.path, "Inbox/Community garden planning 2.md");
  f.engine.dispose();
});

test("edits during generation discard the stale title", async () => {
  const pending = deferred<string>();
  const started = deferred<void>();
  const f = fixture(async () => { started.resolve(); return pending.promise; });
  const file = f.add();
  const job = f.engine.enqueue(file);
  await started.promise;
  f.contents.set(file, sample + " Our plans changed.");
  f.engine.cancel(file);
  pending.resolve("An outdated title");
  assert.equal(await job, false);
  assert.equal(file.path, "Inbox/Untitled.md");
  f.engine.dispose();
});

test("a manual filename change during generation is preserved", async () => {
  const pending = deferred<string>();
  const started = deferred<void>();
  const f = fixture(async () => { started.resolve(); return pending.promise; });
  const file = f.add();
  const job = f.engine.enqueue(file);
  await started.promise;
  file.path = "Inbox/My own title.md";
  file.basename = "My own title";
  pending.resolve("An unwanted title");
  assert.equal(await job, false);
  assert.equal(file.path, "Inbox/My own title.md");
  f.engine.dispose();
});

test("deleted notes and unloaded plugins cannot be renamed by a pending request", async () => {
  for (const dispose of [false, true]) {
    const pending = deferred<string>();
    const started = deferred<void>();
    const f = fixture(async () => { started.resolve(); return pending.promise; });
    const file = f.add();
    const job = f.engine.enqueue(file);
    await started.promise;
    if (dispose) f.engine.dispose(); else f.notes.delete(file);
    pending.resolve("Late title");
    assert.equal(await job, false);
    assert.equal(f.renames.length, 0);
    f.engine.dispose();
  }
});

test("changed settings invalidate an in-flight generation", async () => {
  const pending = deferred<string>();
  const started = deferred<void>();
  const f = fixture(async () => { started.resolve(); return pending.promise; });
  const file = f.add();
  const job = f.engine.enqueue(file);
  await started.promise;
  f.settings.enabled = false;
  f.engine.invalidate();
  pending.resolve("Late title");
  assert.equal(await job, false);
  f.engine.dispose();
});

test("a failed AI request leaves the file untitled and reports the failure", async () => {
  const f = fixture(async () => { throw new Error("Groq denied access."); });
  const file = f.add();
  assert.equal(await f.engine.enqueue(file), false);
  assert.equal(file.path, "Inbox/Untitled.md");
  assert.equal(f.errors[0], "Groq denied access.");
  assert.equal(f.contents.get(file), sample);
  f.engine.dispose();
});

test("title requests are serialized across notes", async () => {
  let concurrent = 0;
  let maximum = 0;
  const f = fixture(async () => {
    concurrent++;
    maximum = Math.max(maximum, concurrent);
    await delay(5);
    concurrent--;
    return "Community garden planning";
  });
  const files = [f.add(), f.add("Inbox/Untitled 1.md"), f.add("Inbox/Untitled 2.md")];
  const results = await Promise.all(files.map(file => f.engine.enqueue(file)));
  assert.deepEqual(results, [true, true, true]);
  assert.equal(maximum, 1);
  f.engine.dispose();
});

test("automatic generation waits for idle and coalesces typing events", async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return "Community garden planning"; });
  f.settings.delaySeconds = 0.03;
  const file = f.add();
  f.engine.schedule(file, true);
  await delay(10);
  f.engine.schedule(file, true);
  assert.equal(calls, 0);
  await delay(50);
  assert.equal(calls, 1);
  assert.equal(file.path, "Inbox/Community garden planning.md");
  f.engine.dispose();
});

test("undo restores the original filename and pauses that note until edited", async () => {
  const f = fixture();
  f.settings.delaySeconds = 0.01;
  const file = f.add();
  await f.engine.enqueue(file);
  assert.equal(await f.engine.undo(), true);
  assert.equal(file.path, "Inbox/Untitled.md");
  f.engine.schedule(file);
  await delay(30);
  assert.equal(file.path, "Inbox/Untitled.md");
  f.engine.schedule(file, true);
  await delay(30);
  assert.equal(file.path, "Inbox/Community garden planning.md");
  f.engine.dispose();
});

test("undo refuses to overwrite an occupied original filename", async () => {
  const f = fixture();
  const file = f.add();
  await f.engine.enqueue(file);
  f.add("Inbox/Untitled.md");
  await assert.rejects(f.engine.undo(), /Nothing was overwritten/);
  assert.equal(file.path, "Inbox/Community garden planning.md");
  f.engine.dispose();
});
