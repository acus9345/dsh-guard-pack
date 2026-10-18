/**
 * Shell command analysis: commands that would print, copy, upload or commit
 * secrets, or that carry a secret value literally.
 */
import { splitCommands, type ShellDialect, type SimpleCommand } from './shared/shell.ts'
import { findSecrets, isSecretName, mask, type KnownSecret, type TokenPattern } from './secrets.ts'

export const COMMAND_RULES = ['read-secret-file', 'copy-secret-file', 'upload-secret-file', 'dump-env', 'echo-secret-var', 'git-add-secret', 'literal-secret'] as const
export type CommandRule = typeof COMMAND_RULES[number]

/** One reason a command was stopped. */
export interface CommandFinding {
  rule: CommandRule
  /** What the command would do, e.g. "prints .env". */
  detail: string
  /** What to do instead. */
  fix: string
}

export interface AnalyzeOptions {
  dialect: ShellDialect
  /** Is this path (as written in the command) a secret file? */
  isSecretFile: (path: string) => boolean
  /** Secret values to look for literally in the command. */
  known: readonly KnownSecret[]
  /** Extra token patterns. */
  extraPatterns?: readonly TokenPattern[]
  /** Paths `git add -A` would stage (changed or untracked, not ignored). Called lazily. */
  stageable?: () => string[]
  /** Variable-name test; defaults to the built-in secret-name rule. */
  isSecretVar?: (name: string) => boolean
  disabledRules?: readonly CommandRule[]
}

const READERS = new Set([
  'cat', 'less', 'more', 'head', 'tail', 'bat', 'batcat', 'nl', 'tac', 'type', 'gc', 'get-content', 'select-string', 'sls',
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'awk', 'gawk', 'sed', 'cut', 'sort', 'uniq', 'strings', 'xxd', 'od', 'hexdump',
  'base64', 'openssl', 'jq', 'yq', 'diff', 'format-hex', 'fhx', 'more.com', 'findstr',
])
const COPIERS = new Set(['cp', 'copy', 'copy-item', 'cpi', 'mv', 'move', 'move-item', 'mi', 'rsync', 'scp', 'install', 'xcopy', 'robocopy'])
const UPLOADERS = new Set(['curl', 'wget', 'http', 'https', 'xh', 'invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm'])
const PRINTERS = new Set(['echo', 'printf', 'print', 'write-output', 'write-host', 'write-information', 'echo.exe', 'say'])
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'pwsh', 'powershell', 'pwsh.exe', 'powershell.exe', 'cmd', 'cmd.exe'])
/** A reader piped into one of these only sees variable names. */
const VALUE_STRIPPERS = [/\bcut\s+(?:-d\s*['"]?=['"]?\s+-f\s*['"]?1\b|-f\s*['"]?1['"]?\s+-d\s*['"]?=)/, /\bsed\s+-?E?\s*['"]s\/=\.\*\/\/['"]/, /-replace\s+['"]=\.\*['"]/, /\.Split\(\s*['"]=['"]\s*\)\[0\]/, /-split\s+['"]=['"]\s*\)\[0\]/, /\bawk\s+-F\s*['"]?=['"]?\s+['"]\{\s*print\s+\$1\s*\}['"]/]

const lower = (s: string): string => s.toLowerCase().replace(/^.*[\\/]/, '')

/**
 * Analyze a command line.
 * @param command - raw command text.
 * @param options - dialect, secret-file test, known secrets.
 * @returns findings; empty when the command is fine.
 */
