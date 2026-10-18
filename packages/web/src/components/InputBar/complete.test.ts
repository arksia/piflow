import assert from 'node:assert/strict'
import { it } from 'node:test'
import { applyAt, applyCommand, composerToken, filterCommands } from './complete'

it('reads the at-path at the cursor and ignores an email', () => {
  assert.equal(composerToken('mail user@host.com', 16), null)
  const token = composerToken('对照 @src/App.tsx 和 @pack', 24)
  assert.equal(token?.kind, 'at')
  assert.equal(token?.query, 'pack')
})

it('opens slash only while the message itself starts with /', () => {
  assert.equal(composerToken('/rev', 4)?.query, 'rev')
  assert.equal(composerToken(' 请 /rev', 7), null)
  assert.equal(composerToken('/review\nfocus', 7), null)
  assert.equal(composerToken('/review focus', 8), null)
})

it('writes a file, a directory, and a quoted directory', () => {
  const file = composerToken('@src/Ap', 7)
  assert.ok(file?.kind === 'at')
  assert.deepEqual(applyAt('@src/Ap', file, 'src/App.tsx'), { text: '@src/App.tsx ', cursor: 13 })

  const directory = composerToken('@sr', 3)
  assert.ok(directory?.kind === 'at')
  assert.deepEqual(applyAt('@sr', directory, 'src/'), { text: '@src/', cursor: 5 })

  const quoted = composerToken('@"my', 4)
  assert.ok(quoted?.kind === 'at')
  assert.deepEqual(applyAt('@"my', quoted, 'my dir/'), { text: '@"my dir/"', cursor: 9 })
})

it('writes a session command and fuzzy-matches skills', () => {
  assert.deepEqual(applyCommand('/rev', 'review'), { text: '/review ', cursor: 8 })
  const commands = [
    { name: 'review', description: 'Read the diff', source: 'prompt' as const },
    { name: 'skill:grill', description: 'Interview', source: 'skill' as const },
  ]
  assert.deepEqual(filterCommands(commands, '').map(command => command.name), ['review', 'skill:grill'])
  assert.equal(filterCommands(commands, 'rv')[0]?.name, 'review')
  assert.equal(filterCommands(commands, 'gr')[0]?.name, 'skill:grill')
})
