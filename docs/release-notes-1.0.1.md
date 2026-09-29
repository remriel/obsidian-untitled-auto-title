# Untitled Auto Title 1.0.1

Addresses the code findings in the Obsidian Community directory review.

- Uses native settings headings instead of direct HTML heading elements.
- Adds declarative, searchable settings for Obsidian 1.13+, with a compatibility settings page for 1.12.
- Uses window-scoped timers for popout compatibility.
- Narrows YAML properties and Groq response values before accessing them.
- Removes shell execution and Windows registry subprocesses from the plugin.
- Sanitizes filename control characters without a control-character regular expression or unnecessary bracket escaping.

Groq keys are read from Obsidian's inherited environment. If a desktop launcher has an older environment, launch Obsidian from a terminal where GROQ_API_KEY is available. The key is never saved in the vault.

Select **Local heading or phrase (no key)** in the plugin settings for offline titles without an API key.
