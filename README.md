# Untitled Auto Title

An Obsidian desktop plugin that generates concise, content-based titles for untitled Markdown notes with Groq.

## How it works

1. Create a note with Obsidian's normal `Untitled` filename.
2. Write at least 30 letters or digits.
3. Pause for 10 seconds. Groq generates a title and the plugin renames the file in its current folder.

`Untitled 1`, `Untitled-2`, and similar numbered placeholders are also supported. Chosen filenames, dated journal notes, templates, hidden folders, and trash are excluded. After a title is generated, it stays fixed while you continue writing.

The plugin reads `GROQ_API_KEY` from Obsidian's inherited environment at runtime. Restart Obsidian after setting the variable; if a desktop launcher has an older environment, launch Obsidian from a terminal where the variable is available. The plugin does not run shell commands or query the Windows registry. The key is never copied into settings, source, archives, or synced vault files.

For titles without an API key, select **Local heading or phrase** in the plugin settings. This mode works offline and extracts a heading or meaningful phrase from the note.

Groq receives text from the note being titled, capped at 12,000 characters by default. For longer notes, an excerpt includes the beginning and end. YAML properties, hidden comments, and image embeds are removed from the request. Other content, such as code and visible links, can be included.

Default model: `openai/gpt-oss-20b`. Requests use Groq's [chat completions API](https://console.groq.com/docs/api-reference). Supported models and availability can change; see [Groq's model list](https://console.groq.com/docs/models).

## Installation

Requires Obsidian desktop 1.13 or newer.

### Windows installer

From a source checkout, install dependencies and build, then run the installer with your vault path:

```powershell
npm install
npm run build
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -VaultPath 'C:\path\to\your vault'
```

Restart Obsidian after installation. The script enables this plugin and preserves the existing enabled-plugin list. Existing plugin files are backed up before an update. It does not store an API key or alter your note contents.

### Manual installation

Download `main.js`, `manifest.json`, and `styles.css` from the GitHub release and copy them into:

```text
<vault>/.obsidian/plugins/untitled-auto-title/
```

Restart Obsidian, then enable **Untitled Auto Title** under **Settings → Community plugins**. Community plugins must be enabled.

## Settings and commands

Open **Settings → Untitled Auto Title** to change the idle delay, minimum note content, maximum title length, Groq model, environment variable name, excluded folders, and placeholder names. The connection test uses a built-in sample note.

These controls are available in Obsidian's settings search. Version 1.0.2 uses the declarative settings API and requires Obsidian 1.13.

The command palette includes:

- **Generate title for current untitled note**
- **Undo last generated title**
- **Test Groq connection with a sample note**

Right-click an eligible note for **Generate note title**.

To opt a note out, add a boolean property:

```yaml
---
auto-title: false
---
```

Select **Local heading or phrase** for offline extraction. Groq errors never silently trigger local extraction: a failed Groq request leaves the note untitled and reports the problem.

## Rename behavior

- Requests are serialized to avoid bursts.
- Notes are processed when created, edited, or opened; startup checks only the active note. The plugin does not enumerate the vault or offer a full-vault bulk scan.
- The plugin checks that the note still exists, remains untitled, and has not changed before applying the result.
- Existing filenames are preserved. Duplicate titles receive a numeric suffix.
- Titles are sanitized for Windows filenames and Obsidian links.
- The plugin uses Obsidian's FileManager, so link updating follows your Obsidian settings.
- Undo is available for the latest generated title in the current session. It refuses to overwrite an occupied original filename and pauses that note until you edit it.
- Generation errors pause automatic requests for a minute. You can retry with the command palette or by editing the note.

The plugin changes the filename; it does not insert a heading, rewrite the body, or add a title property. Obsidian can update references in other notes when automatic link updating is enabled.

## Development

```text
npm install
npm run check
npm test
npm run build
```

The test suite covers rename safety, changed content, manual title choices, collisions, exclusion rules, credential handling, debouncing, serialized requests, and undo. It uses synthetic content and mocked Groq responses; live service verification is recorded separately in `docs/PROGRESS.md`.

## Release provenance

After pushing a version tag, run `gh workflow run release.yml --ref <version>` to release that exact tagged source. GitHub Actions builds the plugin once, creates build-provenance attestations for `main.js`, `manifest.json`, and `styles.css`, and publishes those three assets. Installer ZIP files are kept as local deliverables instead of GitHub release attachments.

Verify a downloaded asset with GitHub CLI:

```text
gh attestation verify main.js --repo remriel/obsidian-untitled-auto-title
gh attestation verify styles.css --repo remriel/obsidian-untitled-auto-title
```

## Removal

Disable or uninstall **Untitled Auto Title** through **Settings → Community plugins**. Existing generated filenames remain. Use the undo command before disabling if you want to restore the last generated filename in the current session.
