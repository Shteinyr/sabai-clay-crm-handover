import { mkdir, writeFile, chmod, unlink, readFile } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { checksums, safeStoragePath, seal } from './archive.mjs'
import { exportConfig, jsonReadQuery } from './exportConfig.mjs'

process.umask(0o077)
const { token, ref, databaseUrl, url: databaseConnection, serviceKey: configuredServiceKey } = exportConfig(process.env)
const checkOnly = process.argv.includes('--check-access')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const root = process.env.HANDOVER_RESUME
  ? resolve(process.env.HANDOVER_RESUME)
  : resolve(process.env.HANDOVER_OUTPUT ?? 'backups', `handover-${stamp}`)
const payload = join(root, 'payload')
const sourceDir = join(root, 'source-cli')
if (!checkOnly) {
  await mkdir(payload, { recursive: true, mode: 0o700 })
  await chmod(root, 0o700)
  await mkdir(sourceDir, { recursive: true })
}
const cli = (...args) => {
  try {
    execFileSync('npx', ['--yes', 'supabase@2.120.0', ...args, '--workdir', sourceDir], { stdio: 'inherit', env: process.env })
  } catch {
    throw new Error('Supabase CLI export failed. No complete archive was produced; check connection without exposing credentials.')
  }
}
const connection = ['--db-url', databaseUrl]
function databaseQuery(sql) {
  const url = databaseConnection
  const env = { ...process.env, PGPASSWORD: decodeURIComponent(url.password) }
  try {
    return execFileSync('docker', ['run', '--rm', '-e', 'PGPASSWORD', 'postgres:17-alpine',
      'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
      '-d', `host=${url.hostname} port=${url.port || 5432} user=${decodeURIComponent(url.username)} dbname=${url.pathname.slice(1)} sslmode=require connect_timeout=30`,
      '-c', sql], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120_000, env, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch { throw new Error('Administrative chunk query failed; no complete archive was produced.') }
}
async function api(path, body) {
  if (!token) throw new Error('Management API is disabled in project-only export mode.')
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/${path}`, {
    method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120_000),
  })
  if (!response.ok) throw new Error(`Management ${path}: HTTP ${response.status}`)
  return response.json()
}
const query = (sql) => token
  ? api('database/query', { query: sql })
  : JSON.parse(databaseQuery(jsonReadQuery(sql)).trim())
const countsSql = `select schemaname,tablename from pg_tables where schemaname in ('public','auth','storage','supabase_migrations') order by 1,2`
const tables = await query(countsSql)
const counts = await query(tables.map(({ schemaname, tablename }) => `select '${schemaname}.${tablename}' as name,count(*)::int as rows from "${schemaname}"."${tablename}"`).join(' union all '))
const serviceKey = configuredServiceKey ?? (await api('api-keys')).find((key) => key.name === 'service_role')?.api_key
if (!serviceKey) throw new Error('Administrative Storage service key unavailable; archive is incomplete')
if (checkOnly) {
  const response = await fetch(`https://${ref}.supabase.co/storage/v1/bucket`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, signal: AbortSignal.timeout(120_000),
  })
  if (!response.ok) throw new Error(`Storage access check failed: HTTP ${response.status}`)
  const buckets = await response.json()
  console.log(`Read-only access verified: ${counts.length} database tables; ${buckets.length} Storage buckets. Personal management token used: ${Boolean(token)}. No data changed.`)
  process.exit(0)
}
console.log('Export started: administrative database dump and Storage files; no business writes.')
const sqlMarker = join(payload, 'sql-export-complete.json')
let auditRows = 0
if (process.env.HANDOVER_RESUME) {
  const marker = JSON.parse(await readFile(sqlMarker, 'utf8'))
  if (marker.sourceProject !== ref) throw new Error('Resume project mismatch')
  const requiredSql = ['roles.sql', 'schema.sql', 'data.sql', 'audit.sql', 'migrations-schema.sql', 'migrations-data.sql']
  if (marker.files.length !== requiredSql.length || !requiredSql.every((name) => marker.files.some((file) => file.path === name && file.bytes > 0))) throw new Error('Resume SQL set is incomplete')
  if (!Number.isSafeInteger(marker.auditRows) || marker.auditRows < 0) throw new Error('Invalid audit count')
  const actual = await checksums(payload)
  for (const file of marker.files) {
    if (!actual.some((item) => item.path === file.path && item.bytes === file.bytes && item.sha256 === file.sha256)) throw new Error('Resume SQL checksum mismatch')
  }
  auditRows = marker.auditRows
} else {
  cli('db', 'dump', ...connection, '--role-only', '-f', join(payload, 'roles.sql'))
  cli('db', 'dump', ...connection, '-f', join(payload, 'schema.sql'))
  cli('db', 'dump', ...connection, '--data-only', '--use-copy', '-x', 'storage.buckets_vectors,storage.vector_indexes,public.audit_log', '-f', join(payload, 'data.sql'))
  // An oversized immutable audit table can exceed the pooler's connection lifetime.
  // Read bounded ID ranges; record the exact exported count instead of claiming
  // that the multi-file backup represents one global transaction.
  const auditEnd = Number(databaseQuery('select coalesce(max(id),0) from public.audit_log').trim())
  const auditFile = join(payload, 'audit.sql')
  await writeFile(auditFile, 'COPY public.audit_log (id,entity_type,entity_id,action,old_data,new_data,created_at) FROM stdin;\n')
  const { appendFile } = await import('node:fs/promises')
  for (let from = 0; from <= auditEnd; from += 5000) {
    const rows = databaseQuery(`COPY (select id,entity_type,entity_id,action,old_data,new_data,created_at from public.audit_log where id >= ${from} and id < ${Math.min(from + 5000, auditEnd + 1)} order by id) TO STDOUT`)
    await appendFile(auditFile, rows)
    auditRows += rows.split('\n').length - 1
  }
  await appendFile(auditFile, `\\.\nSELECT setval(pg_get_serial_sequence('public.audit_log','id'), ${auditEnd || 1}, ${auditEnd > 0});\n`)
  cli('db', 'dump', ...connection, '--schema', 'supabase_migrations', '-f', join(payload, 'migrations-schema.sql'))
  cli('db', 'dump', ...connection, '--schema', 'supabase_migrations', '--data-only', '--use-copy', '-f', join(payload, 'migrations-data.sql'))
  await writeFile(sqlMarker, JSON.stringify({ sourceProject: ref, auditRows, files: await checksums(payload) }, null, 2))
}

