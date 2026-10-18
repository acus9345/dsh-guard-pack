# Changelog

All notable changes to this package are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-18

### Added

- Tracks each session's spend from the token usage the model adapter reports, priced per model with llm-tally or prices you set. Subagents count toward the session that started them.
- Tells the model when a configurable share of the budget is used.
- At the cap, asks you before each tool call (`ask`) or refuses them (`deny`). An approval extends the budget by `extendBy`.
- Optional token cap, and a settings page on DSH's Plugins page.

[0.1.0]: https://github.com/acus9345/dsh-guard-pack/releases/tag/dsh-session-cost-cap-v0.1.0
