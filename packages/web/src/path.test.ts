import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shortenPath } from './path'

test('shortenPath replaces macOS, Linux, Windows, and WSL homes', () => {
  assert.equal(shortenPath('/Users/ada/src'), '~/src')
  assert.equal(shortenPath('/home/ada/src'), '~/src')
  assert.equal(shortenPath('C:\\Users\\ada\\src'), '~\\src')
  assert.equal(shortenPath('C:/Users/ada/src'), '~/src')
  assert.equal(shortenPath('\\\\wsl$\\Ubuntu\\home\\ada\\src'), '~\\src')
  assert.equal(shortenPath('\\\\wsl.localhost\\Ubuntu\\home\\ada\\src'), '~\\src')
  assert.equal(shortenPath('/mnt/c/Users/ada/src'), '~/src')
  assert.equal(shortenPath('E:\\work\\app'), 'E:\\work\\app')
  assert.equal(shortenPath('/opt/app'), '/opt/app')
})