// The default CLI schema excludes managed auth/storage definitions; archive their
// custom policies separately. Provider secrets belong to the receiver, not Git.
const policies = await query(`select schemaname,tablename,policyname,permissive,array_to_json(roles) as roles,cmd,qual,with_check from pg_policies where schemaname in ('auth','storage') order by 1,2,3`)
const quote = (s) => `"${s.replaceAll('"', '""')}"`
const policySql = policies.map((p) => `drop policy if exists ${quote(p.policyname)} on ${quote(p.schemaname)}.${quote(p.tablename)};\ncreate policy ${quote(p.policyname)} on ${quote(p.schemaname)}.${quote(p.tablename)} as ${p.permissive} for ${p.cmd} to ${p.roles.map(quote).join(', ')}${p.qual ? ` using (${p.qual})` : ''}${p.with_check ? ` with check (${p.with_check})` : ''};`).join('\n')
await writeFile(join(payload, 'auth-storage-policies.sql'), policySql)
const authConfig = token ? await api('config/auth') : { note: 'Project-only export. Provider secrets/settings are not copied; configure your own Google OAuth.' }
await writeFile(join(payload, 'auth-config-redacted.json'), JSON.stringify(Object.fromEntries(Object.entries(authConfig).filter(([key]) => !/secret|password|token|key|client_id|smtp|sms/i.test(key))), null, 2))
const objects = await query('select bucket_id,name,metadata from storage.objects order by bucket_id,name')
await writeFile(join(payload, 'storage-buckets.json'), JSON.stringify(await query('select * from storage.buckets order by id'), null, 2))
const storageRoot = join(payload, 'storage')
await mkdir(storageRoot, { recursive: true })
for (const object of objects) {
  const file = safeStoragePath(storageRoot, object.bucket_id, object.name)
  await mkdir(dirname(file), { recursive: true })
  const objectUrl = `https://${ref}.supabase.co/storage/v1/object/${encodeURIComponent(object.bucket_id)}/${object.name.split('/').map(encodeURIComponent).join('/')}`
  const response = await fetch(objectUrl, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`Storage download failed: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (object.metadata?.size != null && bytes.length !== Number(object.metadata.size)) throw new Error('Storage size mismatch; aborting incomplete backup')
  await writeFile(file, bytes)
}
await writeFile(join(payload, 'storage-objects.json'), JSON.stringify(objects, null, 2))
await writeFile(join(payload, 'database-counts.json'), JSON.stringify(counts, null, 2))
const endCounts = await query(tables.map(({ schemaname, tablename }) => `select '${schemaname}.${tablename}' as name,count(*)::int as rows from "${schemaname}"."${tablename}"`).join(' union all '))
const manifest = {
  format: 1, createdAt: new Date().toISOString(), sourceProject: ref,
  gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  workingTreeChanges: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  note: 'Preliminary backup while studio may be active. Final cutover requires a write freeze and a fresh verified backup.',
  countsStableDuringExport: JSON.stringify(counts) === JSON.stringify(endCounts),
  rows: counts.map((row) => row.name === 'public.audit_log' ? { ...row, rows: auditRows } : row),
  storageFiles: objects.length, files: (await checksums(payload)).filter((file) => file.path !== 'manifest.json'),
}
await writeFile(join(payload, 'manifest.json'), JSON.stringify(manifest, null, 2))
const passwordFile = process.env.HANDOVER_PASSWORD_FILE ?? join(root, 'password-separate.txt')
const password = process.env.HANDOVER_PASSWORD_FILE ? await readFile(passwordFile, 'utf8') : randomBytes(32).toString('base64url')
if (!process.env.HANDOVER_PASSWORD_FILE) await writeFile(passwordFile, `${password}\n`, { mode: 0o600, flag: 'wx' })
const tarFile = join(root, 'payload.tar.gz')
execFileSync('tar', ['-czf', tarFile, '-C', payload, '.'])
const archive = join(root, 'sabai-clay.sabai')
await seal(tarFile, archive, password)
await unlink(tarFile)
console.log(`Encrypted archive: ${archive}\nPassword file (send separately): ${passwordFile}\nRows listed: ${counts.length}; Storage files: ${objects.length}; stable counts: ${manifest.countsStableDuringExport}`)
console.log('Private plaintext payload remains locally for restore verification; never send it via GitHub.')
