export function shouldSeedFlow(input: {
  stored: boolean
  nodeCount: number
  seedPath: string
  seedCwd: string
  projectPath: string
}) {
  return !input.stored
    && input.nodeCount === 0
    && input.seedPath !== ''
    && input.seedCwd === input.projectPath
}
