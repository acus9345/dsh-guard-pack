# dsh-format-after-edit

English | [中文](README_zh.md)

Agents don't run your formatter. They write code with their own idea of quotes, wrapping and trailing commas, and you find out at review time, or when CI's format check fails and the agent spends a turn "fixing" whitespace. Telling it to run Prettier after every edit works until it forgets.

This [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin runs the project's own formatter on each file right after the agent writes or edits it. When the formatter changes the file, the model is told, so its next edit doesn't target text that has moved:

```
The file src/api/client.ts has been updated successfully.

[dsh-format-after-edit] prettier reformatted src/api/client.ts (4 lines changed). Re-read the file
before editing it again, since text you saw earlier may have moved or changed.
```

When the formatter fails, which usually means the edit broke the syntax, the model sees why:

```
[dsh-format-after-edit] ruff could not format app/models.py. Your edit was saved, but this often
means it has a syntax error:
error: Failed to parse app/models.py:14:5: Expected an indented block after function definition
```

## Install

```sh
dsh plugin --profile web add dsh-format-after-edit
```

That's the `web` profile, the browser UI you start with `dsh web`. If you run DSH another way, use `headless` (scripts and CI) or `acp` (editor integrations) instead. Each profile keeps its own plugin list, so add it to every profile you use. It's on as soon as it's installed. Remove it with `dsh plugin --profile web remove dsh-format-after-edit`.

It's also part of [dsh-guard-pack](../../README.md), which installs nine guards at once.

## Which formatter runs

The one your project is set up for. A formatter runs only when the project has its config and the tool is installed locally or on your PATH. Nothing is ever downloaded, so a repo without a formatter is left alone.

| Files | Formatter | When |
| --- | --- | --- |
| JS, TS, JSON, CSS, Markdown, YAML, HTML, Vue, Svelte... | Prettier | `.prettierrc*`, `prettier.config.*` or a `"prettier"` key in `package.json`, and `prettier` in `node_modules` |
| JS, TS, JSON, CSS, GraphQL... | Biome | `biome.json(c)`, and `@biomejs/biome` in `node_modules` |
| Anything dprint has plugins for | dprint | `dprint.json` or `.dprint.json(c)`, and `dprint` in `node_modules` |
| Python | Ruff | `ruff.toml`, `.ruff.toml` or `[tool.ruff]` in `pyproject.toml`, and `ruff` in the venv or on PATH |
| Python | Black | `[tool.black]` in `pyproject.toml`, and `black` in the venv or on PATH |
| Go | gofmt | a `go.mod`, and `gofmt` on PATH |
| Rust | rustfmt | a `Cargo.toml` (its `edition` is used), and `rustfmt` on PATH |
| C, C++, Objective-C, protobuf | clang-format | a `.clang-format`, and `clang-format` on PATH |

The closest config wins, so a monorepo package with its own `biome.json` uses Biome even if the root has a `.prettierrc`. Each formatter's own ignore file (`.prettierignore`, Biome's `files.ignore`...) is respected. Lockfiles, `node_modules`, `dist`, `build`, `vendor` and minified files are never touched.

### Your own formatter

For anything else, add a command. `{file}` becomes the edited file's path, quoted. Custom entries are checked before the built-in ones.

```yaml
- id: format-after-edit
  config:
    custom:
      - files: ['*.php']
        command: vendor/bin/pint {file}
      - files: ['*.java']
        command: google-java-format --replace {file}
      - files: ['**/*.tf']
        command: terraform fmt {file}
```

## Settings

The easy way: open **Plugins** in DSH's sidebar, click **dsh-format-after-edit**, change what you want and press **Save**. Custom commands go in `cordis.patch.yml`.

Add a row like this to `~/.dsh/profiles/<profile>/cordis.patch.yml`, or to `~/.dsh/cordis.patch.yml` for every profile. Keys you leave out keep their defaults.

```yaml
- id: format-after-edit
  config:
    formatters: [prettier, biome, dprint, ruff, black, gofmt, rustfmt, clang-format]
    custom: []
    ignore: ['**/node_modules/**', '**/dist/**', '*.lock']   # replaces the default list
    tools: [write, edit, str_replace_editor]
    timeoutMs: 20000
    reportChanges: true   # tell the model when the file changed
    reportErrors: true    # tell the model when the formatter failed
```

## Development

```sh
npm install        # from the repository root
npm test -w packages/dsh-format-after-edit
npm run test:e2e   # real dsh runs against a scripted local model, no API key needed
```

MIT licensed. Written by [acus9345](https://github.com/acus9345). Bug reports and ideas are welcome in the [issues](https://github.com/acus9345/dsh-guard-pack/issues).
