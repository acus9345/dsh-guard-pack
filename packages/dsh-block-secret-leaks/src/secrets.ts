/**
 * Secret detection: well-known token formats, plus the actual secret values
 * found in the environment and the workspace's env files.
 */
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** One kind of credential recognised by its format. */
export interface TokenPattern {
  id: string
  label: string
  pattern: RegExp
}

/** High-confidence credential formats. Each needs a distinctive prefix, so ordinary code rarely matches. */
export const TOKEN_PATTERNS: readonly TokenPattern[] = [
  { id: 'private-key', label: 'a private key', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/g },
  { id: 'aws-access-key', label: 'an AWS access key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'github-token', label: 'a GitHub token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g },
  { id: 'gitlab-token', label: 'a GitLab token', pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'anthropic-key', label: 'an Anthropic API key', pattern: /\bsk-ant-[a-z]+\d{2}-[A-Za-z0-9_-]{80,}/g },
  { id: 'openai-key', label: 'an OpenAI-style API key (sk-...)', pattern: /\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}\b/g },
  { id: 'google-api-key', label: 'a Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'google-oauth-secret', label: 'a Google OAuth client secret', pattern: /\bGOCSPX-[A-Za-z0-9_-]{28}\b/g },
  { id: 'slack-token', label: 'a Slack token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'slack-webhook', label: 'a Slack webhook URL', pattern: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{20,}/g },
  { id: 'stripe-key', label: 'a live Stripe key', pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g },
  { id: 'npm-token', label: 'an npm token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { id: 'pypi-token', label: 'a PyPI token', pattern: /\bpypi-AgE[A-Za-z0-9_-]{50,}/g },
  { id: 'huggingface-token', label: 'a Hugging Face token', pattern: /\bhf_[A-Za-z0-9]{34,}\b/g },
  { id: 'sendgrid-key', label: 'a SendGrid key', pattern: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g },
  { id: 'digitalocean-token', label: 'a DigitalOcean token', pattern: /\bdo[opr]_v1_[a-f0-9]{64}\b/g },
]

/** A secret found in text. */
export interface SecretMatch {
  /** Pattern id, or `env` for a known value. */
  kind: string
  /** Human description, e.g. `the value of OPENAI_API_KEY`. */
  label: string
  /** Variable name, for known values. */
  name?: string
  /** The matched secret text. */
  value: string
}

/** Default rule for which environment variable names hold secrets. URLs count: only their password is ever taken. */
export const SECRET_NAME = /(?:^|_)(?:API_?KEY|KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS|PWD|CREDENTIALS?|AUTH|PRIVATE|DSN|SESSION|COOKIE|SIGNING|URL|URI|CONNECTION(?:_STRING)?)(?:_|$)|(?:KEY|TOKEN|SECRET|PASSWORD)$/i
const NOT_SECRET_NAME = /^(?:PWD|OLDPWD|SSH_AUTH_SOCK|GPG_AGENT_INFO|XAUTHORITY|.*_(?:PATH|DIR|FILE|SOCK|HOST|PORT|USER|USERNAME|REGION|ENABLED|MODE|LEVEL|ID_FILE))$|AUTHOR/i

/** Does this variable name look like it holds a secret? */
export function isSecretName(name: string): boolean {
  return SECRET_NAME.test(name) && !NOT_SECRET_NAME.test(name)
}

/** Shannon entropy in bits per character. */
export function entropy(s: string): number {
  const counts = new Map<string, number>()
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  let h = 0
  for (const n of counts.values()) {
    const p = n / s.length
    h -= p * Math.log2(p)
  }
  return h
}

/** Placeholder-looking values: docs examples, `xxxx`, `your-key-here`, low-entropy strings. */
export function isPlaceholder(value: string): boolean {
  if (/example|xxxx|your[_-]?(?:api[_-]?)?(?:key|token|secret)|dummy|fake|placeholder|redacted|changeme|\*{3}|<[^>]*>|\$\{|\{\{/i.test(value)) return true
  return entropy(value) < 3
}

/**
 * Extract the secret part of an env value. URLs with a password contribute
 * only the password; values that are paths, numbers or booleans contribute nothing.
 */
export function secretPart(value: string): string | undefined {
  const v = value.trim()
  if (v.length < 8) {
    return undefined
  }
  if (/^(?:true|false|yes|no|on|off|null|undefined|\d+(?:\.\d+)?)$/i.test(v)) return undefined
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) {
    try {
      const url = new URL(v)
      const password = decodeURIComponent(url.password)
      return password.length >= 6 && !isPlaceholder(password) ? password : undefined
    } catch {
      return undefined
    }
  }
  if (/^(?:[a-z]:)?[\\/]|^~[\\/]|^\.\.?[\\/]/i.test(v)) return undefined
  return isPlaceholder(v) ? undefined : v
}

/** A known secret value and where it came from. */
export interface KnownSecret {
  name: string
  value: string
  source: string
}

/** Parse KEY=value lines of a dotenv file. */
export function parseDotenv(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(line)
    if (m === null) continue
    let value = m[2]!.trim()
    const quote = value[0]
    if ((quote === '"' || quote === "'" || quote === '`') && value.length >= 2) {
      const end = value.indexOf(quote, 1)
      value = end === -1 ? value.slice(1) : value.slice(1, end)
    } else {
      value = value.replace(/\s+#.*$/, '')
    }
    out.push([m[1]!, value])
  }
  return out
}

const ENV_FILES = ['.env', '.env.local', '.env.development', '.env.development.local', '.env.production', '.env.production.local', '.env.test', '.env.test.local', '.dev.vars']

/**
 * Collect secret values from environment variables with secret-looking names
 * and from the workspace's env files (not `.env.example`).
 * @param env - usually `process.env`.
 * @param workspace - folder whose env files are read; undefined skips files.
 * @param isSecret - name test; defaults to {@link isSecretName}.
 */
export function collectKnownSecrets(
  env: Readonly<Record<string, string | undefined>>,
  workspace: string | undefined,
  isSecret: (name: string) => boolean = isSecretName,
): KnownSecret[] {
  const out = new Map<string, KnownSecret>()
  const add = (name: string, raw: string, source: string): void => {
    if (!isSecret(name)) return
    const value = secretPart(raw)
    if (value !== undefined && !out.has(value)) out.set(value, { name, value, source })
  }
  for (const [name, value] of Object.entries(env)) if (value !== undefined) add(name, value, 'environment')
  if (workspace !== undefined) {
    for (const file of ENV_FILES) {
      const path = join(workspace, file)
      try {
        if (statSync(path).size > 256_000) continue
        for (const [name, value] of parseDotenv(readFileSync(path, 'utf8'))) add(name, value, file)
      } catch {
        // Missing or unreadable env files simply contribute nothing.
      }
    }
  }
  // Longest first, so a secret that contains another is reported (and redacted) whole.
  return [...out.values()].sort((a, b) => b.value.length - a.value.length)
}

/**
 * Find secrets in text: known values first, then well-known token formats.
 * @param text - text to search.
 * @param known - secret values from {@link collectKnownSecrets}.
 * @param extra - additional patterns from the config.
 */
export function findSecrets(text: string, known: readonly KnownSecret[], extra: readonly TokenPattern[] = []): SecretMatch[] {
  const out: SecretMatch[] = []
  const seen = new Set<string>()
  for (const k of known) {
    if (text.includes(k.value) && !seen.has(k.value)) {
      seen.add(k.value)
      out.push({ kind: 'env', label: `the value of ${k.name} (from ${k.source})`, name: k.name, value: k.value })
    }
  }
  for (const p of [...TOKEN_PATTERNS, ...extra]) {
    for (const m of text.matchAll(new RegExp(p.pattern.source, p.pattern.flags.includes('g') ? p.pattern.flags : `${p.pattern.flags}g`))) {
      const value = m[0]
      if (seen.has(value) || [...seen].some(s => s.includes(value))) continue
      if (p.id !== 'private-key' && isPlaceholder(value)) continue
      seen.add(value)
      out.push({ kind: p.id, label: p.label, value })
    }
  }
  return out
}

/** Replace every secret in text with `[REDACTED: <label>]`. */
export function redact(text: string, matches: readonly SecretMatch[]): string {
  let out = text
  for (const m of [...matches].sort((a, b) => b.value.length - a.value.length)) {
    const tag = m.name ?? m.kind
    if (m.kind === 'private-key') {
      // Redact the whole key block, not just its header line.
      out = out.replace(/-----BEGIN ([A-Z ]*)PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END \1PRIVATE KEY(?: BLOCK)?-----|$)/g, `[REDACTED: ${tag}]`)
      continue
    }
    out = out.split(m.value).join(`[REDACTED: ${tag}]`)
  }
  return out
}

/** `sk-pro…4f2a` style preview that is safe to show. */
export function mask(value: string): string {
  if (value.length <= 8) return '****'
  return `${value.slice(0, 4)}…${value.slice(-2)}`
}
