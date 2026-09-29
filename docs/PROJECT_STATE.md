# Untitled Auto Title

## Objective and architecture

Create and install an Obsidian desktop plugin that generates concise content-based titles for untitled Markdown notes. The user chose Groq and explicitly authorized using the existing `GROQ_API_KEY` environment variable.

- Source is separate from the personal vault. Never commit note content or secrets.
- Installed Obsidian is `C:/Program Files/Obsidian/Obsidian.exe`, version 1.13.7. The console entry point is `Obsidian.com`.
- Target vault: `C:/Users/Gev/OneDrive/Documents/Obsidian Vault`. It is not a Git repository. Read its existing project/progress docs before modifying installation metadata.
- Groq uses the fixed HTTPS chat completions endpoint. Prefer the current production `openai/gpt-oss-20b` model; older Llama default examples are deprecated for standard accounts as of August 2026.
- Read the API key at runtime from the selected inherited environment variable. Never save the actual key in plugin settings or the synced vault. Version 1.0.1 removes the Windows registry subprocess fallback because it triggered the Shell Execution review warning; do not reintroduce shell execution. If a launcher has stale environment variables, restart Obsidian from a terminal that has the key.
- Debounce new/modified untitled notes; keep existing titled/daily/archive notes unchanged. Serialize generation and recheck filename and note contents before rename. Use `app.fileManager.renameFile` to respect link updates.
- The plugin may offer local extraction as an explicit mode. Groq errors must remain visible; never silently fall back and permanently name a note after a failed AI request.

## Discoveries and constraints

- `GROQ_API_KEY` is present in process and persistent user environment. It is absent in machine environment.
- There are no active Untitled notes in this vault. Untitled files seen in an absolute-path scan belong to excluded directories. Use vault-relative globs to exclude `.trash` and `.obsidian`.
- CLI exists but cannot connect until Obsidian is running.
- PowerShell and Node HTTPS Groq models requests return HTTP 403 with `Access denied. Please check your network settings.` No proxy environment variables are present. Obsidian's native request transport has not yet been tested; do not equate the result with an invalid key.
- Obsidian CLI is disabled. The user switched to the build-once-publish skill after the successful build and installation, so CLI activation and native acceptance checks were skipped. No global CLI setting was changed.
- Core implementation and 23 focused safety tests are complete. Tests cover content changes, manual renames, deletion/unload, collisions, exclusions, key handling, debouncing, serialization, and undo.
- GitHub CLI is authenticated as `remriel`. The repository `https://github.com/remriel/obsidian-untitled-auto-title` is now public, confirmed when resuming the review-fix task; the directory has scanned release 1.0.0.
- Version 1.0.1 is built, installed, and published at `https://github.com/remriel/obsidian-untitled-auto-title/releases/tag/1.0.1` with the installable ZIP and three Obsidian plugin assets. The installer backed up the previous plugin and confirmed matching installed hashes while preserving data.json. Code commit: `a7ce46b`.
- Settings on Obsidian 1.13+ use `getSettingDefinitions`, native groups/controls, validation, and explicit value persistence. Newline-based controls adapt the existing array storage. Obsidian 1.12 uses the imperative fallback, whose headings now use `Setting.setHeading()`.
- Plugin timers are explicitly scoped to `window`. YAML and Groq response values are narrowed from `unknown` before access. Filename control characters are handled by character codes instead of a control-character regex.
- Local mode remains available without a Groq key. It extracts a heading or phrase; a separate local AI model integration was discussed but not requested or implemented.
- The directory's unavailable malware scan is a service disclosure, not a code finding this plugin can correct.

## RESUME HERE

The user requested fixes for release 1.0.0's directory scan. Version 1.0.1 is now built once, installed, and published. No extra tests, type checking, linting, or UI checks were run under build-once-publish. The directory's fresh scan result has not been observed; do not claim a new score. The user can request review from the directory or wait for release detection. Key-free local mode is available through Title generator; a local AI model was not requested. Reopen Obsidian to load the installed update. Resume only for user-requested follow-up.
