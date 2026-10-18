/**
 * dsh-block-secret-leaks: keeps API keys, passwords and private keys out of
 * the conversation, out of committed files, and off the network.
 *
 * On `tools/pre-execute` it refuses:
 * - reading secret files (`.env`, private keys, `.npmrc`...) with the read tool or the shell;
 * - shell commands that print the environment or a secret variable, copy or
 *   upload a secret file, stage one for commit, or carry a secret value literally;
 * - edits that write a secret into a file git would commit.
 *
 * On `tools/post-execute` it redacts secrets from tool output before the model
 * sees it, so a stray `docker inspect` or log line can't send them to the model.
 *
 * Secrets are recognised by well-known token formats and by the actual values
 * of secret-looking variables in the environment and the workspace's `.env` files.
 *
 * @module dsh-block-secret-leaks
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { PostToolDecision, PreToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { analyzeCommand, COMMAND_RULES, type CommandFinding, type CommandRule } from './commands.ts'
import { collectKnownSecrets, findSecrets, isSecretName, mask, redact, type KnownSecret, type TokenPattern } from './secrets.ts'
import { canonicalJson, fileMutation, resolvePath, workspaceOf } from './shared/files.ts'
import { matchesAny } from './shared/glob.ts'
import { resolveConfig } from './shared/live.ts'

export { analyzeCommand, COMMAND_RULES } from './commands.ts'
export type { CommandFinding, CommandRule } from './commands.ts'
export { collectKnownSecrets, findSecrets, isSecretName, parseDotenv, redact, TOKEN_PATTERNS } from './secrets.ts'
export type { KnownSecret, SecretMatch, TokenPattern } from './secrets.ts'

export const name = 'block-secret-leaks'

/** Files that hold secrets. Later `!` entries exclude. */
export const DEFAULT_SECRET_FILES: readonly string[] = [
  '.env', '.env.*', '*.env', '.dev.vars', '!.env.example', '!.env.sample', '!.env.template', '!.env.defaults', '!*.example.env',
  '*.pem', '*.key', '*.p12', '*.pfx', '*.jks', '*.keystore', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519',
  '.npmrc', '.pypirc', '.netrc', '_netrc', '.git-credentials', '.aws/credentials', 'credentials.json', 'service-account*.json',
  '*.tfvars', '!*.example.tfvars', '.secrets', 'secrets.y*ml', '!*.pub',
]

/** Plugin configuration. */
export interface Config {
  mode: 'deny' | 'ask'
  /** Globs (workspace-relative) for files that hold secrets; `!pattern` excludes. */
  secretFiles: string[]
  /** Refuse the read tool on secret files. */
  guardReads: boolean
  /** Check shell commands. */
  guardShell: boolean
  /** Refuse edits that put a secret into a file git would commit. */
  guardWrites: boolean
  /** Redact secrets from tool output before the model sees it. */
  redactOutput: boolean
  /** Command rules to ignore. */
  disabledRules: CommandRule[]
  /** Extra secret formats as regular expressions, e.g. `acme_[a-z0-9]{32}`. */
  extraPatterns: string[]
  /** Variable names to treat as secret even if they don't look like one. */
  extraSecretNames: string[]
  /** Let an identical retry through as a confirmation. */
  allowIdenticalRetry: boolean
  /** Shell tool names to check. */
  shellTools: string[]
  /** Read tool names to check (argument `file_path` or `path`). */
  readTools: string[]
}

export const Config: Schema<Config> = Schema.object({
  mode: Schema.union(['deny', 'ask']).default('deny').volatile(),
  secretFiles: Schema.array(Schema.string()).default([...DEFAULT_SECRET_FILES]).volatile(),
  guardReads: Schema.boolean().default(true).volatile(),
  guardShell: Schema.boolean().default(true).volatile(),
  guardWrites: Schema.boolean().default(true).volatile(),
  redactOutput: Schema.boolean().default(true).volatile(),
  disabledRules: Schema.array(Schema.union([...COMMAND_RULES])).default([]).volatile(),
  extraPatterns: Schema.array(Schema.string()).default([]).volatile(),
  extraSecretNames: Schema.array(Schema.string()).default([]).volatile(),
  allowIdenticalRetry: Schema.boolean().default(false).volatile(),
  shellTools: Schema.array(Schema.string()).default(['bash', 'pwsh']).volatile(),
  readTools: Schema.array(Schema.string()).default(['read']).volatile(),
}) as unknown as Schema<Config>

