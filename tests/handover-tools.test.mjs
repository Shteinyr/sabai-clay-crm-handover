import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seal, unseal, safeStoragePath, checksums } from '../scripts/handover/archive.mjs'
import { prepareRestore } from '../scripts/handover/prepareRestore.mjs'
import { exportConfig, jsonReadQuery } from '../scripts/handover/exportConfig.mjs'

test('authenticated archive roundtrip, wrong password, tamper and overwrite protection', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sabai-archive-'))
  try {
    const input = join(dir, 'source'); const archive = join(dir, 'sealed'); const out = join(dir, 'out')
    await writeFile(input, 'private bytes\n')
    await seal(input, archive, 'long-random-password')
    await unseal(archive, out, 'long-random-password')
    assert.deepEqual(await readFile(out), await readFile(input))
    await assert.rejects(unseal(archive, out, 'wrong'))
    assert.equal(await readFile(out, 'utf8'), 'private bytes\n')
    const failed = join(dir, 'failed')
    await assert.rejects(unseal(archive, failed, 'wrong'))
    await assert.rejects(access(failed))
    const bytes = await readFile(archive); bytes[40] ^= 1; await writeFile(archive, bytes)
    await assert.rejects(unseal(archive, failed, 'long-random-password'))
    await assert.rejects(access(failed))
    assert.ok((await checksums(dir)).every((row) => /^[a-f0-9]{64}$/.test(row.sha256)))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('Storage paths cannot escape archive directory', () => {
  assert.equal(safeStoragePath('/tmp/storage', 'deal-photos', 'appointments/a/b.jpg'), '/tmp/storage/deal-photos/appointments/a/b.jpg')
  for (const path of ['../secret', '/absolute', 'a/../../secret', 'a\\..\\secret', 'a//b']) assert.throws(() => safeStoragePath('/tmp/storage', 'bucket', path))
  assert.throws(() => safeStoragePath('/tmp/storage', '../bucket', 'a'))
})

test('project-only export needs no personal token and validates source boundaries without printing secrets', () => {
  const ref = 'abcdefghijklmnopqrst'
  const key = (claims) => `eyJtest.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.test`
  const env = { HANDOVER_PROJECT_REF: ref, HANDOVER_DATABASE_URL: `postgresql://postgres.${ref}:do-not-print@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`, HANDOVER_SOURCE_SERVICE_KEY: key({ role: 'service_role', ref }) }
  const config = exportConfig(env)
  assert.equal(config.token, undefined)
  assert.equal(exportConfig({ ...env, SUPABASE_ACCESS_TOKEN: 'personal-token-not-used' }).token, undefined)
  assert.equal(config.ref, ref)
  for (const invalid of [
    { HANDOVER_SOURCE_SERVICE_KEY: 'sbp_not-a-project-key' },
    { HANDOVER_SOURCE_SERVICE_KEY: key({ role: 'anon', ref }) },
    { HANDOVER_SOURCE_SERVICE_KEY: key({ role: 'service_role', ref: 'another-project' }) },
    { HANDOVER_DATABASE_URL: env.HANDOVER_DATABASE_URL.replace(':5432/', ':6543/') },
    { HANDOVER_DATABASE_URL: env.HANDOVER_DATABASE_URL.replace(ref, 'another-project') },
    { HANDOVER_DATABASE_URL: 'do-not-print:invalid' },
  ]) {
    assert.throws(() => exportConfig({ ...env, ...invalid }), (error) => !error.message.includes('do-not-print'))
  }
  assert.equal(jsonReadQuery('select 1 as count;'), "select coalesce(json_agg(export_row),'[]'::json)::text from (select 1 as count) export_row")
})

test('restore SQL preserves business rows and identities, skips stale sessions and storage metadata', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sabai-restore-'))
  try {
    const input = join(dir, 'data.sql'); const out = join(dir, 'restore.sql')
    const block = (table, row) => `COPY ${table} ("id") FROM stdin;\n${row}\n\\.\n`
    await writeFile(input, 'SET row_security = off;\n' + block('"public"."clients"', 'client') + block('"auth"."identities"', 'identity') + block('"auth"."sessions"', 'session') + block('"storage"."objects"', 'object'))
    assert.equal(await prepareRestore(input, out), 2)
    const result = await readFile(out, 'utf8')
    assert.ok(result.includes('client') && result.includes('identity'))
    assert.ok(!result.includes('session') && !result.includes('object'))
    assert.equal((await readFile(input, 'utf8')).includes('session'), true)
    const truncated = join(dir, 'broken.sql')
    await writeFile(truncated, 'COPY "public"."clients" ("id") FROM stdin;\nclient\n')
    await assert.rejects(prepareRestore(truncated, join(dir, 'failed.sql')))
  } finally { await rm(dir, { recursive: true, force: true }) }
})
