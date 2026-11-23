import { execFile } from 'node:child_process'
import { chmod, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { APP_ENTRIES, BUILD_INFO_PATH, fileDigests, verifyApplication } from '../apps/server/src/distribution/artifacts.ts'
import { WORKER_PROTOCOL } from '../apps/server/src/runtime/version.ts'
import { sourceDigest } from './app-inputs.mjs'
import { checkServerInputs } from './build-policy.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const stage = join(root, 'dist/app')
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const manifest = await json(join(root, 'package.json'))
const server = await json(join(root, 'apps/server/package.json'))
const dependencies = Object.fromEntries(Object.entries(server.dependencies).filter(([name]) => name !== '@piflow/protocol'))
for (const name of Object.keys(dependencies)) {
  const installed = await json(join(root, 'apps/server/node_modules', name, 'package.json'))
  dependencies[name] = installed.version
}
await rm(stage, { recursive: true, force: true })
await mkdir(join(stage, 'dist'), { recursive: true })
const entries = {
  'main': 'apps/server/src/main.ts',
  'runtime/worker': 'apps/server/src/runtime/worker.ts',
  'extensions/code-delivery': 'apps/server/src/runs/code-delivery-extension.ts',
  'extensions/review': 'apps/server/src/reviews/extension.ts',
}
const result = await build({
  absWorkingDir: root,
  entryPoints: entries,
  outdir: join(stage, 'dist'),
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node22.19',
  external: Object.keys(dependencies),
  chunkNames: 'chunks/[name]-[hash]',
  metafile: true,
  legalComments: 'eof',
  logLevel: 'warning',
})
checkServerInputs(result.metafile, root, Object.keys(dependencies))
// Check the worker's own transitive graph separately from the Host entry.
const workerGraph = await build({
  absWorkingDir: root,
  entryPoints: [entries['runtime/worker']],
  write: false,
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: Object.keys(dependencies),
  metafile: true,
})
checkServerInputs(workerGraph.metafile, root, Object.keys(dependencies), true)
await writeFile(join(root, 'dist/server-inputs.json'), JSON.stringify(result.metafile, null, 2))
await cp(join(root, 'apps/web/dist'), join(stage, 'dist/web'), { recursive: true })
const webInputs = await json(join(stage, 'dist/web/.build-inputs.json'))
await rm(join(stage, 'dist/web/.build-inputs.json'))
await cp(join(root, 'LICENSE'), join(stage, 'LICENSE'))
await cp(join(root, 'README.md'), join(stage, 'README.md'))

// Keep notices for actual bundled browser dependencies, plus the checked-in brand marks.
const packages = new Map()
for (const input of webInputs.filter(path => path.includes('node_modules/'))) {
  let directory = dirname(resolve(root, input))
  while (directory !== root && directory !== dirname(directory)) {
    try {
      const pkg = await json(join(directory, 'package.json'))
      if (pkg.name) {
        packages.set(`${pkg.name}@${pkg.version}`, { directory, pkg })
        break
      }
    }
    catch (error) {
      if (error.code !== 'ENOENT')
        throw error
    }
    directory = dirname(directory)
  }
}
let notices = 'piflow bundles the following browser dependencies. Server dependencies retain their own npm package notices.\n'
const upstreamLicenses = new Set(['rehype-katex@7.0.1', 'remark-math@6.0.0'])
for (const [name, { directory, pkg }] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  notices += `\n=== ${name} (${pkg.license ?? 'see package'}) ===\n`
  const licenseFiles = (await readdir(directory)).filter(name => /^(?:licen[cs]e|copying|notice|ofl)(?:[.\-_].*)?$/i.test(name))
  if (!licenseFiles.length && upstreamLicenses.has(name))
    notices += await readFile(join(root, 'scripts/licenses/remark-math.txt'), 'utf8')
  else if (!licenseFiles.length)
    throw new Error(`Missing bundled dependency license: ${name}`)
  for (const file of licenseFiles) notices += `${await readFile(join(directory, file), 'utf8')}\n`
}
notices += `\n=== LobeHub model brand marks ===\n${await readFile(join(root, 'apps/web/src/components/ProviderLogo/assets/LICENSE'), 'utf8')}`
await writeFile(join(stage, 'THIRD_PARTY_NOTICES.txt'), notices)
await writeFile(join(stage, 'package.json'), `${JSON.stringify({
  name: manifest.name,
  version: manifest.version,
  private: true,
  type: 'module',
  description: 'Browser interface for the pi coding agent',
  license: 'MIT',
  bin: { piflow: 'dist/main.js' },
  engines: manifest.engines,
  files: ['dist', 'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.txt'],
  dependencies,
}, null, 2)}\n`)
await chmod(join(stage, 'dist/main.js'), 0o755)
let commit = null
let dirty = true
try {
  commit = (await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim()
  dirty = Boolean((await promisify(execFile)('git', ['status', '--porcelain'], { cwd: root })).stdout.trim())
}
catch { /* Source archives may not contain Git metadata. */ }
const info = {
  format: 1,
  version: manifest.version,
  piVersion: dependencies['@earendil-works/pi-coding-agent'],
  ipcProtocol: WORKER_PROTOCOL,
  httpProtocol: null,
  source: { commit, dirty, digest: await sourceDigest(root) },
  files: await fileDigests(stage, APP_ENTRIES),
}
await writeFile(join(stage, BUILD_INFO_PATH), `${JSON.stringify(info, null, 2)}\n`)
await verifyApplication(stage)
console.info(`Built ${manifest.name}@${manifest.version} in dist/app`)
