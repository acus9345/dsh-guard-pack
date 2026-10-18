# dsh-format-after-edit

[English](README.md) | 中文

智能体不会主动运行你的格式化工具。它按自己的习惯处理引号、换行和尾逗号，你要到代码评审时才发现，或者等 CI 的格式检查失败后，再看着智能体花一整轮去"修"空格。让它每次改完都运行 Prettier，管用到它忘记为止。

这个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件会在智能体写入或修改文件后，马上用项目自己的格式化工具处理这个文件。如果格式化改动了文件，会告诉模型，这样它下一次修改就不会去找已经挪了位置的文本：

```
The file src/api/client.ts has been updated successfully.

[dsh-format-after-edit] prettier reformatted src/api/client.ts (4 lines changed). Re-read the file
before editing it again, since text you saw earlier may have moved or changed.
```

如果格式化失败（通常说明这次修改破坏了语法），模型会看到原因。

## 安装

```sh
dsh plugin --profile web add dsh-format-after-edit
```

这里用的是 `web` 配置（profile），也就是用 `dsh web` 打开的浏览器界面。如果你用别的方式运行 DSH，就换成 `headless`（脚本和 CI）或 `acp`（编辑器集成）。每个配置有自己的插件列表，你用到哪个就装到哪个。装好就生效。卸载：`dsh plugin --profile web remove dsh-format-after-edit`。

它也是 [dsh-guard-pack](../../README_zh.md) 的一部分，那里可以一次装好九个防护插件。

## 用哪个格式化工具

用你的项目配置好的那个。只有项目里有相应配置、并且工具已经装在本地或 PATH 上时才会运行，绝不会自动下载，所以没有配置格式化工具的仓库不受影响。

| 文件 | 工具 | 条件 |
| --- | --- | --- |
| JS、TS、JSON、CSS、Markdown、YAML、HTML、Vue、Svelte 等 | Prettier | 有 `.prettierrc*`、`prettier.config.*` 或 `package.json` 里的 `"prettier"`，且 `node_modules` 里有 `prettier` |
| JS、TS、JSON、CSS、GraphQL 等 | Biome | 有 `biome.json(c)`，且 `node_modules` 里有 `@biomejs/biome` |
| dprint 插件支持的文件 | dprint | 有 `dprint.json` 或 `.dprint.json(c)`，且 `node_modules` 里有 `dprint` |
| Python | Ruff | 有 `ruff.toml`、`.ruff.toml` 或 `pyproject.toml` 里的 `[tool.ruff]`，且 venv 或 PATH 上有 `ruff` |
| Python | Black | `pyproject.toml` 里有 `[tool.black]`，且 venv 或 PATH 上有 `black` |
| Go | gofmt | 有 `go.mod`，且 PATH 上有 `gofmt` |
| Rust | rustfmt | 有 `Cargo.toml`（使用其中的 `edition`），且 PATH 上有 `rustfmt` |
| C、C++、Objective-C、protobuf | clang-format | 有 `.clang-format`，且 PATH 上有 `clang-format` |

离文件最近的配置优先。各工具自己的忽略文件会被遵守。锁文件、`node_modules`、`dist`、`build`、`vendor` 和压缩过的文件永远不会被格式化。

### 自定义格式化命令

其他语言可以自己加命令，`{file}` 会被替换成加了引号的文件路径。自定义命令优先于内置工具：

```yaml
- id: format-after-edit
  config:
    custom:
      - files: ['*.php']
        command: vendor/bin/pint {file}
```

## 设置

最简单的方法：在 DSH 侧边栏打开 **Plugins**，点 **dsh-format-after-edit**，改好后按 **Save**。自定义命令写在 `cordis.patch.yml` 里：

```yaml
- id: format-after-edit
  config:
    formatters: [prettier, biome, dprint, ruff, black, gofmt, rustfmt, clang-format]
    custom: []
    timeoutMs: 20000
    reportChanges: true
    reportErrors: true
```

MIT 许可。作者 [acus9345](https://github.com/acus9345)。欢迎在 [issues](https://github.com/acus9345/dsh-guard-pack/issues) 里反馈问题和想法。
