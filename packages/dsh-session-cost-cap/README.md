# dsh-session-cost-cap

English | [中文](README_zh.md)

You give the agent a task before lunch. It hits a flaky test, decides the fix is a refactor, starts three subagents to "investigate", and re-reads the same 4,000-line file twenty times. When you come back the task isn't done, and the session has cost more than the rest of your week.

This [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin keeps a running total of what each session spends, from the token counts the model actually reports, priced per model. Subagents count toward the session that started them. As the budget runs low the model is told to wrap up, and once it's spent, tool calls stop until you approve more:

```
[dsh-session-cost-cap] This session has used $4.12 of $5.00 (2.4M tokens), 82% of its budget.
Finish the task efficiently: skip optional exploration, avoid re-reading large files, and batch small edits.
```

```
dsh-session-cost-cap: this session has reached its cost cap ($5.03 of $5.00 (2.9M tokens)).
The user was asked to approve this call. If they decline, stop and tell them what you finished and what is left.
```

## Install

```sh
dsh plugin --profile web add dsh-session-cost-cap
```

That's the `web` profile, the browser UI you start with `dsh web`. If you run DSH another way, use `headless` (scripts and CI) or `acp` (editor integrations) instead. Each profile keeps its own plugin list, so add it to every profile you use. It's on as soon as it's installed, with a $5 cap per session. Remove it with `dsh plugin --profile web remove dsh-session-cost-cap`.

It's also part of [dsh-guard-pack](../../README.md), which installs nine guards at once.

## How it works

- **Real usage, real prices.** After every model call, DSH's adapter reports input, output and cached tokens. The plugin prices them with the model the request used, using [llm-tally](https://www.npmjs.com/package/llm-tally)'s table of 138 models (DeepSeek, OpenAI, Anthropic, Google, xAI, Qwen and more), with cache reads at the cached rate. Failed and retried attempts count too when the provider reports their usage, because they cost money.
- **Subagents roll up.** A subagent's spend is added to the session that started it, however deep the nesting goes.
- **A warning first.** At 80% of the budget (configurable) the next tool result carries a note asking the model to finish efficiently. It's shown once per budget level.
- **Then a stop.** At the cap, each tool call needs your approval (`ask`, the default) or is refused (`deny`). Approving one lets the session spend another 50% of the cap before it asks again. In `deny` mode the model is told to stop and summarise what's done and what's left.
- **A token cap too**, if you'd rather count tokens than dollars, or use both.

## Models without a price

If a model isn't in llm-tally's table (a local model, a fine-tune, a new release), its tokens still count toward a token cap but not toward the dollar cap, and the DSH log says so once. Give it a price under `prices` to fix that.

## Limits

- Spend is tracked in memory while DSH runs. Resuming a session after restarting DSH starts its count from zero.
- The cap is checked before tool calls. A step that ends with plain text (no tool call) already ends the turn, so it never runs away on its own, but the step that crosses the cap still completes.
- Prices are list prices. Discounts, off-peak rates and batch pricing aren't applied, so the total is an upper estimate for those.

## Settings

The easy way: open **Plugins** in DSH's sidebar, click **dsh-session-cost-cap**, change what you want and press **Save**. It applies at once, no restart needed.

Or add a row like this to `~/.dsh/profiles/<profile>/cordis.patch.yml`, or to `~/.dsh/cordis.patch.yml` for every profile. Keys you leave out keep their defaults.

```yaml
- id: session-cost-cap
  config:
    maxUsd: 5          # dollars per session, subagents included; 0 = no dollar cap
    maxTokens: 0       # input + output tokens per session; 0 = no token cap
    mode: ask          # or deny
    extendBy: 0.5      # after an approval, allow 50% more of the cap before asking again
    warnAt: 0.8        # tell the model at 80% of the budget; 0 = never
    prices:            # USD per 1M tokens, for models llm-tally doesn't know
      my-local-model: { input: 0, output: 0 }
      my-fine-tune: { input: 3, output: 12, cachedInput: 0.3 }
```

## Development

```sh
npm install        # from the repository root
npm test -w packages/dsh-session-cost-cap
npm run test:e2e   # real dsh runs against a scripted local model, no API key needed
```

MIT licensed. Written by [acus9345](https://github.com/acus9345). Bug reports and ideas are welcome in the [issues](https://github.com/acus9345/dsh-guard-pack/issues).
