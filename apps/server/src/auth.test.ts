import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AUTH_COOKIE,
  hasAuthCookie,
  isAllowedOrigin,
  isLoopbackHost,
  isValidAccessToken,
} from './auth.js'

describe('http auth', () => {
  it('requires the exact authentication cookie', () => {
    assert.equal(hasAuthCookie(`other=x; ${AUTH_COOKIE}=secret`, 'secret'), true)
    assert.equal(hasAuthCookie(`${AUTH_COOKIE}=wrong`, 'secret'), false)
    assert.equal(hasAuthCookie(undefined, 'secret'), false)
  })

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
