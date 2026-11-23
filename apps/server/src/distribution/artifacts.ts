import { createHash } from 'node:crypto'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const BUILD_INFO_PATH = 'dist/build-info.json'
export const APP_ENTRIES = ['package.json', 'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.txt', 'dist']
const required = ['dist/main.js', 'dist/runtime/worker.js', 'dist/extensions/code-delivery.js', 'dist/extensions/review.js', 'dist/web/index.html', ...APP_ENTRIES.filter(path => path !== 'dist')]

export interface BuildInfo {
  format: 1
  version: string
  piVersion: string
  ipcProtocol: number
  httpProtocol: null
  source: { commit: string | null, dirty: boolean, digest: string }
  files: Record<string, string>
}

/** Digest only regular files; artifacts and source inputs must not escape through symlinks. */
export async function fileDigests(root: string, entries: readonly string[]): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  async function visit(path: string) {
    const info = await lstat(join(root, path))
    if (info.isSymbolicLink())
      throw new Error(`Symlink is not an application input: ${path}`)
    if (info.isDirectory()) {
      for (const name of (await readdir(join(root, path))).sort())
        await visit(`${path}/${name}`)
    }
    else if (info.isFile() && path !== BUILD_INFO_PATH) {
      files[path] = createHash('sha256').update(await readFile(join(root, path))).digest('hex')
    }
    else if (!info.isFile()) {
      throw new Error(`Not a regular file: ${path}`)
    }
  }
  for (const path of entries) await visit(path)
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))
}

export function digestInputs(files: Record<string, string>) {
  return createHash('sha256').update(JSON.stringify(files)).digest('hex')
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export async function verifyApplication(root: string): Promise<BuildInfo> {
  const info: unknown = JSON.parse(await readFile(join(root, BUILD_INFO_PATH), 'utf8'))
  const sha = (value: unknown) => typeof value === 'string' && /^[a-f\d]{64}$/.test(value)
  if (!object(info) || info.format !== 1 || typeof info.version !== 'string' || typeof info.piVersion !== 'string'
    || !Number.isInteger(info.ipcProtocol) || info.httpProtocol !== null || !object(info.source)
    || (info.source.commit !== null && typeof info.source.commit !== 'string')
    || typeof info.source.dirty !== 'boolean' || !sha(info.source.digest) || !object(info.files)) {
    throw new Error('Invalid or unsupported application build record; rebuild the application')
  }
  for (const [path, hash] of Object.entries(info.files)) {
    if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..') || !sha(hash))
      throw new Error('Invalid application build file record')
  }
  const actual = await fileDigests(root, APP_ENTRIES)
  for (const path of required) {
    if (!actual[path] || !info.files[path])
      throw new Error(`Missing required application artifact: ${path}`)
  }
  if (JSON.stringify(actual) !== JSON.stringify(Object.fromEntries(Object.entries(info.files).sort(([a], [b]) => a.localeCompare(b)))))
    throw new Error('Application artifact digest mismatch; rebuild before packing or reinstall the package')
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (manifest.version !== info.version || manifest.dependencies?.['@earendil-works/pi-coding-agent'] !== info.piVersion)
    throw new Error('Application/runtime version does not match the build record')
  return info as unknown as BuildInfo
}