export function analyzeCommand(command: string, options: AnalyzeOptions): CommandFinding[] {
  const disabled = new Set(options.disabledRules ?? [])
  const isSecretVar = options.isSecretVar ?? isSecretName
  const findings: CommandFinding[] = []
  const add = (f: CommandFinding): void => {
    if (!disabled.has(f.rule) && !findings.some(x => x.rule === f.rule && x.detail === f.detail)) findings.push(f)
  }

  const literal = findSecrets(command, options.known, options.extraPatterns)
  for (const s of literal) {
    add({
      rule: 'literal-secret',
      detail: `contains ${s.label} (${mask(s.value)}) written out in full`,
      fix: s.name !== undefined
        ? `refer to it as ${options.dialect === 'powershell' ? `$env:${s.name}` : `"$${s.name}"`} so the value stays out of the conversation`
        : 'read it from an environment variable instead of writing the value into the command',
    })
  }

  const visit = (cmd: SimpleCommand, dialect: ShellDialect): void => {
    const [first, ...args] = cmd.argv
    if (first === undefined) return
    const name = lower(first)

    // Nested shells: `bash -c "..."`, `pwsh -Command "..."`.
    if (SHELLS.has(name)) {
      const flag = args.findIndex(a => /^(?:-c|-command|\/c|-commandwithargs)$/i.test(a))
      if (flag >= 0 && args[flag + 1] !== undefined) {
        const nested = name.startsWith('pwsh') || name.startsWith('powershell') ? 'powershell' : 'posix'
        for (const inner of splitCommands(args.slice(flag + 1).join(' '), nested)) visit(inner, nested)
      }
      return
    }

    const secretArgs = args.filter(a => !a.startsWith('-') && options.isSecretFile(stripRef(a)))
    const inputSecrets = cmd.redirects.filter(r => (r.op === '<' || r.op === '<&') && options.isSecretFile(r.target)).map(r => r.target)

    if (READERS.has(name) || name === 'git' && args[0] === 'show' || inputSecrets.length > 0) {
      const files = [...secretArgs, ...inputSecrets, ...(name === 'git' ? args.filter(a => /^[^-][^:]*:.+/.test(a) && options.isSecretFile(a.split(':').slice(1).join(':'))) : [])]
      const quiet = args.some(a => /^(?:-q|--quiet|--silent|-c|--count|-l|--files-with-matches|-L|--files-without-match)$/.test(a))
      const inPlace = name === 'sed' && args.some(a => /^-i/.test(a) || a === '--in-place')
      const namesOnly = name === 'cut' && /-f\s*['"]?1\b|-f1\b/.test(cmd.text) && /-d\s*['"]?=|-d=/.test(cmd.text)
      const stripped = cmd.stdoutPiped && VALUE_STRIPPERS.some(re => re.test(command))
      if (files.length > 0 && !quiet && !inPlace && !namesOnly && !stripped) {
        add({
          rule: 'read-secret-file',
          detail: `prints ${files.join(', ')}, which holds secrets`,
          fix: `to see which variables exist without their values, run \`${dialect === 'powershell' ? `(Get-Content ${files[0]}) -replace '=.*', '='` : `cut -d= -f1 ${files[0]}`}\`, or ask the user about the value you need`,
        })
      }
    }

    if (COPIERS.has(name) && secretArgs.length > 0) {
      const positional = args.filter(a => !a.startsWith('-'))
      const dest = positional.at(-1)
      const remote = dest !== undefined && /^[^/\\]*[^/\\:]:/.test(dest) && !/^[a-z]:[\\/]/i.test(dest)
      const sources = positional.slice(0, -1).filter(a => options.isSecretFile(stripRef(a)))
      if (dest !== undefined && sources.length > 0 && (remote || !options.isSecretFile(dest))) {
        add({
          rule: remote ? 'upload-secret-file' : 'copy-secret-file',
          detail: remote ? `sends ${sources.join(', ')} to ${dest}` : `copies ${sources.join(', ')} to ${dest}, which is not treated as a secret file`,
          fix: dest.toLowerCase().includes('example')
            ? `write ${dest} by hand with the variable names and placeholder values, never the real ones`
            : 'keep secrets in git-ignored env files; ask the user if a secret has to go somewhere else',
        })
      }
    }

    if (UPLOADERS.has(name)) {
      const uploads: string[] = []
      for (let i = 0; i < args.length; i++) {
        const a = args[i]!
        // `-d @.env`, `--data-binary @.env`, `-F file=@.env`
        const at = /^(?:[^=@]*=)?@([^;&|\s]+)$/.exec(a)
        if (at !== null && options.isSecretFile(at[1]!)) uploads.push(at[1]!)
        // `-T .env`, `--upload-file .env`, `-InFile .env`
        const next = args[i + 1]
        if (/^(?:-T|--upload-file|-infile|--post-file|--body-file)$/i.test(a) && next !== undefined && options.isSecretFile(next)) uploads.push(next)
      }
      if (uploads.length > 0) {
        add({ rule: 'upload-secret-file', detail: `uploads ${uploads.join(', ')}`, fix: 'never send env files over the network; ask the user if a request needs a credential' })
      }
    }

    // Environment dumps.
    const dumpsAll =
      (name === 'env' || name === 'printenv') && args.every(a => a.startsWith('-')) ||
      name === 'set' && args.length === 0 && dialect === 'posix' ||
      name === 'export' && (args.length === 0 || args.every(a => a === '-p')) ||
      name === 'declare' && args.length > 0 && args.every(a => /^-[a-z]*[xp][a-z]*$/.test(a)) ||
      ['get-childitem', 'gci', 'ls', 'dir', 'get-item', 'gi'].includes(name) && args.some(a => /^env:\\?\*?$/i.test(a)) ||
      /\[(?:system\.)?environment\]::getenvironmentvariables\(/i.test(cmd.text)
    if (dumpsAll) {
      add({
        rule: 'dump-env',
        detail: 'prints every environment variable, including secrets',
        fix: dialect === 'powershell'
          ? 'print only what you need, like `$env:NODE_ENV`, or list names with `Get-ChildItem env: | Select-Object Name`'
          : 'print only what you need, like `printenv NODE_ENV`, or list names with `env | cut -d= -f1`',
      })
    }
    if (name === 'printenv' && args.some(a => !a.startsWith('-') && isSecretVar(a))) {
      const vars = args.filter(a => isSecretVar(a))
      add({ rule: 'echo-secret-var', detail: `prints ${vars.join(', ')}`, fix: `check that it is set without printing it: \`[ -n "$${vars[0]}" ] && echo set\`` })
    }

    // Printing secret variables.
    const printed = PRINTERS.has(name) || /^\$env:/i.test(first)
    if (printed) {
      const vars = secretVars(cmd.text, isSecretVar)
      if (vars.length > 0) {
        add({
          rule: 'echo-secret-var',
          detail: `prints ${vars.join(', ')}`,
          fix: dialect === 'powershell'
            ? `check that it is set without printing it: \`[bool]$env:${vars[0]}\``
            : `check that it is set without printing it: \`[ -n "$${vars[0]}" ] && echo set\``,
        })
      }
    }

    // Committing secrets.
    if (name === 'git' && (args[0] === 'add' || args[0] === 'commit' || args[0] === 'stage')) {
      const rest = args.slice(1)
      const forced = rest.includes('-f') || rest.includes('--force')
      const explicit = rest.filter(a => !a.startsWith('-') && options.isSecretFile(a))
      const all =
        (args[0] === 'add' || args[0] === 'stage') && rest.some(a => a === '-A' || a === '--all' || a === '.' || a === ':/' || a === '*' || a === '-u' || a === '--update') ||
        args[0] === 'commit' && rest.some(a => /^-[a-zA-Z]*a[a-zA-Z]*$/.test(a) || a === '--all')
      const staged = all && options.stageable ? options.stageable().filter(p => options.isSecretFile(p)) : []
      const hits = [...new Set([...explicit, ...staged])]
      if (hits.length > 0) {
        add({
          rule: 'git-add-secret',
          detail: `would commit ${hits.join(', ')}${forced ? ' (forced past .gitignore)' : ''}`,
          fix: `add ${hits.join(', ')} to .gitignore and stage the other files by name`,
        })
      }
    }
  }

  // `[Environment]::GetEnvironmentVariable("X")` prints X in PowerShell; the splitter breaks it at the parentheses.
  const getters = [...command.matchAll(/\[(?:system\.)?environment\]::getenvironmentvariable\s*\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/gi)].map(m => m[1]!).filter(isSecretVar)
  if (getters.length > 0) {
    add({ rule: 'echo-secret-var', detail: `prints ${getters.join(', ')}`, fix: `check that it is set without printing it: \`[bool]$env:${getters[0]}\`` })
  }

  for (const cmd of splitCommands(command, options.dialect)) visit(cmd, options.dialect)
  return findings
}

/** `git show HEAD:.env` style refs and `@file` arguments reduce to the path. */
function stripRef(arg: string): string {
  return arg.replace(/^@/, '')
}

/** Secret-looking variables referenced in a command: `$NAME`, `${NAME}`, `$env:NAME`, `%NAME%`, `GetEnvironmentVariable('NAME')`. */
export function secretVars(text: string, isSecretVar: (name: string) => boolean): string[] {
  const names = new Set<string>()
  for (const m of text.matchAll(/\$\{?(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}?|%([A-Za-z_][A-Za-z0-9_]*)%|GetEnvironmentVariable\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/gi)) {
    const n = m[1] ?? m[2] ?? m[3]
    if (n !== undefined && isSecretVar(n)) names.add(n)
  }
  return [...names]
}
