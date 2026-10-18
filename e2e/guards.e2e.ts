import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lastRequestText, pluginEntry, runDsh, shellTool } from './helpers/dsh.ts'

// A made-up key, built at runtime so this file doesn't look like it holds one.
const KEY = ['sk', 'proj', 'Zq9Lm2Xp8Kd0WvR4Tq7Pz3Lm9Xk2Wd5RbN6c'].join('-')
const env = `OPENAI_API_KEY=${KEY}\nDEBUG=true\n`

test('dsh-block-secret-leaks: refuses to read or print .env, redacts what slips through', async () => {
  const run = await runDsh({
    plugins: [{ id: 'block-secret-leaks', entry: pluginEntry('dsh-block-secret-leaks') }],
    files: { '.env': env, '.gitignore': '.env\n' },
    readAfter: ['src/config.ts'],
    script: [
      { tool: 'read', input: { file_path: '.env' } },
      { tool: 'bash', input: { description: 'Show env', command: 'cat .env' } },
      { tool: 'write', input: { file_path: 'src/config.ts', content: `export const key = "${KEY}"\n` } },
      { tool: 'bash', input: { description: 'Print file', command: `node -e "console.log(require('fs').readFileSync('.env','utf8'))"` } },
      { tool: 'bash', input: { description: 'Hello', command: 'echo hello' } },
    ],
  })
  assert.equal(run.exitCode, 0, run.stderr)
  const [read, cat, write, node, echo] = run.toolResults
  assert.match(read!.result, /dsh-block-secret-leaks stopped reading \.env/)
  assert.match(cat!.result, /prints \.env, which holds secrets/)
  assert.match(write!.result, /writes the value of OPENAI_API_KEY \(from (?:\.env|environment)\)/)
  assert.equal(run.filesAfter['src/config.ts'], undefined)
  assert.equal(node!.status, 'completed')
  assert.match(node!.result, /OPENAI_API_KEY=\[REDACTED: OPENAI_API_KEY\]/)
  assert.match(echo!.result, /hello/)
  for (const r of run.toolResults) assert.doesNotMatch(r.result, new RegExp(KEY))
  // The scripted model typed the key into its own write call; no tool result sent it back.
  const last = JSON.parse(lastRequestText(run)) as { messages: Array<{ content: unknown }> }
  const toolResults = last.messages.flatMap(m => (Array.isArray(m.content) ? m.content : []) as Array<{ type: string }>).filter(b => b.type === 'tool_result')
  assert.equal(toolResults.length, 5)
  assert.doesNotMatch(JSON.stringify(toolResults), new RegExp(KEY), 'no tool result carries the key to the model')
})

test('dsh-session-cost-cap: refuses tool calls once the session is over its cap', async () => {
  const run = await runDsh({
    // The scripted model reports 15 tokens per call, so the third call starts over a 20-token cap.
    plugins: [{ id: 'session-cost-cap', entry: pluginEntry('dsh-session-cost-cap'), config: { maxUsd: 0, maxTokens: 20, mode: 'deny', warnAt: 0.5 } }],
    script: [
      { tool: 'bash', input: { description: 'One', command: 'echo one' } },
      { tool: 'bash', input: { description: 'Two', command: 'echo two' } },
      { tool: 'bash', input: { description: 'Three', command: 'echo three' } },
    ],
  })
  assert.equal(run.exitCode, 0, run.stderr)
  const [one, two, three] = run.toolResults
  assert.equal(one!.status, 'completed')
  assert.match(one!.result, /\[dsh-session-cost-cap\] This session has used 15 of 20 tokens, 75% of its budget/)
  assert.match(two!.result, /reached its cost cap \(30 of 20 tokens\)/)
  assert.match(three!.result, /reached its cost cap \(45 of 20 tokens\)/)
})

test('dsh-format-after-edit: formats the file the agent wrote and tells it so', async () => {
  const fakePrettier = "const fs = require('node:fs'); const f = process.argv.at(-1); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/ {2,}/g, ' ').replace(/'/g, '\"'))\n"
  const run = await runDsh({
    plugins: [{ id: 'format-after-edit', entry: pluginEntry('dsh-format-after-edit') }],
    files: { '.prettierrc': '{}', 'node_modules/prettier/bin/prettier.cjs': fakePrettier },
    readAfter: ['src/a.ts'],
    script: [{ tool: 'write', input: { file_path: 'src/a.ts', content: "let x  =  'y'\n" } }],
  })
  assert.equal(run.exitCode, 0, run.stderr)
  assert.equal(run.filesAfter['src/a.ts'], 'let x = "y"\n')
  assert.match(run.toolResults[0]!.result, /prettier reformatted src\/a\.ts \(1 line changed\)\. Re-read the file/)
})

test('installs with `dsh plugin add`', async () => {
  const run = await runDsh({
    installed: 'dsh-block-secret-leaks',
    files: { '.env': env },
    script: [{ tool: 'bash', input: { description: 'Show env', command: 'cat .env' } }],
  })
  assert.equal(run.exitCode, 0, run.stderr)
  assert.match(run.toolResults[0]!.result, /dsh-block-secret-leaks stopped/)
  assert.ok(shellTool === 'bash' || shellTool === 'pwsh')
})
