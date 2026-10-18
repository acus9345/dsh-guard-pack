# dsh-guard-pack

[English](README.md) | 中文

九个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 防护插件，专门拦截编程智能体最容易犯、代价又高的错误，一条命令全部装好。

每个插件都会在工具调用运行前或运行后检查一遍。智能体要做你会后悔的事时，调用会被拦下，模型会被告知原因和替代做法，通常在同一步里就能改正。

| 插件 | 拦截什么 |
| --- | --- |
| [dsh-block-secret-leaks](packages/dsh-block-secret-leaks/README_zh.md) | 读取 `.env` 和密钥文件、打印或上传密钥、提交密钥、把密钥写进源代码，并在工具输出中隐去密钥。**新** |
| [dsh-session-cost-cap](packages/dsh-session-cost-cap/README_zh.md) | 会话（含子智能体）花费超过你设定的上限。先提醒模型，再在每次工具调用前询问你。**新** |
| [dsh-format-after-edit](packages/dsh-format-after-edit/README_zh.md) | 没有格式化的代码。对每个修改过的文件运行 Prettier、Biome、dprint、Ruff、Black、gofmt、rustfmt 或 clang-format。**新** |
| [dsh-protect-tests](https://github.com/acus9345/dsh-protect-tests) | 靠少测来让测试通过的修改：`.skip`、删除断言、`expect(true)`。 |
| [dsh-block-placeholder-edits](https://github.com/acus9345/dsh-block-placeholder-edits) | 用 `// ... existing code ...` 覆盖真实代码。 |
| [dsh-protect-generated-files](https://github.com/acus9345/dsh-protect-generated-files) | 手动修改锁文件和生成的代码。 |
| [dsh-enforce-package-manager](https://github.com/acus9345/dsh-enforce-package-manager) | 在 pnpm 仓库里用 `npm install`、在 uv 项目里用 `pip install`。 |
| [dsh-block-hanging-commands](https://github.com/acus9345/dsh-block-hanging-commands) | 等待输入或永不退出的命令：编辑器、REPL、开发服务器、不带 `-m` 的 `git commit`。 |
| [dsh-load-agent-rules](https://github.com/acus9345/dsh-load-agent-rules) | 忽略仓库里已有的 Cursor、Copilot、Windsurf、Cline 规则文件。 |

## 全部安装

装好 DSH 并且 `dsh` 在 PATH 上之后：

```sh
git clone https://github.com/acus9345/dsh-guard-pack
cd dsh-guard-pack
node scripts/install.mjs
```

这会把九个插件都装到 `web` 配置（用 `dsh web` 打开的浏览器界面）。其他选项：

```sh
node scripts/install.mjs --profile headless --profile web   # 装到多个配置
node scripts/install.mjs --only secret,cost,format          # 只装其中几个
node scripts/install.mjs --remove                           # 卸载
node scripts/install.mjs --dry-run                          # 只打印命令
```

不想克隆仓库的话，也可以直接粘贴：

```powershell
# PowerShell
"dsh-block-secret-leaks","dsh-session-cost-cap","dsh-format-after-edit","dsh-protect-tests","dsh-block-placeholder-edits","dsh-protect-generated-files","dsh-enforce-package-manager","dsh-block-hanging-commands","dsh-load-agent-rules" | ForEach-Object { dsh plugin --profile web add $_ }
```

```sh
# bash / zsh
for p in dsh-block-secret-leaks dsh-session-cost-cap dsh-format-after-edit dsh-protect-tests dsh-block-placeholder-edits dsh-protect-generated-files dsh-enforce-package-manager dsh-block-hanging-commands dsh-load-agent-rules; do dsh plugin --profile web add "$p"; done
```

每个插件不用任何配置就能工作。要修改设置，在 DSH 侧边栏打开 **Plugins** 点击对应插件，或者看它的 README。

## 开发

```sh
npm install
npm run typecheck
npm test            # 所有包的单元测试
npm run test:e2e    # 用脚本化的本地模型跑真实的 dsh，不需要 API key
```

发布某个包：更新它的版本号和 `CHANGELOG.md`，然后推送名为 `<包名>-v<版本>` 的标签，例如 `dsh-session-cost-cap-v0.1.1`。发布流程会跑完所有测试，用可信发布（trusted publishing）把这个包发布到 npm，并创建 GitHub release。

MIT 许可。作者 [acus9345](https://github.com/acus9345)。欢迎在 [issues](https://github.com/acus9345/dsh-guard-pack/issues) 里反馈问题和想法。
