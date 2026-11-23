import process from 'node:process'
import { runCli } from './cli.ts'
import { developmentResources } from './distribution/resources.ts'

try {
  await runCli(process.argv.slice(2), await developmentResources(new URL(import.meta.url)))
}
catch (error) {
  console.error('[piflow]', error instanceof Error ? error.message : error)
  process.exitCode = 1
}
