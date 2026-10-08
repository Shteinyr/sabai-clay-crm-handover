import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { checksums } from './archive.mjs'

const root = resolve(process.argv[2] ?? '')
const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'))
const actual = new Map((await checksums(root)).map((file) => [file.path, file]))
for (const expected of manifest.files) {
  const file = actual.get(expected.path)
  if (!file || file.bytes !== expected.bytes || file.sha256 !== expected.sha256) throw new Error(`Checksum mismatch: ${expected.path}`)
}
const extras = [...actual.keys()].filter((path) => path !== 'manifest.json' && !manifest.files.some((file) => file.path === path))
if (extras.length) throw new Error('Unexpected files in payload')
console.log(`Verified ${manifest.files.length} files; Storage files: ${manifest.storageFiles}; created: ${manifest.createdAt}`)
if (!manifest.countsStableDuringExport) console.warn('Rows changed during export: this is not a final cutover backup.')
