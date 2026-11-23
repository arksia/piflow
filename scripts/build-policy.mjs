import { builtinModules } from 'node:module'
import { relative, resolve, sep } from 'node:path'

const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]))
const slash = path => path.split(sep).join('/')

export function checkBrowserInputs(ids, root) {
  if (!ids.length)
    throw new Error('Browser input graph is empty')
  for (const id of ids) {
    const path = slash(relative(root, id.split('?')[0]))
    if (builtins.has(id) || id.includes('__vite-browser-external') || path.startsWith('apps/server/'))
      throw new Error(`Browser graph includes server/Node input: ${id}`)
    if (/(?:^|\/)(?:test|__tests__)\/|\.test\.[cm]?[jt]sx?$/.test(path))
      throw new Error(`Browser graph includes a test input: ${id}`)
  }
}

export function checkServerInputs(meta, root, dependencies, worker = false) {
  const inputs = Object.keys(meta.inputs)
  if (!inputs.length)
    throw new Error('Server input graph is empty')
  for (const input of inputs) {
    const path = slash(relative(root, resolve(root, input)))
    if (!path.startsWith('apps/server/src/') && !path.startsWith('packages/protocol/dist/'))
      throw new Error(`Server bundle includes undeclared or foreign input: ${input}`)
    if (/(?:^|\/)test\/|\.test\.ts$/.test(path))
      throw new Error(`Server bundle includes a test input: ${input}`)
    if (worker && /^apps\/server\/src\/(?:routes|plugins|facts|flow|reviews|usage)\//.test(path))
      throw new Error(`Worker graph includes Host/feature implementation: ${input}`)
  }
  for (const output of Object.values(meta.outputs)) {
    for (const imported of output.imports.filter(value => value.external)) {
      const name = imported.path.startsWith('@') ? imported.path.split('/').slice(0, 2).join('/') : imported.path.split('/')[0]
      if (!builtins.has(imported.path) && !dependencies.includes(name))
        throw new Error(`Undeclared production import: ${imported.path}`)
    }
  }
}

/** Validate the actual Vite graph, including transitive imports and split chunks. */
export function browserBuildPolicy(root) {
  return {
    name: 'piflow-browser-inputs',
    apply: 'build',
    generateBundle() {
      const ids = [...this.getModuleIds()]
      checkBrowserInputs(ids, root)
      const files = ids.filter(id => !id.startsWith('\0') && !id.includes('?') && id.startsWith(root))
      this.emitFile({ type: 'asset', fileName: '.build-inputs.json', source: JSON.stringify([...new Set(files.map(id => slash(relative(root, id))))].sort()) })
    },
  }
}
