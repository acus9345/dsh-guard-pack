import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, budgetState, charge, Config, describeSpend, Meter, usd, wasApproved } from '../src/index.ts'
import { resolveConfig } from '../src/shared/live.ts'

test('charge prices usage with llm-tally, overrides and cache reads', () => {
  const pro = charge('deepseek-v4-pro', { inputTokens: 1_000_000, outputTokens: 1_000_000 })
  assert.equal(pro.tokens, 2_000_000)
  assert.ok(Math.abs(pro.usd! - (1.32 + 3.96)) < 1e-9, String(pro.usd))
  // Cache reads inside inputTokens are billed at the cached rate.
  const cached = charge('deepseek-v4-pro', { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 1_000_000, totalTokens: 1_000_000 })
  assert.ok(Math.abs(cached.usd! - 0.044) < 1e-9, String(cached.usd))
  // Reported separately (total only adds up with them): added to the input.
  const separate = charge('my-model', { inputTokens: 100, outputTokens: 50, cacheReadTokens: 1000, totalTokens: 1150 }, { 'my-model': { input: 1, output: 2, cachedInput: 0.1 } })
  assert.equal(separate.tokens, 1150)
  assert.ok(Math.abs(separate.usd! - (100 * 1 + 1000 * 0.1 + 50 * 2) / 1e6) < 1e-12)
  assert.deepEqual(charge('who-knows-v9', { inputTokens: 10, outputTokens: 5 }), { usd: undefined, tokens: 15 })
})

test('Meter rolls subagents up into their parent session', () => {
  const m = new Meter()
  m.record('root', undefined, 'a', { usd: 1, tokens: 100 })
  m.record('child', 'root', 'a', { usd: 0.5, tokens: 50 })
  m.record('grandchild', 'child', 'b', { usd: undefined, tokens: 10 })
  m.record('other', undefined, 'a', { usd: 9, tokens: 900 })
  assert.deepEqual(m.totals('grandchild'), { usd: 1.5, tokens: 160, unpriced: ['b'] })
  assert.equal(m.rootOf('grandchild'), 'root')
  assert.equal(m.totals('other').usd, 9)
})

test('budgetState and describeSpend', () => {
  const totals = { usd: 4.2, tokens: 1_250_000, unpriced: [] }
  const s = budgetState(totals, { maxUsd: 5, maxTokens: 0, extendBy: 0.5 }, 0)
  assert.equal(s.limitUsd, 5)
  assert.ok(Math.abs(s.fraction - 0.84) < 1e-9)
  assert.equal(describeSpend(s), '$4.20 of $5.00 (1.3M tokens)')
  const extended = budgetState(totals, { maxUsd: 5, maxTokens: 2_000_000, extendBy: 0.5 }, 1)
  assert.equal(extended.limitUsd, 7.5)
  assert.equal(extended.limitTokens, 3_000_000)
  assert.equal(usd(0.004213), '$0.00421')
})

test('wasApproved tells approvals from refusals', () => {
  assert.equal(wasApproved({ isError: false, value: null, content: [] } as never), true)
  assert.equal(wasApproved({ isError: true, error: { message: 'exit code 1' }, content: [] } as never), true)
  assert.equal(wasApproved({ isError: true, error: { message: 'the user rejected tool "bash"' }, content: [] } as never), false)
  assert.equal(wasApproved({ isError: true, error: { message: 'tool "bash" requires approval, but no approval channel is available' }, content: [] } as never), false)
})

