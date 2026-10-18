# dsh-guard-pack

English | [中文](README_zh.md)

Nine guard plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) that catch the expensive mistakes coding agents make, installed with one command.

[![CI](https://github.com/acus9345/dsh-guard-pack/actions/workflows/ci.yml/badge.svg)](https://github.com/acus9345/dsh-guard-pack/actions/workflows/ci.yml)

Each guard watches tool calls before or after they run. When an agent is about to do something you'd regret, the call is stopped and the model is told why and what to do instead, so it usually fixes course in the same step.

| Plugin | What it stops | npm |
| --- | --- | --- |
| [dsh-block-secret-leaks](packages/dsh-block-secret-leaks) | Reading `.env` and key files, printing or uploading secrets, committing them, hardcoding them in source. Redacts any that reach tool output. **New.** | [![npm](https://img.shields.io/npm/v/dsh-block-secret-leaks)](https://www.npmjs.com/package/dsh-block-secret-leaks) |
| [dsh-session-cost-cap](packages/dsh-session-cost-cap) | A session (with its subagents) spending more than you set. Warns the model first, then asks you before each tool call. **New.** | [![npm](https://img.shields.io/npm/v/dsh-session-cost-cap)](https://www.npmjs.com/package/dsh-session-cost-cap) |
| [dsh-format-after-edit](packages/dsh-format-after-edit) | Unformatted code. Runs Prettier, Biome, dprint, Ruff, Black, gofmt, rustfmt or clang-format on every edited file. **New.** | [![npm](https://img.shields.io/npm/v/dsh-format-after-edit)](https://www.npmjs.com/package/dsh-format-after-edit) |
| [dsh-protect-tests](https://github.com/acus9345/dsh-protect-tests) | Edits that make tests pass by testing less: `.skip`, deleted assertions, `expect(true)`. | [![npm](https://img.shields.io/npm/v/dsh-protect-tests)](https://www.npmjs.com/package/dsh-protect-tests) |
| [dsh-block-placeholder-edits](https://github.com/acus9345/dsh-block-placeholder-edits) | `// ... existing code ...` written over real code. | [![npm](https://img.shields.io/npm/v/dsh-block-placeholder-edits)](https://www.npmjs.com/package/dsh-block-placeholder-edits) |
| [dsh-protect-generated-files](https://github.com/acus9345/dsh-protect-generated-files) | Hand edits to lockfiles and generated code. | [![npm](https://img.shields.io/npm/v/dsh-protect-generated-files)](https://www.npmjs.com/package/dsh-protect-generated-files) |
| [dsh-enforce-package-manager](https://github.com/acus9345/dsh-enforce-package-manager) | `npm install` in a pnpm repo, `pip install` in a uv project. | [![npm](https://img.shields.io/npm/v/dsh-enforce-package-manager)](https://www.npmjs.com/package/dsh-enforce-package-manager) |
| [dsh-block-hanging-commands](https://github.com/acus9345/dsh-block-hanging-commands) | Commands that wait for input or never exit: editors, REPLs, dev servers, `git commit` without `-m`. | [![npm](https://img.shields.io/npm/v/dsh-block-hanging-commands)](https://www.npmjs.com/package/dsh-block-hanging-commands) |
| [dsh-load-agent-rules](https://github.com/acus9345/dsh-load-agent-rules) | Ignoring the Cursor, Copilot, Windsurf and Cline rule files your repo already has. | [![npm](https://img.shields.io/npm/v/dsh-load-agent-rules)](https://www.npmjs.com/package/dsh-load-agent-rules) |

## Install all of them

With DSH installed and `dsh` on your PATH:

```sh
git clone https://github.com/acus9345/dsh-guard-pack
cd dsh-guard-pack
node scripts/install.mjs
```

That adds all nine to the `web` profile (the browser UI you start with `dsh web`). Options:

```sh
node scripts/install.mjs --profile headless --profile web   # several profiles
node scripts/install.mjs --only secret,cost,format          # some of them
node scripts/install.mjs --remove                           # take them out again
node scripts/install.mjs --dry-run                          # print the commands only
```

Or skip the clone and paste one of these:

```sh
# bash / zsh
for p in dsh-block-secret-leaks dsh-session-cost-cap dsh-format-after-edit dsh-protect-tests dsh-block-placeholder-edits dsh-protect-generated-files dsh-enforce-package-manager dsh-block-hanging-commands dsh-load-agent-rules; do dsh plugin --profile web add "$p"; done
```

```powershell
# PowerShell
"dsh-block-secret-leaks","dsh-session-cost-cap","dsh-format-after-edit","dsh-protect-tests","dsh-block-placeholder-edits","dsh-protect-generated-files","dsh-enforce-package-manager","dsh-block-hanging-commands","dsh-load-agent-rules" | ForEach-Object { dsh plugin --profile web add $_ }
```

Every plugin works with no configuration. To change one, open **Plugins** in DSH's sidebar and click it, or see its README.

## Repository layout

The three new plugins live here as npm workspaces. The other six have their own repositories, linked above.

```
packages/
  dsh-block-secret-leaks/
  dsh-session-cost-cap/
  dsh-format-after-edit/
e2e/                     end-to-end tests that run the real dsh with a scripted model
scripts/install.mjs
```

## Development

```sh
npm install
npm run typecheck
npm test            # unit tests for every package
npm run test:e2e    # real dsh runs against a scripted local model, no API key needed
```

The end-to-end tests include a `dsh plugin add` install, which needs `pnpm` on your PATH.

To release a package, bump its version and `CHANGELOG.md`, then push a tag named `<package>-v<version>`, for example `dsh-session-cost-cap-v0.1.1`. The release workflow tests everything, publishes that package to npm with trusted publishing, and creates the GitHub release.

MIT licensed. Written by [acus9345](https://github.com/acus9345). Bug reports and ideas are welcome in the [issues](https://github.com/acus9345/dsh-guard-pack/issues).
