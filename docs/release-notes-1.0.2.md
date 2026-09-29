# Untitled Auto Title 1.0.2

Resolves the remaining compatibility and release recommendations from the Community directory review.

- Declares Obsidian 1.13.0 as the minimum version, matching the searchable settings APIs in use.
- Removes the deprecated imperative display fallback and uses declarative settings throughout.
- Processes notes when they are created, edited, or opened, with only the active note checked on startup. Full-vault enumeration and the bulk title command are removed.
- Checks only candidate filenames for collisions using the vault adapter; asynchronous checks retain the existing stale-result and overwrite guards.
- Publishes only main.js, manifest.json, and styles.css as release assets.
- GitHub Actions builds these assets and creates cryptographic build-provenance attestations before publication.

Local heading/phrase mode continues to work offline without an API key. Existing plugin settings are retained when updating.
