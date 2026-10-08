import { createReadStream, createWriteStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { open, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const skipped = new Set([
  'storage.objects', 'storage.buckets',
  'auth.sessions', 'auth.refresh_tokens', 'auth.flow_state',
  'auth.mfa_amr_claims', 'auth.mfa_challenges', 'auth.one_time_tokens',
  'auth.oauth_authorizations', 'auth.oauth_client_states', 'auth.saml_relay_states',
  'auth.webauthn_challenges',
])

// Parse the canonical pg_dump COPY envelope, not the escaped data inside it.
export async function prepareRestore(input, output) {
  const file = await open(output, 'wx', 0o600)
  await file.close()
  let blocks = 0
  async function* filter() {
    let copying = false
    let omit = false
    const lines = createInterface({ input: createReadStream(input), crlfDelay: Infinity })
    for await (const line of lines) {
      if (!copying) {
        const match = /^COPY "([^"]+)"\."([^"]+)" .* FROM stdin;$/.exec(line)
        if (match) { copying = true; omit = skipped.has(`${match[1]}.${match[2]}`); if (omit) blocks += 1 }
      }
      if (!omit) yield `${line}\n`
      if (copying && line === '\\.') { copying = false; omit = false }
    }
    if (copying) throw new Error('Truncated COPY block: source dump is incomplete')
  }
  try {
    await pipeline(Readable.from(filter()), createWriteStream(output, { flags: 'r+' }))
  } catch (error) { await unlink(output); throw error }
  return blocks
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output] = process.argv.slice(2)
  if (!input || !output) throw new Error('Usage: node scripts/handover/prepareRestore.mjs data.sql data-restore.sql')
  console.log(`Prepared restore SQL; omitted ${await prepareRestore(input, output)} managed Storage/ephemeral Auth blocks. Original dump is unchanged.`)
}
