# dsh-block-secret-leaks

English | [中文](README_zh.md)

An agent debugging a config problem will happily run `cat .env`. Now your OpenAI key is in the conversation, which means it went to the model provider and sits in the session log. Or it "helpfully" hardcodes the key into `src/config.ts`, and your next commit publishes it. Or it runs `git add -A` with an untracked `.env.local` lying around.

This [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin checks every tool call before it runs and stops the ones that would expose a secret, telling the model what to do instead:

```
dsh-block-secret-leaks stopped `cat .env` because it would expose a secret:
- prints .env, which holds secrets. Instead: to see which variables exist without their
  values, run `cut -d= -f1 .env`, or ask the user about the value you need.
Secrets sent to the model or committed to git are hard to take back. If you really need
this, ask the user to do it themselves or to give you only the non-secret detail you need.
```

Anything that still slips into tool output, like a `docker inspect` that prints the container's environment, is redacted before the model sees it:

```
OPENAI_API_KEY=[REDACTED: OPENAI_API_KEY]
DATABASE_URL=postgres://app:[REDACTED: DATABASE_URL]@db:5432/app
```

## Install

```sh
dsh plugin --profile web add dsh-block-secret-leaks
```

That's the `web` profile, the browser UI you start with `dsh web`. If you run DSH another way, use `headless` (scripts and CI) or `acp` (editor integrations) instead. Each profile keeps its own plugin list, so add it to every profile you use. It's on as soon as it's installed. Remove it with `dsh plugin --profile web remove dsh-block-secret-leaks`.

It's also part of [dsh-guard-pack](../../README.md), which installs nine guards at once.

## What it stops

- **Reading secret files** with the read tool: `.env` and its variants (not `.env.example`), private keys, `.npmrc`, `.pypirc`, `.netrc`, `.git-credentials`, AWS credentials, `*.tfvars` and more. The list is configurable.
- **Printing them from the shell:** `cat`, `head`, `grep`, `Get-Content`, `type`, `git show HEAD:.env`, `sort < .env` and friends. Commands that only see names (`cut -d= -f1 .env`, `grep -q KEY .env`) and commands that don't print (`source .env`, `sed -i ... .env`) are fine.
- **Printing the environment:** bare `env`, `printenv`, `set`, `export -p`, `Get-ChildItem env:`, and printing a secret variable with `echo $API_KEY` or `$env:API_KEY`. Using `$API_KEY` inside a command, like a `curl` header, is fine.
- **Copying or sending secret files:** `cp .env .env.example`, `scp .env server:`, `curl -F file=@.env`, `curl -T id_rsa`.
- **Committing them:** `git add .env`, `git add -f`, and `git add -A` / `git commit -a` when a secret file is untracked and not ignored.
- **Secrets written out literally** in a command, instead of read from a variable.
- **Secrets written into source files.** Writing a key into a git-ignored file like `.env` is allowed; writing it into `.env` when git doesn't ignore `.env` is stopped until it does.

## How it recognises a secret

Two ways, both cheap:

1. **The real values.** Every environment variable with a secret-looking name (`*_KEY`, `*_TOKEN`, `*_SECRET`, `*PASSWORD*`, `*_DSN`...) and every such variable in the workspace's `.env` files. If one of those exact values shows up in a command, an edit or tool output, it's a secret. For connection URLs only the password counts.
2. **Well-known formats** with distinctive prefixes: OpenAI and Anthropic keys, GitHub and GitLab tokens, AWS access keys, Google API keys, Slack tokens and webhooks, live Stripe keys, npm, PyPI and Hugging Face tokens, SendGrid, DigitalOcean, and private key blocks.

Placeholders like AWS's documentation example key (the one ending in `EXAMPLE`), `sk-your-key-here` or a token that's one letter repeated are ignored, so docs and test fixtures don't trip it.

## What it won't catch

It works on known values and formats. A secret with no recognisable format, held in a variable with an ordinary name, gets through; add the name under `extraSecretNames` or a format under `extraPatterns`. A program that reads `.env` and prints it in a scrambled form gets through too. Shell checks parse the command, they don't run it, so heavily obfuscated commands can slip past. Treat it as a strong safety net, not a sandbox.

## Settings

The easy way: open **Plugins** in DSH's sidebar, click **dsh-block-secret-leaks**, change what you want and press **Save**. It applies to the next tool call, no restart needed.

Or add a row like this to `~/.dsh/profiles/<profile>/cordis.patch.yml`, or to `~/.dsh/cordis.patch.yml` for every profile. Keys you leave out keep their defaults.

```yaml
- id: block-secret-leaks
  config:
    mode: deny                  # or `ask` for an approval prompt
    guardReads: true
    guardShell: true
    guardWrites: true
    redactOutput: true
    disabledRules: []           # read-secret-file, copy-secret-file, upload-secret-file,
                                # dump-env, echo-secret-var, git-add-secret, literal-secret
    secretFiles: ['.env', '.env.*', '!.env.example', '*.pem']   # replaces the default list
    extraPatterns: ['acme_[a-z0-9]{32}']
    extraSecretNames: ['MY_CONN']
    allowIdenticalRetry: false  # true: the model can confirm by repeating the call
    shellTools: [bash, pwsh]   # pwsh is the shell DSH uses on Windows
    readTools: [read]
```

## Development

```sh
npm install        # from the repository root
npm test -w packages/dsh-block-secret-leaks
npm run test:e2e   # real dsh runs against a scripted local model, no API key needed
```

MIT licensed. Written by [acus9345](https://github.com/acus9345). Bug reports and ideas are welcome in the [issues](https://github.com/acus9345/dsh-guard-pack/issues).
