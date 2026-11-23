#!/usr/bin/env node
import process from 'node:process'
import { runCli } from './cli.ts'
import { installedResources } from './distribution/resources.ts'

try {
  await runCli(process.argv.slice(2), await installedResources(new URL(import.meta.url)))
}
catch (error) {
  console.error('[piflow]', error instanceof Error ? error.message : error)
  process.exitCode = 1
}
