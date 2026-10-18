#!/usr/bin/env node
// Add (or remove) every plugin in the guard pack to a DSH profile.
//
//   node scripts/install.mjs                     # all nine, web profile
//   node scripts/install.mjs --profile headless --profile web
//   node scripts/install.mjs --only secret,cost  # names or parts of names
//   node scripts/install.mjs --remove
//   node scripts/install.mjs --dry-run
import { spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'

export const PLUGINS = [
  { name: 'dsh-block-secret-leaks', what: 'keeps API keys and passwords out of the conversation and out of git' },
  { name: 'dsh-session-cost-cap', what: 'caps what one session may spend on model calls' },
  { name: 'dsh-format-after-edit', what: "runs the project's formatter on every edited file" },
  { name: 'dsh-protect-tests', what: 'blocks edits that weaken tests' },
  { name: 'dsh-block-placeholder-edits', what: 'blocks "// ... existing code ..." edits' },
  { name: 'dsh-protect-generated-files', what: 'stops hand-edits to lockfiles and generated code' },
  { name: 'dsh-enforce-package-manager', what: 'stops npm in a pnpm repo, pip in a uv project, and so on' },
  { name: 'dsh-block-hanging-commands', what: 'stops commands that wait for input or never exit' },
  { name: 'dsh-load-agent-rules', what: 'loads Cursor, Copilot, Windsurf and other rule files' },
]

const { values } = parseArgs({
  options: {
    profile: { type: 'string', multiple: true },
    only: { type: 'string' },
    remove: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
})

if (values.help) {
  console.log(`Usage: node scripts/install.mjs [--profile web] [--only names] [--remove] [--dry-run]

Profiles: web (dsh web, the default), headless (scripts and CI), acp (editor integrations).
Repeat --profile to install into several.

Plugins:
${PLUGINS.map(p => `  ${p.name.padEnd(30)} ${p.what}`).join('\n')}`)
  process.exit(0)
}

const profiles = values.profile ?? ['web']
const wanted = values.only?.split(',').map(s => s.trim()).filter(Boolean)
const chosen = wanted ? PLUGINS.filter(p => wanted.some(w => p.name.includes(w))) : PLUGINS
if (chosen.length === 0) {
  console.error(`No plugin matches --only ${values.only}. Run with --help to see the names.`)
  process.exit(2)
}

const action = values.remove ? 'remove' : 'add'
const isWindows = process.platform === 'win32'
if (!values['dry-run']) {
  const probe = spawnSync('dsh', ['--version'], { shell: isWindows, encoding: 'utf8' })
  if (probe.status !== 0) {
    console.error('Could not run `dsh`. Install DeepSeek Harness first and make sure `dsh` is on your PATH.')
    process.exit(1)
  }
}

let failed = 0
for (const profile of profiles) {
  for (const plugin of chosen) {
    const args = ['plugin', '--profile', profile, action, plugin.name]
    console.log(`${values['dry-run'] ? '[dry run] ' : ''}dsh ${args.join(' ')}`)
    if (values['dry-run']) continue
    const result = spawnSync('dsh', args, { stdio: 'inherit', shell: isWindows })
    if (result.status !== 0) {
      failed++
      console.error(`  failed (exit code ${result.status})`)
    }
  }
}
if (failed > 0) {
  console.error(`\n${failed} command${failed === 1 ? '' : 's'} failed. See the output above.`)
  process.exit(1)
}
if (!values['dry-run']) console.log(`\nDone. ${action === 'add' ? 'Added' : 'Removed'} ${chosen.length} plugin${chosen.length === 1 ? '' : 's'} ${action === 'add' ? 'to' : 'from'} ${profiles.join(', ')}.`)
