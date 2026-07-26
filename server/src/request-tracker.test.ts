import assert from 'node:assert/strict'
import { it } from 'node:test'
import { RequestTracker } from '../../web/src/request-tracker.js'

it('matches concurrent replies by request id instead of arrival order', async () => {
  const tracker = new RequestTracker<string>()
  const first = tracker.wait('first')
  const second = tracker.wait('second')

  tracker.resolve('second', 'second reply')
  tracker.resolve('first', 'first reply')

  assert.deepEqual(await Promise.all([first, second]), ['first reply', 'second reply'])
})

it('rejects every pending request when the connection closes', async () => {
  const tracker = new RequestTracker<string>()
  const request = tracker.wait('pending')
  tracker.rejectAll(new Error('connection closed'))

  await assert.rejects(request, /connection closed/)
})
