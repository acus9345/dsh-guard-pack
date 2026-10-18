# dsh-block-secret-leaks

[English](README.md) | 中文

智能体排查配置问题时，很可能顺手运行一下 `cat .env`。于是你的 OpenAI 密钥就进了对话：它被发给了模型服务商，也留在了会话日志里。又或者它"贴心地"把密钥直接写进 `src/config.ts`，下一次提交就把它公开了。再或者它在有一个未被跟踪的 `.env.local` 时运行了 `git add -A`。

这个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件会在每次工具调用运行前检查一遍，拦下会泄露密钥的调用，并告诉模型该怎么做（提示是英文的，模型能看懂）：

```
dsh-block-secret-leaks stopped `cat .env` because it would expose a secret:
- prints .env, which holds secrets. Instead: to see which variables exist without their
  values, run `cut -d= -f1 .env`, or ask the user about the value you need.
```

如果还是有密钥混进了工具输出（比如 `docker inspect` 打印出了容器的环境变量），会在模型看到之前被替换掉：

```
OPENAI_API_KEY=[REDACTED: OPENAI_API_KEY]
DATABASE_URL=postgres://app:[REDACTED: DATABASE_URL]@db:5432/app
```

## 安装

```sh
dsh plugin --profile web add dsh-block-secret-leaks
```

这里用的是 `web` 配置（profile），也就是用 `dsh web` 打开的浏览器界面。如果你用别的方式运行 DSH，就换成 `headless`（脚本和 CI）或 `acp`（编辑器集成）。每个配置有自己的插件列表，你用到哪个就装到哪个。装好就生效。卸载：`dsh plugin --profile web remove dsh-block-secret-leaks`。

它也是 [dsh-guard-pack](../../README_zh.md) 的一部分，那里可以一次装好九个防护插件。

## 它会拦下什么

- **用 read 工具读取密钥文件**：`.env` 及其变体（不包括 `.env.example`）、私钥、`.npmrc`、`.pypirc`、`.netrc`、`.git-credentials`、AWS 凭据、`*.tfvars` 等。列表可以修改。
- **在 shell 里打印它们**：`cat`、`head`、`grep`、`Get-Content`、`type`、`git show HEAD:.env`、`sort < .env` 等。只看变量名的命令（`cut -d= -f1 .env`、`grep -q KEY .env`）和不会打印内容的命令（`source .env`、`sed -i ... .env`）不受影响。
- **打印环境变量**：不带参数的 `env`、`printenv`、`set`、`export -p`、`Get-ChildItem env:`，以及用 `echo $API_KEY` 或 `$env:API_KEY` 打印密钥变量。在命令里使用 `$API_KEY`（比如放在 `curl` 的请求头里）没问题。
- **复制或发送密钥文件**：`cp .env .env.example`、`scp .env server:`、`curl -F file=@.env`、`curl -T id_rsa`。
- **提交密钥文件**：`git add .env`、`git add -f`，以及存在未被忽略的密钥文件时运行 `git add -A` / `git commit -a`。
- **命令里直接写出密钥的值**，而不是从环境变量读取。
- **把密钥写进源代码文件**。写进被 git 忽略的文件（比如 `.env`）是允许的；如果 git 没有忽略 `.env`，会先要求把它加进 `.gitignore`。

## 它怎么认出密钥

1. **真实的值**：环境变量和工作区 `.env` 文件里名字像密钥的变量（`*_KEY`、`*_TOKEN`、`*_SECRET`、`*PASSWORD*`、`*_DSN`、`*_URL` 等）。这些值一旦出现在命令、修改或工具输出里，就算密钥。连接 URL 只算其中的密码。
2. **常见格式**：OpenAI 和 Anthropic 密钥、GitHub 和 GitLab 令牌、AWS 访问密钥、Google API 密钥、Slack 令牌和 webhook、Stripe 正式密钥、npm、PyPI、Hugging Face 令牌、SendGrid、DigitalOcean，以及私钥块。

AWS 文档里的示例密钥（以 `EXAMPLE` 结尾）、`sk-your-key-here`、同一个字母重复组成的令牌这类占位符会被忽略，文档和测试数据不会误报。

## 它拦不住什么

它依赖已知的值和格式。没有明显格式、又放在普通名字变量里的密钥会漏过去，可以把变量名加到 `extraSecretNames`，或者把格式加到 `extraPatterns`。读取 `.env` 后把内容打乱再打印的程序也拦不住。shell 检查是解析命令，而不是执行命令，刻意混淆的命令可能绕过。把它当作一张结实的安全网，而不是沙箱。

## 设置

最简单的方法：在 DSH 侧边栏打开 **Plugins**，点 **dsh-block-secret-leaks**，改好后按 **Save**，下一次工具调用就生效。

也可以在 `~/.dsh/profiles/<profile>/cordis.patch.yml`（对所有配置生效则用 `~/.dsh/cordis.patch.yml`）里加一行，没写的键保持默认值：

```yaml
- id: block-secret-leaks
  config:
    mode: deny                  # 或 ask：弹出审批
    guardReads: true
    guardShell: true
    guardWrites: true
    redactOutput: true
    disabledRules: []
    extraPatterns: ['acme_[a-z0-9]{32}']
    extraSecretNames: ['MY_CONN']
    allowIdenticalRetry: false
```

MIT 许可。作者 [acus9345](https://github.com/acus9345)。欢迎在 [issues](https://github.com/acus9345/dsh-guard-pack/issues) 里反馈问题和想法。
