import { execFileSync } from 'node:child_process'

export function exportConfig(env) {
  const ref = env.HANDOVER_PROJECT_REF
  const databaseUrl = env.HANDOVER_DATABASE_URL
  const serviceKey = env.HANDOVER_SOURCE_SERVICE_KEY
  const token = serviceKey ? undefined : env.SUPABASE_ACCESS_TOKEN
  if (!ref || !/^[a-z0-9]{20}$/.test(ref)) throw new Error('Set HANDOVER_PROJECT_REF. No built-in project or credentials.')
  if (!databaseUrl) throw new Error('Set HANDOVER_DATABASE_URL to the administrative session connection.')
  let url
  try { url = new URL(databaseUrl) } catch { throw new Error('Invalid database URL; credentials are not printed.') }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Use a Postgres connection URL.')
  if (!(url.hostname === `db.${ref}.supabase.co` || (url.hostname.endsWith('.pooler.supabase.com') && url.username === `postgres.${ref}`))) throw new Error('Database URL must match HANDOVER_PROJECT_REF')
  if (url.port && url.port !== '5432') throw new Error('Use session pooler port 5432, not transaction pooler')
  if (!token && !serviceKey) throw new Error('Set HANDOVER_SOURCE_SERVICE_KEY for a project-only export, or your own management token.')
  if (serviceKey) {
    if (serviceKey.startsWith('sbp_')) throw new Error('A personal management token is not a Storage key.')
    if (serviceKey.startsWith('eyJ')) {
      let claims
      try { claims = JSON.parse(Buffer.from(serviceKey.split('.')[1], 'base64url').toString()) } catch { throw new Error('Invalid administrative Storage key.') }
      if (claims.role !== 'service_role' || (claims.ref && claims.ref !== ref)) throw new Error('Storage key must be administrative and belong to the selected project.')
    } else if (!serviceKey.startsWith('sb_secret_')) throw new Error('Use the selected project administrative Storage key.')
  }
  return { ref, databaseUrl, url, token, serviceKey }
}

export function jsonReadQuery(sql) {
  return `select coalesce(json_agg(export_row),'[]'::json)::text from (${sql.replace(/;\s*$/, '')}) export_row`
}

export function sourceMetadata(cwd = process.cwd()) {
  try {
    const options = { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    return {
      gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], options).trim(),
      workingTreeChanges: execFileSync('git', ['status', '--porcelain'], options).trim(),
    }
  } catch {
    return { gitCommit: null, workingTreeChanges: null, sourceNote: 'Code from ZIP or standalone archive; Git metadata unavailable.' }
  }
}