/** Is a file git-ignored? `undefined` when the folder isn't a git repository or git is missing. */
export function gitIgnored(relative: string, workspace: string): boolean | undefined {
  const r = spawnSync('git', ['check-ignore', '-q', '--', relative], { cwd: workspace, timeout: 5000, windowsHide: true })
  if (r.status === 0) return true
  if (r.status === 1) return false
  return undefined
}

/** Paths `git add -A` would stage: changed and untracked files that aren't ignored. */
export function stageablePaths(workspace: string): string[] {
  const r = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: workspace, timeout: 5000, windowsHide: true, encoding: 'utf8' })
  if (r.status !== 0 || typeof r.stdout !== 'string') return []
  const out: string[] = []
  const parts = r.stdout.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]!
    if (entry.length < 4) continue
    out.push(entry.slice(3))
    // Renames carry the old path in the next field.
    if (entry[0] === 'R' || entry[0] === 'C') i++
  }
  return out
}

/** Model-facing reason for a refusal. */
export function denialText(target: string, reasons: ReadonlyArray<{ detail: string; fix: string }>, retryAllowed: boolean): string {
  const lines = reasons.map(r => `- ${r.detail}. Instead: ${r.fix}.`).join('\n')
  return `dsh-block-secret-leaks stopped ${target} because it would expose a secret:\n${lines}\n`
    + 'Secrets sent to the model or committed to git are hard to take back. '
    + (retryAllowed
      ? 'If the user has explicitly asked for this, tell them what you are about to expose and why, then repeat the identical call once to confirm.'
      : 'If you really need this, ask the user to do it themselves or to give you only the non-secret detail you need.')
}

