# Untitled Auto Title

## Objective and architecture

Create and install an Obsidian desktop plugin that generates concise content-based titles for untitled Markdown notes. The user chose Groq and explicitly authorized using the existing `GROQ_API_KEY` environment variable.

- Source is separate from the personal vault. Never commit note content or secrets.
- Installed Obsidian is `C:/Program Files/Obsidian/Obsidian.exe`, version 1.13.7. The console entry point is `Obsidian.com`.
- Target vault: `C:/Users/Gev/OneDrive/Documents/Obsidian Vault`. It is not a Git repository. Read its existing project/progress docs before modifying installation metadata.
- Groq uses the fixed HTTPS chat completions endpoint. Prefer the current production `openai/gpt-oss-20b` model; older Llama default examples are deprecated for standard accounts as of August 2026.
- Read the API key at runtime from the selected environment variable. On Windows, fall back to the persistent user/machine environment if the launcher has stale inherited variables. Never save the actual key in plugin settings or the synced vault.
- Debounce new/modified untitled notes; keep existing titled/daily/archive notes unchanged. Serialize generation and recheck filename and note contents before rename. Use `app.fileManager.renameFile` to respect link updates.
- The plugin may offer local extraction as an explicit mode. Groq errors must remain visible; never silently fall back and permanently name a note after a failed AI request.

## Discoveries and constraints

- `GROQ_API_KEY` is present in process and persistent user environment. It is absent in machine environment.
- There are no active Untitled notes in this vault. Untitled files seen in an absolute-path scan belong to excluded directories. Use vault-relative globs to exclude `.trash` and `.obsidian`.
- CLI exists but cannot connect until Obsidian is running.
- PowerShell and Node HTTPS Groq models requests return HTTP 403 with `Access denied. Please check your network settings.` No proxy environment variables are present. Obsidian's native request transport has not yet been tested; do not equate the result with an invalid key.
- Obsidian CLI is disabled. The user switched to the build-once-publish skill after the successful build and installation, so CLI activation and native acceptance checks were skipped. No global CLI setting was changed.
- Core implementation and 23 focused safety tests are complete. Tests cover content changes, manual renames, deletion/unload, collisions, exclusions, key handling, debouncing, serialization, and undo.
- GitHub CLI is authenticated as `remriel`; create a private standalone plugin repository after verified implementation.
- Version 1.0.0 source is synchronized to the private repository `https://github.com/remriel/obsidian-untitled-auto-title`. Release `https://github.com/remriel/obsidian-untitled-auto-title/releases/tag/1.0.0` is published with the installable ZIP and three Obsidian plugin assets.

## RESUME HERE

Version 1.0.0 was built once, installed/enabled in the target vault, and published to the private GitHub repository and release. Installed file hashes matched the build during installation. Credentials were not copied. No active Untitled notes existed at the pre-install inventory. The user invoked build-once-publish after installation: native Obsidian/Groq acceptance belongs to the user and no additional validation was run. The earlier direct Groq HTTP 403 network-access result remains a material unverified-service boundary. Reopen Obsidian to load the plugin. Resume only on a new user request; preserve this workflow unless they request further checks.
