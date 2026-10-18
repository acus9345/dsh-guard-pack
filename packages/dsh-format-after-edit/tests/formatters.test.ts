import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, lineDiff, noteFor, planFor, runPlan } from '../src/index.ts'
import { matchesAny } from '../src/shared/glob.ts'

const ALL = ['prettier', 'biome', 'dprint', 'ruff', 'black', 'gofmt', 'rustfmt', 'clang-format']

// A stand-in for Prettier: collapses runs of spaces and makes quotes double, or fails on "SYNTAX ERROR".
const FAKE_PRETTIER = `const fs = require('node:fs')
const file = process.argv.at(-1)
const text = fs.readFileSync(file, 'utf8')
if (text.includes('SYNTAX ERROR')) { console.error('[error] ' + file + ': SyntaxError: Unexpected token (1:5)'); process.exit(2) }
fs.writeFileSync(file, text.replace(/ {2,}/g, ' ').replace(/'/g, '"'))
`

function workspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-format-'))
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true })
    writeFileSync(join(dir, rel), content)
  }
  return dir
}

test('picks Prettier only when the project configures and installs it', () => {
  const ws = workspace({ 'package.json': '{"prettier":{}}', 'node_modules/prettier/bin/prettier.cjs': FAKE_PRETTIER, 'src/a.ts': '' })
  const bare = workspace({ 'src/a.ts': '', 'node_modules/prettier/bin/prettier.cjs': FAKE_PRETTIER })
  const notInstalled = workspace({ '.prettierrc': '{}', 'src/a.ts': '' })
  try {
    assert.equal(planFor(join(ws, 'src/a.ts'), ws, ALL)?.formatter, 'prettier')
    assert.equal(planFor(join(ws, 'src/a.ts'), ws, ALL.filter(f => f !== 'prettier')), undefined)
    assert.equal(planFor(join(ws, 'src/a.py'), ws, ALL), undefined)
    assert.equal(planFor(join(bare, 'src/a.ts'), bare, ALL), undefined, 'no config, no formatting')
    assert.equal(planFor(join(notInstalled, 'src/a.ts'), notInstalled, ALL), undefined, 'never downloads')
  } finally {
    for (const d of [ws, bare, notInstalled]) rmSync(d, { recursive: true, force: true })
  }
})

test('the closest config wins: Biome in a sub-package over Prettier at the root', () => {
  const ws = workspace({
    '.prettierrc': '{}',
    'node_modules/prettier/bin/prettier.cjs': FAKE_PRETTIER,
    'node_modules/@biomejs/biome/bin/biome': '',
    'packages/app/biome.json': '{}',
    'packages/app/src/x.ts': '',
  })
  try {
    assert.equal(planFor(join(ws, 'packages/app/src/x.ts'), ws, ALL)?.formatter, 'biome')
    assert.equal(planFor(join(ws, 'x.ts'), ws, ALL)?.formatter, 'prettier')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('custom formatters come first and get the file path', () => {
  const ws = workspace({ 'a.php': '' })
  try {
    const plan = planFor(join(ws, 'a.php'), ws, ALL, [{ files: ['*.php'], command: 'php-cs-fixer fix {file} --quiet' }], matchesAny)
    assert.equal(plan?.formatter, 'custom')
    assert.match(plan!.shell!, /^php-cs-fixer fix ["'].*a\.php["'] --quiet$/)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('runPlan reports changed, unchanged and failed runs', async () => {
  const ws = workspace({ '.prettierrc': '{}', 'node_modules/prettier/bin/prettier.cjs': FAKE_PRETTIER, 'a.ts': "const a  =  'x'\nconst b = 1\n", 'b.ts': 'const b = 1\n', 'c.ts': 'SYNTAX ERROR' })
  try {
    const changed = await runPlan(planFor(join(ws, 'a.ts'), ws, ALL)!, join(ws, 'a.ts'), 10_000)
    assert.deepEqual(changed, { formatter: 'prettier', status: 'changed', linesChanged: 1, output: '' })
    assert.equal(readFileSync(join(ws, 'a.ts'), 'utf8'), 'const a = "x"\nconst b = 1\n')
    assert.equal((await runPlan(planFor(join(ws, 'b.ts'), ws, ALL)!, join(ws, 'b.ts'), 10_000)).status, 'unchanged')
    const failed = await runPlan(planFor(join(ws, 'c.ts'), ws, ALL)!, join(ws, 'c.ts'), 10_000)
    assert.equal(failed.status, 'failed')
    assert.match(failed.output, /SyntaxError: Unexpected token/)
    const custom = await runPlan({ formatter: 'custom', file: '', args: [], shell: `node -e "process.exit(3)"`, cwd: ws }, join(ws, 'b.ts'), 10_000)
    assert.equal(custom.status, 'failed')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('notes for the model', () => {
  assert.match(noteFor('src/a.ts', { formatter: 'prettier', status: 'changed', linesChanged: 3, output: '' }, { reportChanges: true, reportErrors: true })!, /prettier reformatted src\/a\.ts \(3 lines changed\)\. Re-read the file/)
  assert.equal(noteFor('a', { formatter: 'prettier', status: 'unchanged', linesChanged: 0, output: '' }, { reportChanges: true, reportErrors: true }), undefined)
  assert.equal(noteFor('a', { formatter: 'ruff', status: 'failed', linesChanged: 0, output: 'boom' }, { reportChanges: true, reportErrors: false }), undefined)
  assert.equal(lineDiff('a\nb\nc', 'a\nB\nc\nd'), 2)
})

test('post-execute formats the edited file and appends a note', async () => {
  const ws = workspace({ '.prettierrc': '{}', 'node_modules/prettier/bin/prettier.cjs': FAKE_PRETTIER, 'src/a.ts': "let x  = 'y'\n" })
  try {
    let listener: ((...a: any[]) => Promise<any>) | undefined
    const ctx = { on: (_e: string, fn: typeof listener) => { listener = fn }, logger: { warn() {} } }
    apply(ctx as never, { formatters: ALL, custom: [], ignore: ['**/node_modules/**'], tools: ['write', 'edit'], timeoutMs: 10_000, reportChanges: true, reportErrors: true } as never)
    const exec = { name: 'edit', arguments: { file_path: 'src/a.ts', old_string: 'x', new_string: 'x' }, agent: { session: { header: { cwd: ws } } } }
    const ok = { isError: false, value: null, content: [{ type: 'text', text: 'Edited src/a.ts' }] }
    const decision = await listener!(exec, ok, async () => ({ kind: 'accept' }))
    assert.equal(decision.content[0].text, 'Edited src/a.ts')
    assert.match(decision.content[1].text, /^\n\n\[dsh-format-after-edit\] prettier reformatted src\/a\.ts/)
    assert.equal(readFileSync(join(ws, 'src/a.ts'), 'utf8'), 'let x = "y"\n')
    const failed = await listener!(exec, { isError: true, error: { message: 'no' }, content: [] }, async () => ({ kind: 'accept' }))
    assert.equal(failed.content, undefined, 'failed edits are left alone')
    const read = await listener!({ ...exec, name: 'read' }, ok, async () => ({ kind: 'accept' }))
    assert.equal(read.content, undefined, 'other tools are left alone')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})