// A minimal stand-in for DSH: collects listeners and lets the test fire events.
function harness(config: Partial<Record<keyof typeof defaults, unknown>> = {}) {
  const handlers: Record<string, (...args: any[]) => any> = {}
  const warnings: string[] = []
  const ctx = { on: (event: string, fn: (...args: any[]) => any) => { handlers[event] = fn }, logger: { warn: (...a: unknown[]) => warnings.push(a.join(' ')) } }
  const cfg = { ...defaults, ...config }
  apply(ctx as never, cfg as never)
  const agent = (id: string, parent?: string) => ({ session: { header: { id, parentSession: parent } }, options: {} })
  let attempt = 0
  return {
    warnings,
    agent,
    /** One model call by `a` with these token counts. */
    async spend(a: object, model: string, inputTokens: number, outputTokens: number) {
      await handlers['agent/request']!({ agent: a }, async () => ({ provider: 'p', model }))
      const id = `att-${++attempt}`
      handlers['agent/assistant-stream']!({ agent: a, frame: { type: 'chunk', attemptId: id, chunk: { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } } } })
      handlers['agent/assistant-stream']!({ agent: a, frame: { type: 'chunk', attemptId: id, chunk: { type: 'usage', usage: { inputTokens, outputTokens } } } })
      handlers['agent/assistant-stream']!({ agent: a, frame: { type: 'end', attemptId: id, outcome: { kind: 'committed' } } })
    },
    async tool(a: object) {
      const exec = { name: 'bash', arguments: {}, agent: a }
      const decision = await handlers['tools/pre-execute']!(exec, async () => ({ kind: 'allow' }))
      return { exec, decision }
    },
    async after(exec: object, result: object = { isError: false, value: null, content: [{ type: 'text', text: 'ok' }] }) {
      return handlers['tools/post-execute']!(exec, result, async () => ({ kind: 'accept' }))
    },
  }
}
const defaults = { maxUsd: 1, maxTokens: 0, mode: 'deny', extendBy: 0.5, warnAt: 0.8, prices: { m: { input: 1, output: 1 } } }

test('warns once near the cap, then refuses tool calls over it', async () => {
  const h = harness()
  const a = h.agent('s1')
  await h.spend(a, 'm', 500_000, 0) // $0.50
  let { exec, decision } = await h.tool(a)
  assert.equal(decision.kind, 'allow')
  assert.equal((await h.after(exec)).content, undefined, 'no warning at 50%')

  await h.spend(a, 'm', 350_000, 0) // $0.85
  ;({ exec, decision } = await h.tool(a))
  assert.equal(decision.kind, 'allow')
  const warned = await h.after(exec)
  assert.match(warned.content.at(-1).text, /used \$0\.850 of \$1\.00 .*85% of its budget/)
  assert.equal((await h.after((await h.tool(a)).exec)).content, undefined, 'the warning is shown once')

  await h.spend(a, 'm', 200_000, 0) // $1.05
  ;({ decision } = await h.tool(a))
  assert.equal(decision.kind, 'deny')
  assert.match(decision.reason, /reached its cost cap \(\$1\.05 of \$1\.00/)
  assert.match(decision.reason, /Stop here and tell the user/)
})

test('ask mode extends the budget only after an approval', async () => {
  const h = harness({ mode: 'ask' })
  const a = h.agent('s2')
  await h.spend(a, 'm', 1_100_000, 0) // $1.10
  let { exec, decision } = await h.tool(a)
  assert.equal(decision.kind, 'ask')
  assert.match(decision.displayReason.en, /about 50% more/)
  await h.after(exec, { isError: true, error: { message: 'the user rejected tool "bash"' }, content: [] })
  ;({ exec, decision } = await h.tool(a))
  assert.equal(decision.kind, 'ask', 'still over after a rejection')
  await h.after(exec) // approved and ran
  ;({ decision } = await h.tool(a))
  assert.equal(decision.kind, 'allow', 'the cap moved to $1.50')
  await h.spend(a, 'm', 450_000, 0) // $1.55
  ;({ decision } = await h.tool(a))
  assert.equal(decision.kind, 'ask')
})

test('subagent spend counts toward the parent; token caps and unpriced models', async () => {
  const h = harness({ maxUsd: 0, maxTokens: 1000, prices: {} })
  const parent = h.agent('root')
  const child = h.agent('child', 'root')
  await h.spend(child, 'mystery-model', 600, 500)
  assert.equal((await h.tool(parent)).decision.kind, 'deny')
  assert.match(h.warnings[0]!, /no price known for model %s.*mystery-model$/)
  assert.equal((await h.tool(h.agent('unrelated'))).decision.kind, 'allow')
})

test('Config defaults', () => {
  const cfg = resolveConfig(Config({}))
  assert.equal(cfg.maxUsd, 5)
  assert.equal(cfg.mode, 'ask')
  assert.equal(cfg.warnAt, 0.8)
})
