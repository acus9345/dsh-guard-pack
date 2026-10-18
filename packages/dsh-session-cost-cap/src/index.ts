/**
 * dsh-session-cost-cap: caps what one session may spend on model calls.
 *
 * Usage comes from the token counts the model adapter reports for every
 * attempt (`agent/assistant-stream`), priced with the model the request used
 * (`agent/request`) and llm-tally's price table, or prices you set. Subagent
 * sessions count toward the session that started them.
 *
 * As the cap nears, the model is told how much budget is left. Once it is
 * reached, tool calls are refused (`deny`) or need your approval (`ask`); an
 * approval extends the budget by `extendBy` before the next prompt.
 *
 * @module dsh-session-cost-cap
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { Agent, AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import type { LlmCallConfig, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { PostToolDecision, PreToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { charge, Meter, tokens, usd, type Price, type Totals } from './meter.ts'
import { resolveConfig } from './shared/live.ts'

export { charge, Meter, tokens, usd } from './meter.ts'
export type { Charge, Price, Totals, UsageLike } from './meter.ts'

export const name = 'session-cost-cap'

/** Plugin configuration. */
export interface Config {
  /** Most a session (with its subagents) may spend, in US dollars. 0 turns the dollar cap off. */
  maxUsd: number
  /** Most input + output tokens a session may use. 0 turns the token cap off. */
  maxTokens: number
  /** At the cap: `ask` shows an approval prompt for each tool call, `deny` refuses them. */
  mode: 'ask' | 'deny'
  /** After you approve a call over the cap, how much more (as a fraction of the cap) may be spent before the next prompt. */
  extendBy: number
  /** Tell the model when this fraction of the budget is used. 0 turns the warning off. */
  warnAt: number
  /** Prices for models llm-tally doesn't know, in USD per 1M tokens: `{ "my-model": { input: 1, output: 4 } }`. */
  prices: Record<string, Price>
}

const PriceSchema = Schema.object({
  input: Schema.number().min(0).required(),
  output: Schema.number().min(0).required(),
  cachedInput: Schema.number().min(0),
})

export const Config: Schema<Config> = Schema.object({
  maxUsd: Schema.number().min(0).default(5).volatile(),
  maxTokens: Schema.natural().default(0).volatile(),
  mode: Schema.union(['ask', 'deny']).default('ask').volatile(),
  extendBy: Schema.number().min(0.05).default(0.5).volatile(),
  warnAt: Schema.number().min(0).max(1).default(0.8).volatile(),
  prices: Schema.dict(PriceSchema).default({}).volatile(),
}) as unknown as Schema<Config>

/** How far a session is through its budget. */
export interface BudgetState {
  totals: Totals
  /** Current dollar limit (cap plus approved extensions), or undefined when off. */
  limitUsd: number | undefined
  /** Current token limit, or undefined when off. */
  limitTokens: number | undefined
  /** Largest used fraction across the active limits. */
  fraction: number
}

/**
 * Work out a session's budget position.
 * @param totals - spend so far.
 * @param cfg - plugin config.
 * @param extensions - how many over-cap calls the user has approved.
 */
export function budgetState(totals: Totals, cfg: Pick<Config, 'maxUsd' | 'maxTokens' | 'extendBy'>, extensions: number): BudgetState {
  const scale = 1 + extensions * cfg.extendBy
  const limitUsd = cfg.maxUsd > 0 ? cfg.maxUsd * scale : undefined
  const limitTokens = cfg.maxTokens > 0 ? Math.round(cfg.maxTokens * scale) : undefined
  const fraction = Math.max(limitUsd ? totals.usd / limitUsd : 0, limitTokens ? totals.tokens / limitTokens : 0)
  return { totals, limitUsd, limitTokens, fraction }
}

/** One-line spend summary, e.g. `$5.12 of $5.00 (1.2M tokens)`. */
export function describeSpend(state: BudgetState): string {
  const parts: string[] = []
  if (state.limitUsd !== undefined) parts.push(`${usd(state.totals.usd)} of ${usd(state.limitUsd)}`)
  if (state.limitTokens !== undefined) parts.push(`${tokens(state.totals.tokens)} of ${tokens(state.limitTokens)} tokens`)
  else parts.push(`${tokens(state.totals.tokens)} tokens`)
  let text = parts.length > 1 ? `${parts[0]} (${parts.slice(1).join(', ')})` : parts[0]!
  if (state.totals.unpriced.length > 0) text += `; no price known for ${state.totals.unpriced.join(', ')}, so those calls count only as tokens`
  return text
}

/** Model-facing reason once the cap is reached. */
export function capText(state: BudgetState, mode: Config['mode']): string {
  return `dsh-session-cost-cap: this session has reached its cost cap (${describeSpend(state)}). `
    + (mode === 'deny'
      ? 'No more tool calls will run. Stop here and tell the user what you finished, what is left, and that they can raise the cap in the dsh-session-cost-cap settings or continue in a new session.'
      : 'The user was asked to approve this call. If they decline, stop and tell them what you finished and what is left.')
}

