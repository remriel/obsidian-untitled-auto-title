# Untitled Auto Title 1.0.0

Automatically generate content-based filenames for untitled Obsidian Markdown notes using Groq.

- Reads the API key from `GROQ_API_KEY` at runtime; never saves the key to the vault.
- Generates a concise title after 10 seconds of idle time with at least 30 letters or digits.
- Uses `openai/gpt-oss-20b` on Groq by default; model and limits are configurable.
- Preserves chosen titles, dated notes, excluded folders, and explicit opt-outs.
- Handles duplicate and Windows-reserved filenames.
- Discards results if the note was edited, renamed, deleted, or the plugin was unloaded.
- Includes manual title commands, a sample connection test, and session undo.
- Uses Obsidian's FileManager for link updates.
- Offers an explicit offline heading/phrase mode.

## Install

Download and extract `untitled-auto-title-1.0.0.zip`. Run its Windows `Install.ps1` with your vault path, or copy the `untitled-auto-title` folder into your vault's `.obsidian/plugins` directory and enable it. Restart Obsidian.

## Release state

Production build completed. TypeScript checking and 23 safety tests passed before the user switched to build-once-publish. The release is installed in the target vault and enabled in its plugin configuration.

Native Obsidian/Groq acceptance is left to the user. Earlier direct requests to Groq returned HTTP 403 with a network-access error; the native Obsidian transport has not been tested. A failed Groq request leaves the note untitled and displays the error.
