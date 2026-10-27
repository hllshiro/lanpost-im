const test = require('node:test')
const assert = require('node:assert/strict')
const { peerToFriend, textToPacket, fileToPacket } = require('../../src/js/ipmsg-map')

test('maps an IPMSG peer into an Orbit friend record', () => {
  const friend = peerToFriend({
    key: '192.168.1.5|alice',
    ip: '192.168.1.5',
    port: 2425,
    account: 'alice',
    host: 'alice-pc',
    name: 'Alice',
    status: 1,
    online: true,
    lastSeen: 123
  })
  assert.equal(friend.userId, 'ipmsg:192.168.1.5|alice')
  assert.equal(friend.username, 'Alice')
  assert.equal(friend.transport, 'ipmsg')
  assert.equal(friend.status, 'busy')
  assert.equal(friend.ipmsgAccount, 'alice')
  assert.equal(friend.ipmsgHost, 'alice-pc')
  assert.equal(friend.lastIp, '192.168.1.5')
  assert.equal(friend.lastSeen, 123)
})

test('maps an offline IPMSG peer to offline status', () => {
  const friend = peerToFriend({
    key: '192.168.1.5|alice', ip: '192.168.1.5', port: 2425,
    account: 'alice', host: 'alice-pc', name: 'Alice', status: 0,
    online: false, lastSeen: 1
  })
  assert.equal(friend.status, 'offline')
})

test('maps IPMSG text into an Orbit MESSAGE packet', () => {
  const packet = textToPacket({ peerKey: '192.168.1.5|alice', text: 'hi', seq: 7 })
  assert.equal(packet.type, 'MESSAGE')
  assert.equal(packet.from, 'ipmsg:192.168.1.5|alice')
  assert.equal(packet.payload.chatId, 'ipmsg:192.168.1.5|alice')
  assert.equal(packet.payload.text, 'hi')
  assert.equal(packet.payload.msgId, 'ipmsg:7')
  assert.equal(packet.payload.transport, 'ipmsg')
  assert.equal(packet.payload.remoteSeq, 7)
})

test('maps an IPMSG file into an Orbit MESSAGE packet with an attachment', () => {
  const packet = fileToPacket({ id: 'in-1', peerKey: '192.168.1.5|alice', name: '报告.pdf', size: 12, path: 'C:/recv/报告.pdf', state: 'done' })
  assert.equal(packet.type, 'MESSAGE')
  assert.equal(packet.from, 'ipmsg:192.168.1.5|alice')
  assert.equal(packet.payload.msgId, 'ipmsg-file:in-1')
  assert.equal(packet.payload.transport, 'ipmsg')
  assert.equal(packet.payload.attachments[0].name, '报告.pdf')
  assert.equal(packet.payload.attachments[0].path, 'C:/recv/报告.pdf')
  assert.equal(packet.payload.attachments[0].type, 'file')
})
