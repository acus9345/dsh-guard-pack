# dsh-session-cost-cap

[English](README.md) | 中文

午饭前你给智能体布置了一个任务。它遇到一个不稳定的测试，决定修复方法是重构，开了三个子智能体去"调查"，又把同一个 4000 行的文件读了二十遍。等你回来，任务没做完，这个会话的花费却比你这周其他所有会话加起来还多。

这个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件会按模型实际报告的 token 数和对应模型的价格，持续累计每个会话的花费。子智能体的花费计入启动它的会话。预算快用完时会提醒模型收尾；用完后，工具调用要等你批准才能继续：

```
[dsh-session-cost-cap] This session has used $4.12 of $5.00 (2.4M tokens), 82% of its budget.
Finish the task efficiently: skip optional exploration, avoid re-reading large files, and batch small edits.
```

## 安装

```sh
dsh plugin --profile web add dsh-session-cost-cap
```

这里用的是 `web` 配置（profile），也就是用 `dsh web` 打开的浏览器界面。如果你用别的方式运行 DSH，就换成 `headless`（脚本和 CI）或 `acp`（编辑器集成）。每个配置有自己的插件列表，你用到哪个就装到哪个。装好就生效，默认每个会话上限 5 美元。卸载：`dsh plugin --profile web remove dsh-session-cost-cap`。

它也是 [dsh-guard-pack](../../README_zh.md) 的一部分，那里可以一次装好九个防护插件。

## 工作方式

- **真实用量，真实价格**：每次模型调用后，DSH 的适配器会报告输入、输出和缓存 token 数。插件按这次请求使用的模型计价，价格来自 [llm-tally](https://www.npmjs.com/package/llm-tally) 收录的 138 个模型（DeepSeek、OpenAI、Anthropic、Google、xAI、Qwen 等），缓存命中按缓存价格计算。失败和重试的请求只要服务商报告了用量也会计入，因为它们同样花钱。
- **子智能体合并计算**：无论嵌套多深，子智能体的花费都计入启动它的会话。
- **先提醒**：用到预算的 80%（可调）时，下一条工具结果会附带提醒，让模型高效收尾。每个预算阶段只提醒一次。
- **再停下**：达到上限后，每次工具调用都要你批准（默认的 `ask`）或直接被拒绝（`deny`）。批准一次后，会话可以再花上限的 50%，然后才再次询问。`deny` 模式下，模型会被要求停下并总结已完成和未完成的部分。
- **也可以按 token 设上限**，或者金额和 token 同时限制。

## 没有价格的模型

如果某个模型不在 llm-tally 的价格表里（本地模型、微调模型、刚发布的模型），它的 token 仍然计入 token 上限，但不计入金额上限，DSH 日志会提示一次。在 `prices` 里给它设个价格即可。

## 局限

- 花费只在 DSH 运行期间记在内存里。重启 DSH 后恢复会话，会从零开始计数。
- 上限在工具调用前检查。只输出文字（不调用工具）的一步本来就会结束这一轮，不会自己失控，但越过上限的那一步仍会完成。
- 价格按标价计算，不考虑折扣、错峰价和批量价，所以对这些情况来说总额是偏高的估计。

## 设置

最简单的方法：在 DSH 侧边栏打开 **Plugins**，点 **dsh-session-cost-cap**，改好后按 **Save**，立即生效。

也可以在 `~/.dsh/profiles/<profile>/cordis.patch.yml`（对所有配置生效则用 `~/.dsh/cordis.patch.yml`）里加一行，没写的键保持默认值：

```yaml
- id: session-cost-cap
  config:
    maxUsd: 5          # 每个会话的美元上限（含子智能体）；0 = 不限金额
    maxTokens: 0       # 每个会话的输入加输出 token；0 = 不限 token
    mode: ask          # 或 deny
    extendBy: 0.5      # 批准后再允许上限的 50%
    warnAt: 0.8        # 用到 80% 时提醒模型；0 = 不提醒
    prices:            # 每百万 token 的美元价格，用于 llm-tally 不认识的模型
      my-local-model: { input: 0, output: 0 }
```

MIT 许可。作者 [acus9345](https://github.com/acus9345)。欢迎在 [issues](https://github.com/acus9345/dsh-guard-pack/issues) 里反馈问题和想法。
