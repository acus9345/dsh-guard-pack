/**
 * dsh-format-after-edit: runs the project's formatter on every file the agent
 * writes or edits, so its changes match the codebase's style without a
 * separate "now run the formatter" step.
 *
 * Runs on `tools/post-execute` after a successful `write`, `edit` or
 * `str_replace_editor` call. The formatter is picked from the project's own
 * setup: Prettier, Biome or dprint config with the tool installed in
 * node_modules; Ruff or Black configured in pyproject.toml; gofmt for Go
 * modules; rustfmt for Cargo crates; clang-format when a .clang-format exists;
 * or commands you configure. Nothing is downloaded.
 *
 * When the formatter changes the file, the model is told to re-read it before
 * editing again. When the formatter fails (often a syntax error in the edit),
 * the model sees the formatter's message.
 *
 * @module dsh-format-after-edit
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { PostToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { FORMATTERS, planFor, runPlan, type CustomFormatter, type FormatterId, type Outcome } from './formatters.ts'
import { fileMutation, resolvePath, workspaceOf } from './shared/files.ts'
import { matchesAny } from './shared/glob.ts'
import { resolveConfig } from './shared/live.ts'

export { FORMATTERS, lineDiff, onPath, planFor, runPlan } from './formatters.ts'
export type { CustomFormatter, FormatterId, Outcome, Plan } from './formatters.ts'

export const name = 'format-after-edit'

export const DEFAULT_IGNORE: readonly string[] = [
  '**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/out/**', '**/vendor/**', '**/target/**',
  '**/.venv/**', '**/*.min.*', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', '*.lock',
]

/** Plugin configuration. */
export interface Config {
  /** Built-in formatters allowed to run. */
  formatters: FormatterId[]
  /** Your own formatters, checked first: `{ files: ['*.php'], command: 'vendor/bin/pint {file}' }`. */
  custom: CustomFormatter[]
  /** Workspace-relative globs never to format. */
  ignore: string[]
  /** Tools whose edits trigger formatting. */
  tools: string[]
  /** Kill a formatter that runs longer than this. */
  timeoutMs: number
  /** Tell the model when the formatter changed the file. */
  reportChanges: boolean
  /** Tell the model when the formatter failed, with its message. */
  reportErrors: boolean
}

export const Config: Schema<Config> = Schema.object({
  formatters: Schema.array(Schema.union([...FORMATTERS])).default([...FORMATTERS]).volatile(),
  custom: Schema.array(Schema.object({
    files: Schema.array(Schema.string()).required(),
    command: Schema.string().required(),
  })).default([]).volatile(),
  ignore: Schema.array(Schema.string()).default([...DEFAULT_IGNORE]).volatile(),
  tools: Schema.array(Schema.string()).default(['write', 'edit', 'str_replace_editor']).volatile(),
  timeoutMs: Schema.natural().min(1000).default(20_000).volatile(),
  reportChanges: Schema.boolean().default(true).volatile(),
  reportErrors: Schema.boolean().default(true).volatile(),
}) as unknown as Schema<Config>

/** Model-facing note about one formatter run, or undefined when there is nothing to say. */
export function noteFor(rel: string, outcome: Outcome, cfg: Pick<Config, 'reportChanges' | 'reportErrors'>): string | undefined {
  if (outcome.status === 'changed' && cfg.reportChanges) {
    return `[dsh-format-after-edit] ${outcome.formatter} reformatted ${rel} (${outcome.linesChanged} ${outcome.linesChanged === 1 ? 'line' : 'lines'} changed). `
      + 'Re-read the file before editing it again, since text you saw earlier may have moved or changed.'
  }
  if (outcome.status === 'failed' && cfg.reportErrors) {
    const output = outcome.output.split(/\r?\n/).slice(0, 15).join('\n')
    return `[dsh-format-after-edit] ${outcome.formatter} could not format ${rel}. Your edit was saved, but this often means it has a syntax error:\n${output}`
  }
  return undefined
}

export function apply(ctx: Context, config: Config): void {
  ctx.on('tools/post-execute', async (exec: ToolExecution, result: Readonly<ToolExecutionResult>, next: () => Promise<PostToolDecision>) => {
    const decision = await next()
    const cfg = resolveConfig(config)
    if (result.isError || decision.kind !== 'accept' || !cfg.tools.includes(exec.name)) return decision
    if ('value' in decision && decision.value !== undefined) return decision
    const mutation = fileMutation(exec)
    if (mutation === undefined) return decision
    const workspace = workspaceOf(exec)
    const { absolute, relative: rel } = resolvePath(mutation.path, workspace)
    if (rel.startsWith('../') || matchesAny(rel, cfg.ignore)) return decision

    let outcome: Outcome
    try {
      const plan = planFor(absolute, workspace, cfg.formatters, cfg.custom, matchesAny)
      if (plan === undefined) return decision
      outcome = await runPlan(plan, absolute, cfg.timeoutMs)
    } catch (error) {
      ctx.logger.warn('dsh-format-after-edit: formatting %s failed: %o', rel, error)
      return decision
    }
    const note = noteFor(rel, outcome, cfg)
    if (note === undefined) return decision
    return { ...decision, content: [...(decision.content ?? result.content), { type: 'text', text: `

${note}` }] }
  })
}
