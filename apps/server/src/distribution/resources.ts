import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { verifyApplication } from './artifacts.ts'

export interface AppResources {
  version: string
  piVersion: string
  webDist: string
  workerEntry: URL
  extensions: { delivery: string, review: string }
}

/** Called by the actual product entry, before bootstrap can open user data. */
export async function installedResources(entry: URL): Promise<AppResources> {
  const root = fileURLToPath(new URL('../', entry))
  const info = await verifyApplication(root)
  const pi = JSON.parse(await readFile(new URL('../package.json', import.meta.resolve('@earendil-works/pi-coding-agent')), 'utf8'))
  if (pi.version !== info.piVersion)
    throw new Error('Installed pi runtime differs from the application build; reinstall the package')
  return {
    version: info.version,
    piVersion: pi.version,
    webDist: fileURLToPath(new URL('./web/', entry)),
    workerEntry: new URL('./runtime/worker.js', entry),
    extensions: {
      delivery: fileURLToPath(new URL('./extensions/code-delivery.js', entry)),
      review: fileURLToPath(new URL('./extensions/review.js', entry)),
    },
  }
}

/** Entry-relative paths, never caller cwd or a bundled helper's import.meta.url. */
export async function developmentResources(entry: URL): Promise<AppResources> {
  const manifest = JSON.parse(await readFile(new URL('../../../package.json', entry), 'utf8'))
  const pi = JSON.parse(await readFile(new URL('../package.json', import.meta.resolve('@earendil-works/pi-coding-agent')), 'utf8'))
  const suffix = entry.pathname.endsWith('.ts') ? 'ts' : 'js'
  return {
    version: manifest.version,
    piVersion: pi.version,
    webDist: fileURLToPath(new URL('../../web/dist/', entry)),
    workerEntry: new URL(`./runtime/worker.${suffix}`, entry),
    extensions: {
      delivery: fileURLToPath(new URL(`./runs/code-delivery-extension.${suffix}`, entry)),
      review: fileURLToPath(new URL(`./reviews/extension.${suffix}`, entry)),
    },
  }
}
