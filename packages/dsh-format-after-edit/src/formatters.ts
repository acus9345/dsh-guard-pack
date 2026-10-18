/**
 * Formatter detection and execution. A formatter runs only when the project
 * is set up for it (a config file, or the language's standard tool) and the
 * tool is installed locally or on PATH; nothing is ever downloaded.
 */
import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'

export const FORMATTERS = ['prettier', 'biome', 'dprint', 'ruff', 'black', 'gofmt', 'rustfmt', 'clang-format'] as const
export type FormatterId = typeof FORMATTERS[number]

/** A command to run for one file. */
export interface Plan {
  /** Formatter id, or `custom`. */
  formatter: FormatterId | 'custom'
  /** Executable and arguments; for `custom`, `shell` holds the whole command line. */
  file: string
  args: string[]
  shell?: string
  cwd: string
}

/** A user-defined formatter: files it applies to and the command, with `{file}` for the path. */
export interface CustomFormatter {
  files: string[]
  command: string
}

const WEB = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts', '.json', '.jsonc', '.json5', '.css', '.scss', '.less', '.md', '.mdx', '.markdown', '.yaml', '.yml', '.html', '.htm', '.vue', '.svelte', '.astro', '.graphql', '.gql', '.hbs', '.handlebars'])
const BIOME = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts', '.json', '.jsonc', '.css', '.graphql', '.gql', '.vue', '.svelte', '.astro', '.html'])
const PYTHON = new Set(['.py', '.pyi'])
const C_LIKE = new Set(['.c', '.cc', '.cpp', '.cxx', '.c++', '.h', '.hh', '.hpp', '.hxx', '.m', '.mm', '.proto', '.cu', '.cuh'])

const PRETTIER_CONFIGS = ['.prettierrc', '.prettierrc.json', '.prettierrc.json5', '.prettierrc.yaml', '.prettierrc.yml', '.prettierrc.toml', '.prettierrc.js', '.prettierrc.cjs', '.prettierrc.mjs', '.prettierrc.ts', '.prettierrc.cts', '.prettierrc.mts', 'prettier.config.js', 'prettier.config.cjs', 'prettier.config.mjs', 'prettier.config.ts', 'prettier.config.cts', 'prettier.config.mts']

/** Folders from the file's folder up to (and including) the workspace root. */
function ancestors(absFile: string, root: string): string[] {
  const out: string[] = []
  const top = resolve(root)
  const inside = (dir: string): boolean => dir === top || dir.startsWith(top.endsWith(sep) ? top : top + sep)
  for (let dir = dirname(absFile); inside(dir); dir = dirname(dir)) {
    out.push(dir)
    if (dir === top || dirname(dir) === dir) break
  }
  return out
}

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

/** A Node package's entry script, searched in node_modules from `dir` up to the workspace root. */
function nodeBin(dirs: readonly string[], pkg: string, candidates: readonly string[]): string | undefined {
  for (const dir of dirs) {
    for (const c of candidates) {
      const path = join(dir, 'node_modules', pkg, c)
      if (existsSync(path)) return path
    }
  }
  return undefined
}

/** A Python tool from the project's virtualenv, if it has one. */
function venvBin(dirs: readonly string[], tool: string): string | undefined {
  for (const dir of dirs) {
    for (const venv of ['.venv', 'venv', 'env']) {
      for (const rel of process.platform === 'win32' ? [`Scripts/${tool}.exe`] : [`bin/${tool}`]) {
        const path = join(dir, venv, rel)
        if (existsSync(path)) return path
      }
    }
  }
  return undefined
}

/** Is an executable on PATH? */
export function onPath(name: string): boolean {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const dir of (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')) {
    if (dir === '') continue
    for (const ext of exts) if (existsSync(join(dir, name + ext))) return true
  }
  return false
}

/**
 * Decide which formatter, if any, should run on a file.
 * @param absFile - absolute path of the edited file.
 * @param root - workspace root.
 * @param enabled - formatter ids allowed to run.
 * @param custom - user-defined formatters, checked first.
 * @param matches - glob test for custom entries (workspace-relative path).
 */
