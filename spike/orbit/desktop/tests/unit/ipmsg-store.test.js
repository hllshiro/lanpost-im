const test = require('node:test')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const migrations = require('../../src/js/database/migrations')

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
