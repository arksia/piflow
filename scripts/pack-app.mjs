import { execFile } from 'node:child_process'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { verifyApplication } from '../apps/server/src/distribution/artifacts.ts'
import { sourceDigest } from './app-inputs.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const stage = join(root, 'dist/app')
const info = await verifyApplication(stage)
if (info.source.digest !== await sourceDigest(root))
  throw new Error('Source inputs changed after the application build; run pnpm build again')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const { stdout } = await promisify(execFile)(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', join(root, 'dist')], { cwd: stage, maxBuffer: 4 * 1024 * 1024 })
const [packed] = JSON.parse(stdout)
console.info(join(root, 'dist', packed.filename))