export function planFor(
  absFile: string,
  root: string,
  enabled: readonly string[],
  custom: readonly CustomFormatter[] = [],
  matches: (rel: string, globs: readonly string[]) => boolean = () => false,
): Plan | undefined {
  const rel = relative(root, absFile).split(sep).join('/')
  for (const c of custom) {
    if (matches(rel, c.files)) {
      const quoted = process.platform === 'win32' ? `"${absFile}"` : `'${absFile.replace(/'/g, `'\\''`)}'`
      return { formatter: 'custom', file: '', args: [], shell: c.command.includes('{file}') ? c.command.replaceAll('{file}', quoted) : `${c.command} ${quoted}`, cwd: root }
    }
  }
  const ext = extname(absFile).toLowerCase()
  const dirs = ancestors(absFile, root)
  const on = (id: FormatterId) => enabled.includes(id)

  if (WEB.has(ext)) {
    for (const dir of dirs) {
      if (on('biome') && BIOME.has(ext) && (existsSync(join(dir, 'biome.json')) || existsSync(join(dir, 'biome.jsonc')))) {
        const bin = nodeBin(dirs, '@biomejs/biome', ['bin/biome'])
        if (bin !== undefined) return { formatter: 'biome', file: process.execPath, args: [bin, 'format', '--write', '--files-ignore-unknown=true', '--no-errors-on-unmatched', absFile], cwd: dir }
      }
      if (on('dprint') && ['dprint.json', '.dprint.json', 'dprint.jsonc', '.dprint.jsonc'].some(f => existsSync(join(dir, f)))) {
        const bin = nodeBin(dirs, 'dprint', ['bin.js'])
        if (bin !== undefined) return { formatter: 'dprint', file: process.execPath, args: [bin, 'fmt', '--allow-no-files', absFile], cwd: dir }
      }
      const pkg = existsSync(join(dir, 'package.json')) ? readJson(join(dir, 'package.json')) : undefined
      if (on('prettier') && (PRETTIER_CONFIGS.some(f => existsSync(join(dir, f))) || pkg?.prettier !== undefined)) {
        const bin = nodeBin(dirs, 'prettier', ['bin/prettier.cjs', 'bin-prettier.js'])
        if (bin !== undefined) return { formatter: 'prettier', file: process.execPath, args: [bin, '--write', '--ignore-unknown', absFile], cwd: dir }
      }
    }
    return undefined
  }

  if (PYTHON.has(ext)) {
    for (const dir of dirs) {
      const pyproject = readText(join(dir, 'pyproject.toml'))
      const ruffConfig = existsSync(join(dir, 'ruff.toml')) || existsSync(join(dir, '.ruff.toml')) || /^\[tool\.ruff(?:\.format)?\]/m.test(pyproject)
      if (on('ruff') && ruffConfig) {
        const bin = venvBin(dirs, 'ruff') ?? (onPath('ruff') ? 'ruff' : undefined)
        if (bin !== undefined) return { formatter: 'ruff', file: bin, args: ['format', '--quiet', absFile], cwd: dir }
      }
      if (on('black') && /^\[tool\.black\]/m.test(pyproject)) {
        const bin = venvBin(dirs, 'black') ?? (onPath('black') ? 'black' : undefined)
        if (bin !== undefined) return { formatter: 'black', file: bin, args: ['--quiet', absFile], cwd: dir }
      }
    }
    return undefined
  }

  if (ext === '.go' && on('gofmt') && dirs.some(d => existsSync(join(d, 'go.mod'))) && onPath('gofmt')) {
    return { formatter: 'gofmt', file: 'gofmt', args: ['-w', absFile], cwd: dirname(absFile) }
  }

  if (ext === '.rs' && on('rustfmt')) {
    const crate = dirs.find(d => existsSync(join(d, 'Cargo.toml')))
    if (crate !== undefined && onPath('rustfmt')) {
      const edition = /^\s*edition\s*=\s*"(\d{4})"/m.exec(readText(join(crate, 'Cargo.toml')))?.[1] ?? '2021'
      return { formatter: 'rustfmt', file: 'rustfmt', args: ['--edition', edition, absFile], cwd: crate }
    }
    return undefined
  }

  if (C_LIKE.has(ext) && on('clang-format')) {
    const configured = dirs.find(d => existsSync(join(d, '.clang-format')) || existsSync(join(d, '_clang-format')))
    if (configured !== undefined && onPath('clang-format')) return { formatter: 'clang-format', file: 'clang-format', args: ['-i', absFile], cwd: configured }
  }
  return undefined
}

/** What happened when a formatter ran. */
export interface Outcome {
  formatter: Plan['formatter']
  /** `changed`, `unchanged`, or `failed` (non-zero exit, timeout, or the tool couldn't start). */
  status: 'changed' | 'unchanged' | 'failed'
  /** Lines that differ between before and after, for `changed`. */
  linesChanged: number
  /** Tool output, for `failed`. */
  output: string
}

/**
 * Run a plan and compare the file before and after.
 * @param plan - from {@link planFor}.
 * @param absFile - the file being formatted.
 * @param timeoutMs - kill the formatter after this long.
 */
export async function runPlan(plan: Plan, absFile: string, timeoutMs: number): Promise<Outcome> {
  const before = await readFile(absFile, 'utf8').catch(() => undefined)
  const result = await new Promise<{ code: number | null; output: string }>(done => {
    const finish = (code: number | null, output: string): void => done({ code, output: output.trim() })
    if (plan.shell !== undefined) {
      const child = spawn(plan.shell, { cwd: plan.cwd, shell: true, windowsHide: true, timeout: timeoutMs })
      let output = ''
      child.stdout.on('data', (d: Buffer) => { output += d.toString() })
      child.stderr.on('data', (d: Buffer) => { output += d.toString() })
      child.on('error', e => finish(-1, e.message))
      child.on('close', code => finish(code, output))
      return
    }
    execFile(plan.file, plan.args, { cwd: plan.cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error === null) return finish(0, `${stdout}${stderr}`)
      const code = typeof error.code === 'number' ? error.code : -1
      finish(code, `${stdout}${stderr}`.trim() || (error.killed ? `timed out after ${timeoutMs} ms` : error.message))
    })
  })
  const after = await readFile(absFile, 'utf8').catch(() => undefined)
  if (result.code !== 0) return { formatter: plan.formatter, status: 'failed', linesChanged: 0, output: result.output }
  if (before === after || after === undefined) return { formatter: plan.formatter, status: 'unchanged', linesChanged: 0, output: '' }
  return { formatter: plan.formatter, status: 'changed', linesChanged: lineDiff(before ?? '', after), output: '' }
}

/** Number of lines added or removed between two texts (multiset difference). */
export function lineDiff(a: string, b: string): number {
  const counts = new Map<string, number>()
  for (const line of a.split(/\r?\n/)) counts.set(line, (counts.get(line) ?? 0) + 1)
  let added = 0
  for (const line of b.split(/\r?\n/)) {
    const n = counts.get(line) ?? 0
    if (n > 0) counts.set(line, n - 1)
    else added++
  }
  let removed = 0
  for (const n of counts.values()) removed += n
  return Math.max(added, removed)
}
