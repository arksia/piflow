import assert from 'node:assert/strict'
import { it } from 'node:test'
import { composerCommands } from '../../project/composer-commands'

it('lists templates, then extension commands, then skills', () => {
  assert.deepEqual(composerCommands({
    templates: [{ name: 'review', description: 'Read the diff', argumentHint: '[focus]' }],
    extensions: [{ name: 'ship', description: 'Open a pull request' }],
    skills: [{ name: 'grill', description: 'Interview a plan' }],
  }), [
    { name: 'review', description: '[focus] — Read the diff', source: 'prompt' },
    { name: 'ship', description: 'Open a pull request', source: 'extension' },
    { name: 'skill:grill', description: 'Interview a plan', source: 'skill' },
  ])
})
