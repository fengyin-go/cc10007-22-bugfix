/**
 * 本组归属控制测试：跨组越权拒绝、共享记录只读。
 * 运行：node --test frontend/src/data/backfill/access.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { checkAccess, GROUPS } from './access.ts'

test('本组记录可读写', () => {
  const result = checkAccess({ ownerGroup: GROUPS[0], ownership: '本组' }, GROUPS[0], true)
  assert.equal(result.allowed, true)
  assert.equal(result.readonly, false)
})

test('跨组写操作被拒绝且标记只读', () => {
  const result = checkAccess({ ownerGroup: GROUPS[0], ownership: '本组' }, GROUPS[1], true)
  assert.equal(result.allowed, false)
  assert.equal(result.readonly, true)
  assert.match(result.reason, /跨组越权拒绝/)
})

test('跨组读操作允许但只读', () => {
  const result = checkAccess({ ownerGroup: GROUPS[0], ownership: '本组' }, GROUPS[1], false)
  assert.equal(result.allowed, true)
  assert.equal(result.readonly, true)
})

test('共享记录对所有组只读，写操作一律拒绝', () => {
  for (const group of GROUPS) {
    const write = checkAccess({ ownerGroup: GROUPS[2], ownership: '共享' }, group, true)
    assert.equal(write.allowed, false)
    assert.equal(write.readonly, true)
    const read = checkAccess({ ownerGroup: GROUPS[2], ownership: '共享' }, group, false)
    assert.equal(read.allowed, true)
    assert.equal(read.readonly, true)
  }
})