export function apply(ctx: Context, config: Config): void {
  const pending = new Set<string>()
  const remember = (key: string): void => {
    pending.add(key)
    if (pending.size > 200) pending.delete(pending.values().next().value!)
  }

  // Known secret values change rarely; re-read them at most every few seconds per workspace.
  const knownCache = new Map<string, { at: number; secrets: KnownSecret[] }>()
  const knownFor = (workspace: string, extraNames: readonly string[]): KnownSecret[] => {
    const key = `${workspace}\0${extraNames.join(',')}`
    const hit = knownCache.get(key)
    if (hit !== undefined && Date.now() - hit.at < 5000) return hit.secrets
    const extra = new Set(extraNames.map(n => n.toUpperCase()))
    const secrets = collectKnownSecrets(process.env, workspace, n => extra.has(n.toUpperCase()) || isSecretName(n))
    knownCache.set(key, { at: Date.now(), secrets })
    if (knownCache.size > 20) knownCache.delete(knownCache.keys().next().value!)
    return secrets
  }
  const patternsOf = (cfg: Config): TokenPattern[] =>
    cfg.extraPatterns.flatMap((source, i) => {
      try {
        return [{ id: `custom-${i + 1}`, label: `a secret matching /${source}/`, pattern: new RegExp(source, 'g') }]
      } catch {
        ctx.logger.warn('dsh-block-secret-leaks: ignoring invalid extraPatterns entry %s', source)
        return []
      }
    })

  const decide = (cfg: Config, key: string, target: string, reasons: Array<{ detail: string; fix: string }>, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> | PreToolDecision => {
    if (reasons.length === 0) return next()
    const text = denialText(target, reasons, cfg.allowIdenticalRetry)
    if (cfg.mode === 'ask') {
      return { kind: 'ask', reason: text, displayReason: { en: `This would expose a secret: ${reasons.map(r => r.detail).join('; ')}.` } }
    }
    if (cfg.allowIdenticalRetry) remember(key)
    return { kind: 'deny', reason: text }
  }

  ctx.on('tools/pre-execute', async (exec: ToolExecution, next: () => Promise<PreToolDecision>) => {
    const cfg = resolveConfig(config)
    const workspace = workspaceOf(exec)
    const key = createHash('sha256').update(`${exec.name}\0${canonicalJson(exec.arguments)}\0${workspace}`).digest('hex')
    if (cfg.allowIdenticalRetry && pending.delete(key)) return next()
    const isSecretFile = (path: string): boolean => {
      const { relative } = resolvePath(path, workspace)
      return matchesAny(relative.replace(/^(\.\.\/)+/, ''), cfg.secretFiles)
    }
    const args = (exec.arguments ?? {}) as Record<string, unknown>

    // Reading a secret file.
    const readPath = cfg.readTools.includes(exec.name)
      ? (typeof args.file_path === 'string' ? args.file_path : typeof args.path === 'string' ? args.path : undefined)
      : exec.name === 'str_replace_editor' && args.command === 'view' && typeof args.path === 'string' ? args.path : undefined
    if (cfg.guardReads && readPath !== undefined && isSecretFile(readPath)) {
      const rel = resolvePath(readPath, workspace).relative
      return decide(cfg, key, `reading ${rel}`, [{
        detail: `${rel} holds secrets, and reading it sends them to the model`,
        fix: `check ${rel.includes('.env') ? '.env.example' : 'the docs'} for which settings exist, or ask the user about the specific value you need`,
      }], next)
    }

    // Shell commands.
    if (cfg.guardShell && cfg.shellTools.includes(exec.name)) {
      const command = args.command
      if (typeof command !== 'string') return next()
      const extraNames = new Set(cfg.extraSecretNames.map(n => n.toUpperCase()))
      const findings: CommandFinding[] = analyzeCommand(command, {
        dialect: exec.name === 'pwsh' ? 'powershell' : 'posix',
        isSecretFile,
        known: knownFor(workspace, cfg.extraSecretNames),
        extraPatterns: patternsOf(cfg),
        stageable: () => stageablePaths(workspace),
        isSecretVar: n => extraNames.has(n.toUpperCase()) || isSecretName(n),
        disabledRules: cfg.disabledRules,
      })
      return decide(cfg, key, `\`${command.length > 120 ? `${command.slice(0, 117)}...` : command}\``, findings, next)
    }

    // Writing a secret into a file.
    if (cfg.guardWrites) {
      const mutation = fileMutation(exec)
      if (mutation === undefined) return next()
      const secrets = findSecrets(mutation.newText, knownFor(workspace, cfg.extraSecretNames), patternsOf(cfg))
      if (secrets.length === 0) return next()
      const { relative } = resolvePath(mutation.path, workspace)
      const what = secrets.slice(0, 3).map(s => `${s.label} (${mask(s.value)})`).join(', ')
      if (isSecretFile(mutation.path)) {
        const ignored = gitIgnored(relative, workspace)
        if (ignored !== false) return next()
        return decide(cfg, key, `this edit to ${relative}`, [{
          detail: `${relative} would hold ${what}, but git does not ignore it, so it would be committed`,
          fix: `add ${relative} to .gitignore first, then write the secret`,
        }], next)
      }
      const variable = secrets.find(s => s.name !== undefined)?.name ?? 'API_KEY'
      return decide(cfg, key, `this edit to ${relative}`, [{
        detail: `it writes ${what} into ${relative}`,
        fix: `read it from an environment variable such as ${variable} (process.env.${variable}, os.environ["${variable}"]) and keep the value in a git-ignored .env file`,
      }], next)
    }
    return next()
  })

  ctx.on('tools/post-execute', async (exec: ToolExecution, result: Readonly<ToolExecutionResult>, next: () => Promise<PostToolDecision>) => {
    const decision = await next()
    const cfg = resolveConfig(config)
    if (!cfg.redactOutput || decision.kind !== 'accept' || 'value' in decision && decision.value !== undefined) return decision
    const content = decision.content ?? result.content
    const known = knownFor(workspaceOf(exec), cfg.extraSecretNames)
    const patterns = patternsOf(cfg)
    let changed = false
    const redacted = content.map(block => {
      if (block.type !== 'text') return block
      const found = findSecrets(block.text, known, patterns)
      if (found.length === 0) return block
      changed = true
      return { ...block, text: redact(block.text, found) }
    })
    if (!changed) return decision
    return { ...decision, content: redacted }
  })
}