/** Whether a call that needed approval actually ran, rather than being rejected, cancelled or refused. */
export function wasApproved(result: Readonly<ToolExecutionResult>): boolean {
  if (!result.isError) return true
  return !/^(?:the user rejected tool|approval for tool|tool "[^"]*" requires approval|dsh-session-cost-cap)/.test(result.error.message)
}

export function apply(ctx: Context, config: Config): void {
  const meter = new Meter()
  const models = new WeakMap<Agent, { provider: string; model: string }>()
  const attempts = new Map<string, { agent: Agent; usage: TokenUsage }>()
  const extensions = new Map<string, number>()
  const warned = new Map<string, number>()
  const asked = new WeakSet<ToolExecution>()
  const loggedUnpriced = new Set<string>()

  const sessionOf = (agent: Agent): { id: string; parent: string | undefined } => {
    const header = agent.session.header
    return { id: String(header.id), parent: header.parentSession === undefined ? undefined : String(header.parentSession) }
  }
  const stateOf = (agent: Agent, cfg: Config): BudgetState => {
    const { id, parent } = sessionOf(agent)
    meter.link(id, parent)
    return budgetState(meter.totals(id), cfg, extensions.get(meter.rootOf(id)) ?? 0)
  }

  // Remember which model each request uses, so its usage can be priced.
  ctx.on('agent/request', async ({ agent }: { agent: Agent }, next: () => Promise<LlmCallConfig>) => {
    const call = await next()
    models.set(agent, { provider: call.provider, model: call.model })
    return call
  })

  ctx.on('agent/assistant-stream', ({ agent, frame }: { agent: Agent; frame: AssistantStreamFrame }) => {
    const key = `${String(frame.attemptId)}`
    if (frame.type === 'chunk' && frame.chunk.type === 'usage') {
      // The latest usage chunk of an attempt carries its totals.
      attempts.set(key, { agent, usage: frame.chunk.usage })
    } else if (frame.type === 'end') {
      const attempt = attempts.get(key)
      attempts.delete(key)
      if (attempt === undefined) return
      const cfg = resolveConfig(config)
      const model = models.get(attempt.agent)?.model ?? attempt.agent.options.model ?? 'unknown'
      const { id, parent } = sessionOf(attempt.agent)
      const cost = charge(model, attempt.usage, cfg.prices)
      if (cost.usd === undefined && !loggedUnpriced.has(model)) {
        loggedUnpriced.add(model)
        ctx.logger.warn('dsh-session-cost-cap: no price known for model %s; add it under "prices" to count its cost. Its tokens still count.', model)
      }
      meter.record(id, parent, model, cost)
    }
  })

  ctx.on('tools/pre-execute', async (exec: ToolExecution, next: () => Promise<PreToolDecision>) => {
    if (exec.agent === undefined) return next()
    const cfg = resolveConfig(config)
    const state = stateOf(exec.agent, cfg)
    if (state.fraction < 1) return next()
    const text = capText(state, cfg.mode)
    if (cfg.mode === 'deny') return { kind: 'deny', reason: text }
    asked.add(exec)
    return {
      kind: 'ask',
      reason: text,
      displayReason: { en: `This session has reached its cost cap: ${describeSpend(state)}. Approving lets it spend about ${Math.round(cfg.extendBy * 100)}% more before asking again.` },
    }
  })

  ctx.on('tools/post-execute', async (exec: ToolExecution, result: Readonly<ToolExecutionResult>, next: () => Promise<PostToolDecision>) => {
    const decision = await next()
    if (exec.agent === undefined) return decision
    const cfg = resolveConfig(config)
    const root = meter.rootOf(sessionOf(exec.agent).id)
    // A call we asked about either ran (approved: move the line) or came back as a denial.
    if (asked.has(exec)) {
      asked.delete(exec)
      if (wasApproved(result)) extensions.set(root, (extensions.get(root) ?? 0) + 1)
      return decision
    }
    if (cfg.warnAt <= 0 || decision.kind !== 'accept' || 'value' in decision && decision.value !== undefined) return decision
    const state = stateOf(exec.agent, cfg)
    const level = extensions.get(root) ?? 0
    if (state.fraction < cfg.warnAt || state.fraction >= 1 || warned.get(root) === level) return decision
    warned.set(root, level)
    const note = `[dsh-session-cost-cap] This session has used ${describeSpend(state)}, ${Math.round(state.fraction * 100)}% of its budget. `
      + 'Finish the task efficiently: skip optional exploration, avoid re-reading large files, and batch small edits.'
    return { ...decision, content: [...(decision.content ?? result.content), { type: 'text', text: `

${note}` }] }
  })
}
