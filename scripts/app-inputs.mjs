import { digestInputs, fileDigests } from '../apps/server/src/distribution/artifacts.ts'

const sourceEntries = [
  'apps/server/src',
  'apps/server/package.json',
  'apps/server/tsconfig.build.json',
  'apps/web/src',
  'apps/web/index.html',
  'apps/web/package.json',
  'apps/web/vite.config.ts',
  'apps/web/uno.config.ts',
  'packages/protocol/src',
  'packages/protocol/package.json',
  'packages/protocol/tsconfig.build.json',
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.node.json',
  'scripts',
  'LICENSE',
  'README.md',
]

export async function sourceDigest(root) {
  return digestInputs(await fileDigests(root, sourceEntries))
}
