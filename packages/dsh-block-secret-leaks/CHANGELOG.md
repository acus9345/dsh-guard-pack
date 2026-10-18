# Changelog

All notable changes to this package are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-18

### Added

- Refuses reading secret files (`.env`, private keys, `.npmrc`, credentials...) with the read tool.
- Refuses shell commands that print a secret file, dump the environment, print a secret variable, copy or upload a secret file, stage one for commit, or contain a secret value literally. Works for bash and PowerShell.
- Refuses edits that write a secret into a file git would commit; secrets may go into git-ignored files.
- Redacts secrets from tool output before the model sees it.
- Recognises secrets by the real values of secret-looking variables (environment and `.env` files, URL passwords) and by well-known token formats, ignoring placeholders.
- `deny` or `ask` mode, configurable secret files, rules, extra patterns and names, and a settings page on DSH's Plugins page.

[0.1.0]: https://github.com/acus9345/dsh-guard-pack/releases/tag/dsh-block-secret-leaks-v0.1.0
