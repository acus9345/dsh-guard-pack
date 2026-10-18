import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectKnownSecrets, findSecrets, isPlaceholder, isSecretName, parseDotenv, redact, secretPart } from '../src/secrets.ts'

// Built at runtime so secret scanners (and GitHub push protection) don't mistake this file for a leak.
const fake = (prefix: string, length: number): string => prefix + 'aZ3kQ9mX7pL2vB8nR4tY6wC1dF5gH0jK'.repeat(4).slice(0, length)
const BEGIN = (kind: string): string => `-----BEGIN ${kind}PRIVATE ${'KEY'}-----`
const END = (kind: string): string => `-----END ${kind}PRIVATE ${'KEY'}-----`

test('recognises well-known token formats', () => {
  const samples = {
    'openai-key': fake('sk-proj-', 48),
    'anthropic-key': fake('sk-ant-api03-', 95),
    'github-token': fake('ghp_', 36),
    'aws-access-key': ['AKIA', 'Z3KQ9MX7PL2VB8NR'].join(''),
    'google-api-key': fake('AIza', 35),
    'slack-token': fake('xoxb-', 30),
    'npm-token': fake('npm_', 36),
    'huggingface-token': fake('hf_', 34),
  }
  for (const [kind, value] of Object.entries(samples)) {
    const found = findSecrets(`const key = "${value}"`, [])
    assert.equal(found[0]?.kind, kind, `${kind}: ${JSON.stringify(found)}`)
    assert.equal(found[0]?.value, value)
  }
  assert.equal(findSecrets(`${BEGIN('OPENSSH ')}\nabc\n${END('OPENSSH ')}`, [])[0]?.kind, 'private-key')
})

test('ignores placeholders, docs examples and ordinary code', () => {
  for (const text of [
    `AWS_ACCESS_KEY_ID=${['AKIA', 'IOSFODNN7', 'EXAMPLE'].join('')}`,
    `OPENAI_API_KEY=${['sk', 'your-api-key-here-xxxxxxxxxxxxxxxx'].join('-')}`,
    `token = "${'ghp_' + 'a'.repeat(36)}"`,
    'const skip = items.filter(x => x.sk)',
    'the task-runner sk-something is fine',
  ]) {
    assert.deepEqual(findSecrets(text, []), [], text)
  }
  assert.ok(isPlaceholder('changeme123'))
  assert.ok(!isPlaceholder('q8Zr2LmX0pT7vKe4'))
})

test('knows which variable names hold secrets', () => {
  for (const n of ['OPENAI_API_KEY', 'GITHUB_TOKEN', 'DB_PASSWORD', 'STRIPE_SECRET', 'SENTRY_DSN', 'AUTH_SECRET', 'apiKey'.toUpperCase(), 'DATABASE_URL', 'MONGODB_URI']) assert.ok(isSecretName(n), n)
  for (const n of ['PWD', 'OLDPWD', 'PATH', 'SSH_AUTH_SOCK', 'GIT_AUTHOR_NAME', 'NODE_ENV', 'KEYCHAIN_PATH', 'TOKEN_FILE']) assert.ok(!isSecretName(n), n)
})

test('takes only the password from connection URLs and skips non-secrets', () => {
  assert.equal(secretPart('postgres://app:s3cr3t-Pa55@db:5432/app'), 's3cr3t-Pa55')
  assert.equal(secretPart('postgres://localhost:5432/app'), undefined)
  assert.equal(secretPart('/home/me/.ssh/id_rsa'), undefined)
  assert.equal(secretPart('true'), undefined)
  assert.equal(secretPart('short'), undefined)
})

test('collects real secret values from the environment and .env files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-secrets-'))
  try {
    writeFileSync(join(dir, '.env'), 'export STRIPE_KEY="rk_test_9fLq2Zx8Kd0Pw"\nDEBUG=true\n# comment\nPUBLIC_URL=https://example.com\n')
    writeFileSync(join(dir, '.env.example'), 'EXAMPLE_TOKEN=Zq9Lm2Xp8Kd0WvR4\n')
    const known = collectKnownSecrets({ MY_API_TOKEN: 'Tq7Pz3Lm9Xk2Wd5R', HOME: '/home/me', NODE_ENV: 'production', DATABASE_URL: 'postgres://app:Hx8Kq2Lm9Zp4@db/app', SITE_URL: 'https://example.com' }, dir)
    assert.deepEqual(known.map(k => [k.name, k.value, k.source]).sort(), [['DATABASE_URL', 'Hx8Kq2Lm9Zp4', 'environment'], ['MY_API_TOKEN', 'Tq7Pz3Lm9Xk2Wd5R', 'environment'], ['STRIPE_KEY', 'rk_test_9fLq2Zx8Kd0Pw', '.env']])
    const found = findSecrets('curl -H "x: Tq7Pz3Lm9Xk2Wd5R"', known)
    assert.equal(found[0]?.name, 'MY_API_TOKEN')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('parseDotenv handles quotes, export and comments', () => {
  assert.deepEqual(parseDotenv('A=1\nexport B="two words" # c\nC=\'x#y\'\nD=plain # note\n#E=no'), [['A', '1'], ['B', 'two words'], ['C', 'x#y'], ['D', 'plain']])
})

test('redact replaces values and whole private key blocks', () => {
  const key = fake('ghp_', 36)
  const text = `token ${key}\n${BEGIN('RSA ')}\nMIIabc\n${END('RSA ')}\ndone`
  const out = redact(text, findSecrets(text, []))
  assert.equal(out, 'token [REDACTED: github-token]\n[REDACTED: private-key]\ndone')
  const known = [{ name: 'DB_PASSWORD', value: 'Zq9Lm2Xp8Kd0', source: '.env' }]
  assert.equal(redact('pw=Zq9Lm2Xp8Kd0', findSecrets('pw=Zq9Lm2Xp8Kd0', known)), 'pw=[REDACTED: DB_PASSWORD]')
})
