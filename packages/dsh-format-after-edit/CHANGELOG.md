# Changelog

All notable changes to this package are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-18

### Added

- Runs the project's formatter on files the agent writes or edits: Prettier, Biome, dprint, Ruff, Black, gofmt, rustfmt or clang-format, detected from the project's own config. Nothing is downloaded.
- Custom formatter commands per glob.
- Tells the model when a file was reformatted, and shows the formatter's error when it fails.
- Configurable formatters, ignore globs, tools and timeout, and a settings page on DSH's Plugins page.

[0.1.0]: https://github.com/acus9345/dsh-guard-pack/releases/tag/dsh-format-after-edit-v0.1.0
