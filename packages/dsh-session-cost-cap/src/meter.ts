/**
 * Spend accounting: prices token usage and adds it up per session, rolling
 * subagent sessions up into the session that started them.
 */
import { costFromUsage, findModel } from 'llm-tally'

/** USD per 1M tokens. */
export interface Price {
  input: number
  output: number
  /** Price of input tokens read from the prompt cache. Defaults to `input`. */
  cachedInput?: number
}

/** Token counts as DSH reports them. */
export interface UsageLike {
  inputTokens: number
  outputTokens: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/** What one priced call cost. */
export interface Charge {
  usd: number | undefined
  tokens: number
}

/**
 * Price one model call.
 * @param model - model id the call used.
 * @param usage - token counts from the adapter.
 * @param overrides - prices you set, by model id; checked before the built-in table.
 * @returns dollars (undefined when the model has no known price) and total tokens.
 */
export function charge(model: string, usage: UsageLike, overrides: Readonly<Record<string, Price>> = {}): Charge {
  const cached = Math.max(0, usage.cacheReadTokens ?? 0)
  let input = Math.max(0, usage.inputTokens)
  const output = Math.max(0, usage.outputTokens)
  // Some providers count cache reads inside inputTokens, others report them separately.
  // A total that only adds up with the cache reads included means they were separate.
  if (cached > 0 && usage.totalTokens !== undefined && usage.totalTokens >= input + output + cached) input += cached
  const tokens = input + output
  const override = overrides[model] ?? Object.entries(overrides).find(([id]) => id.toLowerCase() === model.toLowerCase())?.[1]
  if (override !== undefined) {
    const hit = Math.min(cached, input)
    const usd = ((input - hit) * override.input + hit * (override.cachedInput ?? override.input) + output * override.output) / 1_000_000
    return { usd, tokens }
  }
  const known = findModel(model)
  if (known === undefined) return { usd: undefined, tokens }
  const usd = costFromUsage({ model: known.id, inputTokens: input, outputTokens: output, cachedInputTokens: Math.min(cached, input) }).totalCost
  return { usd, tokens }
}

interface SessionSpend {
  parent: string | undefined
  usd: number
  tokens: number
  unpriced: Set<string>
}

/** Totals for a session and everything it started. */
export interface Totals {
  usd: number
  tokens: number
  /** Models used without a known price; their tokens count but their dollars don't. */
  unpriced: string[]
}

/** Running spend per session. */
export class Meter {
  readonly #sessions = new Map<string, SessionSpend>()

  #entry(id: string, parent?: string): SessionSpend {
    let entry = this.#sessions.get(id)
    if (entry === undefined) {
      entry = { parent, usd: 0, tokens: 0, unpriced: new Set() }
      this.#sessions.set(id, entry)
    } else if (parent !== undefined && entry.parent === undefined && parent !== id) {
      entry.parent = parent
    }
    return entry
  }

  /** Note a session's parent before any spend arrives. */
  link(id: string, parent: string | undefined): void {
    this.#entry(id, parent)
  }

  /** Add one call's cost to a session. */
  record(id: string, parent: string | undefined, model: string, c: Charge): void {
    const entry = this.#entry(id, parent)
    entry.tokens += c.tokens
    if (c.usd === undefined) entry.unpriced.add(model)
    else entry.usd += c.usd
  }

  /** The top-level session a session belongs to. */
  rootOf(id: string): string {
    let current = id
    const seen = new Set<string>()
    for (;;) {
      const parent = this.#sessions.get(current)?.parent
      if (parent === undefined || seen.has(parent)) return current
      seen.add(current)
      current = parent
    }
  }

  /** Spend of the top-level session `id` belongs to, including all its subagents. */
  totals(id: string): Totals {
    const root = this.rootOf(id)
    let usd = 0
    let tokens = 0
    const unpriced = new Set<string>()
    for (const [sid, s] of this.#sessions) {
      if (this.rootOf(sid) !== root) continue
      usd += s.usd
      tokens += s.tokens
      for (const m of s.unpriced) unpriced.add(m)
    }
    return { usd, tokens, unpriced: [...unpriced] }
  }

  /** Forget a session tree. */
  forget(id: string): void {
    const root = this.rootOf(id)
    for (const sid of [...this.#sessions.keys()]) if (this.rootOf(sid) === root) this.#sessions.delete(sid)
  }
}

/** `$0.0123`-style formatting: cents from $1 up, three significant digits below. */
export function usd(amount: number): string {
  if (!Number.isFinite(amount)) return '$?'
  if (amount === 0) return '$0.00'
  if (Math.abs(amount) >= 1) return `$${amount.toFixed(2)}`
  const rounded = Number(amount.toPrecision(3))
  const digits = Math.min(20, 2 - Math.floor(Math.log10(Math.abs(rounded))))
  return `$${rounded.toFixed(digits)}`
}

/** `1.2M`, `45.3k`, `812` */
export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return String(n)
}
