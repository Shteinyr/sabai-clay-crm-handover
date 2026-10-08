import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { open, readFile, readdir, unlink } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { resolve, relative, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const magic = Buffer.from('SABAI01\n')
const headerSize = magic.length + 16 + 12
const derive = (password, salt) => scryptSync(password.trim(), salt, 32, { N: 32768, maxmem: 64 * 1024 * 1024 })

export async function seal(input, output, password) {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', derive(password, salt), iv)
  const header = Buffer.concat([magic, salt, iv])
  cipher.setAAD(header)
  const file = await open(output, 'wx', 0o600)
  await file.write(header)
  await file.close()
  try {
    await pipeline(createReadStream(input), cipher, createWriteStream(output, { flags: 'a' }))
    const trailer = await open(output, 'a')
    await trailer.write(cipher.getAuthTag())
    await trailer.close()
  } catch (error) {
    await unlink(output)
    throw error
  }
}

export async function unseal(input, output, password) {
  const file = await open(input, 'r')
  const { size } = await file.stat()
  const header = Buffer.alloc(headerSize)
  const tag = Buffer.alloc(16)
  await file.read(header, 0, header.length, 0)
  await file.read(tag, 0, 16, size - 16)
  await file.close()
  if (size <= headerSize + 16 || !header.subarray(0, magic.length).equals(magic)) throw new Error('Invalid archive header')
  const decipher = createDecipheriv('aes-256-gcm', derive(password, header.subarray(8, 24)), header.subarray(24, 36))
  decipher.setAAD(header)
  decipher.setAuthTag(tag)
  // Never overwrite an existing file, even with an incorrect password.
  const target = await open(output, 'wx', 0o600)
  await target.close()
  try {
    await pipeline(createReadStream(input, { start: headerSize, end: size - 17 }), decipher, createWriteStream(output, { flags: 'r+' }))
  } catch (error) {
    await unlink(output)
    throw error
  }
}

export async function checksums(directory) {
  const entries = []
  async function visit(path) {
    for (const item of await readdir(path, { withFileTypes: true })) {
      const absolute = join(path, item.name)
      if (item.isSymbolicLink()) throw new Error('Symlinks are not allowed in archives')
      if (item.isDirectory()) await visit(absolute)
      else {
        const hash = createHash('sha256')
        let size = 0
        for await (const bytes of createReadStream(absolute)) { hash.update(bytes); size += bytes.length }
        entries.push({ path: relative(directory, absolute), bytes: size, sha256: hash.digest('hex') })
      }
    }
  }
  await visit(directory)
  return entries.sort((a, b) => a.path.localeCompare(b.path))
}

export function safeStoragePath(root, bucket, name) {
  if (![bucket, name].every((part) => typeof part === 'string' && part.length > 0) || bucket.includes('/') || bucket.includes('\\')) throw new Error('Invalid storage path')
  if (name.startsWith('/') || name.split(/[\\/]/).some((part) => part === '..' || !part)) throw new Error('Unsafe storage path')
  const path = resolve(root, bucket, name)
  if (!path.startsWith(`${resolve(root)}/`)) throw new Error('Unsafe storage path')
  return path
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [operation, input, output] = process.argv.slice(2)
  if (operation !== 'decrypt' || !input || !output || !process.env.HANDOVER_PASSWORD_FILE) throw new Error('Usage: HANDOVER_PASSWORD_FILE=... node scripts/handover/archive.mjs decrypt input.sabai output.tar.gz')
  await unseal(input, output, await readFile(process.env.HANDOVER_PASSWORD_FILE, 'utf8'))
  console.log('Archive authenticated and decrypted. Extract only this verified tar.gz.')
}
