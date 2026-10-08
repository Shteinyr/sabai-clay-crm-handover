import { createClient } from '@supabase/supabase-js'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { safeStoragePath } from './archive.mjs'

const root = resolve(process.argv[2] ?? '')
execFileSync(process.execPath, ['scripts/handover/verify.mjs', root], { stdio: 'inherit' })
const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'))
const url = new URL(process.env.HANDOVER_TARGET_URL)
if (url.hostname === `${manifest.sourceProject}.supabase.co`) throw new Error('Refusing to write into the source project')
if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('HTTPS is required outside local Supabase')
if (!process.env.HANDOVER_TARGET_SERVICE_KEY) throw new Error('An explicit target service-role/secret key is required; never use VITE_*')
const supabase = createClient(url.href, process.env.HANDOVER_TARGET_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const buckets = JSON.parse(await readFile(`${root}/storage-buckets.json`, 'utf8'))
const objects = JSON.parse(await readFile(`${root}/storage-objects.json`, 'utf8'))
const existing = await supabase.storage.listBuckets()
if (existing.error) throw existing.error
for (const bucket of buckets) {
  const present = existing.data.find((item) => item.id === bucket.id)
  if (present) {
    if (present.public !== bucket.public) throw new Error('Existing bucket has different visibility; review before proceeding')
  } else {
    const result = await supabase.storage.createBucket(bucket.id, {
      public: bucket.public, fileSizeLimit: bucket.file_size_limit ?? undefined,
      allowedMimeTypes: bucket.allowed_mime_types ?? undefined,
    })
    if (result.error) throw result.error
  }
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
for (const object of objects) {
  const bytes = await readFile(safeStoragePath(`${root}/storage`, object.bucket_id, object.name))
  const store = supabase.storage.from(object.bucket_id)
  const uploaded = await store.upload(object.name, bytes, { upsert: false, contentType: object.metadata?.mimetype ?? 'application/octet-stream' })
  // Resume only for byte-identical objects, never overwrite another file.
  if (uploaded.error && !['409', '400'].includes(String(uploaded.error.statusCode))) throw uploaded.error
  const downloaded = await store.download(object.name)
  if (downloaded.error) throw downloaded.error
  if (hash(Buffer.from(await downloaded.data.arrayBuffer())) !== hash(bytes)) throw new Error('Target Storage checksum mismatch; existing data was not overwritten')
}
console.log(`Restored and verified ${objects.length} Storage objects at the new target.`)
