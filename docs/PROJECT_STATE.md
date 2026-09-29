# Untitled Auto Title

## Objective and architecture

Create and install an Obsidian desktop plugin that generates concise content-based titles for untitled Markdown notes. The user chose Groq and explicitly authorized using the existing `GROQ_API_KEY` environment variable.

- Source is separate from the personal vault. Never commit note content or secrets.
- Installed Obsidian is `C:/Program Files/Obsidian/Obsidian.exe`, version 1.13.7. The console entry point is `Obsidian.com`.
- Target vault: `C:/Users/Gev/OneDrive/Documents/Obsidian Vault`. It is not a Git repository. Read its existing project/progress docs before modifying installation metadata.
- Groq uses the fixed HTTPS chat completions endpoint. Prefer the current production `openai/gpt-oss-20b` model; older Llama default examples are deprecated for standard accounts as of August 2026.
- Read the API key at runtime from the selected inherited environment variable. Never save the actual key in plugin settings or the synced vault. Version 1.0.1 removes the Windows registry subprocess fallback because it triggered the Shell Execution review warning; do not reintroduce shell execution. If a launcher has stale environment variables, restart Obsidian from a terminal that has the key.
- Debounce newly created, modified, and opened untitled notes. Startup checks only the active note; version 1.0.2 removes whole-vault enumeration and the bulk-title command. Serialize generation/undo and recheck filename and note contents before rename. Use `app.fileManager.renameFile` to respect link updates.
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
- Version 1.0.2 requires Obsidian 1.13.0 because `refreshDomState` and declarative settings were introduced there. The older imperative `display` fallback is removed. `getSettingDefinitions` supplies native groups/controls, validation, and value persistence; newline controls adapt existing array storage.
- `src/core.ts: uniquePath` now awaits direct adapter existence checks for candidate filenames. Do not enumerate all loaded files for case-insensitive collision checks: the filesystem adapter handles the platform's filename semantics. Rename and undo guards run after asynchronous checks, and undo shares the generation queue.
- Plugin timers are explicitly scoped to `window`. YAML and Groq response values are narrowed from `unknown` before access. Filename control characters are handled by character codes instead of a control-character regex.
- Local mode remains available without a Groq key. It extracts a heading or phrase; a separate local AI model integration was discussed but not requested or implemented.
- The directory's unavailable malware scan is a service disclosure, not a code finding this plugin can correct.
- `.github/workflows/release.yml` is the release path from 1.0.2 onward: push a semantic-version tag matching package/manifest/versions and its release-notes file, then explicitly dispatch `gh workflow run release.yml --ref <version>`. Official pinned GitHub actions install locked dependencies, build once, attest main.js/manifest.json/styles.css, and publish exactly those three assets. Installer ZIPs stay local; main.js is an ignored generated artifact rather than tracked source.
- Initial tag-push triggering registered an active workflow but produced no runs after repeated spaced observations. It was replaced with explicit workflow_dispatch. Only the unpublished 1.0.2 tag created during this task may be moved to include that fix; guard against an existing release and use a force-with-lease for the tag. Do not move published release tags.
- The sole production build for this update will run in GitHub Actions so its cryptographic provenance binds to the actual source/tag. Download those published assets for installation; do not rebuild locally before or after the CI build. Only requested attestation verification is planned beyond build/installer checks.

## RESUME HERE

Version 1.0.2 source is pushed but the tag-push release workflow did not schedule any runs. The explicit workflow_dispatch fix is prepared. Commit/push it, retarget the still-unpublished 1.0.2 tag with a release guard and force-with-lease, then dispatch release.yml at ref 1.0.2. Follow that run through build/attestation/publication; download and verify main.js/styles.css attestations, then install/package those exact assets. No production build has run yet. Preserve existing settings and skip additional local build/lint/tests/UI checks under build-once-publish.
