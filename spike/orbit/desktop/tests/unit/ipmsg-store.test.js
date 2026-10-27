const test = require('node:test')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const migrations = require('../../src/js/database/migrations')
const OrbitDatabase = require('../../src/js/database/database')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

test('adds ipmsg transport columns to friends and messages', () => {
  const db = new Database(':memory:')
  migrations.run(db)

  const friendColumns = db.pragma('table_info(friends)').map((column) => column.name)
  assert.ok(friendColumns.includes('transport'))
  assert.ok(friendColumns.includes('ipmsgAccount'))
  assert.ok(friendColumns.includes('ipmsgHost'))
  assert.ok(friendColumns.includes('lastIp'))

  const messageColumns = db.pragma('table_info(messages)').map((column) => column.name)
  assert.ok(messageColumns.includes('transport'))
  assert.ok(messageColumns.includes('remoteId'))
  assert.ok(messageColumns.includes('remoteSeq'))
  assert.ok(messageColumns.includes('deliveryStatus'))

  db.close()
})

test('round-trips ipmsg friend and message metadata across database reopen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-ipmsg-db-'))
  try {
    const first = new OrbitDatabase(dir)
    first.saveFriend({
      userId: 'ipmsg:10.0.0.9|peer',
      username: 'IPMSG Peer',
      usertag: 'IPMSG',
      status: 'online',
      transport: 'ipmsg',
      ipmsgAccount: 'peer',
      ipmsgHost: 'peer-host',
      lastIp: '10.0.0.9',
      accountOwnerId: 'user-1'
    })
    first.addMessage('ipmsg:10.0.0.9|peer', {
      id: 'ipmsg-msg-1',
      sender: 'ipmsg:10.0.0.9|peer',
      text: 'hello',
      timestamp: new Date().toISOString(),
      transport: 'ipmsg',
      remoteId: 'ipmsg-msg-1',
      remoteSeq: 9,
      deliveryStatus: 'delivered'
    })
    first.db.close()

    const second = new OrbitDatabase(dir)
    const friend = second.getFriends().find((f) => f.userId === 'ipmsg:10.0.0.9|peer')
    assert.equal(friend.transport, 'ipmsg')
    assert.equal(friend.ipmsgAccount, 'peer')
    assert.equal(friend.lastIp, '10.0.0.9')
    const message = second.getMessages('ipmsg:10.0.0.9|peer')[0]
    assert.equal(message.transport, 'ipmsg')
    assert.equal(message.remoteSeq, 9)
    assert.equal(message.deliveryStatus, 'delivered')
    second.db.close()
  } finally {
    for (var attempt = 0; attempt < 10; attempt++) {
      try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 })
        break
      } catch (error) {
        if (attempt === 9) throw error
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
      }
    }
  }
})
