import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { it } from 'node:test'
import { build } from 'esbuild'
import { APP_ENTRIES, BUILD_INFO_PATH, fileDigests, verifyApplication } from '../../apps/server/src/distribution/artifacts.ts'
import { checkBrowserInputs, checkServerInputs } from '../build-policy.mjs'

it('rejects transitive server/browser violations using real bundler input graphs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-graph-'))
  async function put(path, text) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), text)
  }
  try {
    await put('apps/server/src/routes/hidden.ts', 'export const value = 1')
    await put('packages/protocol/dist/bridge.js', 'export { value } from "../../../apps/server/src/routes/hidden.ts"')
    await put('apps/web/src/main.ts', 'import { value } from "../../../packages/protocol/dist/bridge.js"; console.info(value)')
    const browser = await build({ absWorkingDir: root, entryPoints: ['apps/web/src/main.ts'], bundle: true, platform: 'browser', write: false, metafile: true })
    assert.throws(() => checkBrowserInputs(Object.keys(browser.metafile.inputs).map(path => resolve(root, path)), root), /server\/Node input/)
    assert.throws(() => checkBrowserInputs(['node:fs'], root), /server\/Node input/)
    assert.throws(() => checkBrowserInputs([], root), /empty/)
    await put('apps/server/src/runtime/worker.ts', 'import { value } from "../routes/hidden.ts"; console.info(value)')
    const worker = await build({ absWorkingDir: root, entryPoints: ['apps/server/src/runtime/worker.ts'], bundle: true, platform: 'node', write: false, metafile: true })
    assert.throws(() => checkServerInputs(worker.metafile, root, [], true), /Host\/feature implementation/)
    await put('apps/server/src/runtime/worker.ts', 'import "undeclared-package"')
    const missing = await build({ absWorkingDir: root, entryPoints: ['apps/server/src/runtime/worker.ts'], bundle: true, platform: 'node', external: ['undeclared-package'], write: false, metafile: true })
    assert.throws(() => checkServerInputs(missing.metafile, root, []), /Undeclared production import/)
    checkServerInputs(missing.metafile, root, ['undeclared-package'])
  }
  finally { await rm(root, { recursive: true, force: true }) }
})

it('rejects missing, mixed or malformed application artifacts before startup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piflow-artifacts-'))
  try {
    for (const path of ['dist/main.js', 'dist/runtime/worker.js', 'dist/extensions/code-delivery.js', 'dist/extensions/review.js', 'dist/web/index.html', 'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.txt']) {
      await mkdir(dirname(join(root, path)), { recursive: true })
      await writeFile(join(root, path), path)
    }
    await writeFile(join(root, 'package.json'), JSON.stringify({ version: '0.1.0', dependencies: { '@earendil-works/pi-coding-agent': '1.5.2' } }))
    const info = { format: 1, version: '0.1.0', piVersion: '1.5.2', ipcProtocol: 2, httpProtocol: null, source: { commit: null, dirty: false, digest: 'a'.repeat(64) }, files: await fileDigests(root, APP_ENTRIES) }
    const record = () => writeFile(join(root, BUILD_INFO_PATH), JSON.stringify(info))
    await record()
    assert.equal((await verifyApplication(root)).version, '0.1.0')
    const worker = join(root, 'dist/runtime/worker.js')
    const original = await readFile(worker)
    await writeFile(worker, 'old worker')
    await assert.rejects(verifyApplication(root), /digest mismatch/)
    await writeFile(worker, original)
    await writeFile(join(root, 'dist/web/index.html'), 'old web')
    await assert.rejects(verifyApplication(root), /digest mismatch/)
    await rm(worker)
    await assert.rejects(verifyApplication(root), /Missing required/)
    await writeFile(worker, original)
    info.format = 2
    await record()
    await assert.rejects(verifyApplication(root), /unsupported/)
    info.format = 1
    info.files['../outside'] = 'a'.repeat(64)
    await record()
    await assert.rejects(verifyApplication(root), /Invalid application build file/)
    delete info.files['../outside']
    await record()
    await symlink(join(root, 'README.md'), join(root, 'dist/web/escape'))
    await assert.rejects(verifyApplication(root), /Symlink/)
  }
  finally { await rm(root, { recursive: true, force: true }) }
})
