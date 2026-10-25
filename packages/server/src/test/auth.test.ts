import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isAllowedOrigin,
  isLoopbackHost,
  isValidAccessToken,
} from '../auth'

describe('http auth', () => {
  it('only allows automatic bootstrap on loopback hosts', () => {
    assert.equal(isLoopbackHost('127.0.0.1'), true)
    assert.equal(isLoopbackHost('::1'), true)
    assert.equal(isLoopbackHost('0.0.0.0'), false)
  })

  it('only accepts exact same-origin browser requests', () => {
    assert.equal(isAllowedOrigin('http://127.0.0.1:3141', '127.0.0.1:3141'), true)
    assert.equal(isAllowedOrigin('https://example.com', '127.0.0.1:3141'), false)
    assert.equal(isAllowedOrigin(undefined, '127.0.0.1:3141'), false)
  })

  it('requires a URL-safe access token with sufficient entropy', () => {
    assert.equal(isValidAccessToken('0123456789abcdef01234567'), true)
    assert.equal(isValidAccessToken('too-short'), false)
    assert.equal(isValidAccessToken('0123456789abcdef012345;7'), false)
  })
})
