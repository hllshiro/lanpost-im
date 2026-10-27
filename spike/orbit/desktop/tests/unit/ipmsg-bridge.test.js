const test = require('node:test')
const assert = require('node:assert/strict')
const { createIpmsgBridge } = require('../../lib/ipmsg/bridge')

function fakeTransport() {
  const state = {
    started: false,
    stopped: false,
    config: null,
    callbacks: null,
    texts: [],
    files: []
  }
  return {
    state,
    transport: {
      async start() {
        state.started = true
      },
      async stop() {
        state.stopped = true
      },
      getPeers() {
        return []
      },
      sendText(peerKey, text) {
        state.texts.push([peerKey, text])
        return 42
      },
      async sendFile(peerKey, filePath) {
        state.files.push([peerKey, filePath])
        return 'file-1'
      },
      acceptFile() {},
      rejectFile() {},
      cancelFile() {}
    }
  }
}

test('starts the transport with the current identity and forwards events', async () => {
  const fake = fakeTransport()
  const sent = []
  const bridge = createIpmsgBridge({
    sendToRenderer: (channel, payload) => sent.push([channel, payload]),
    receiveDir: 'C:/recv',
    host: 'orbit-host',
    log: () => undefined,
    createTransport: (config, callbacks) => {
      fake.state.config = config
      fake.state.callbacks = callbacks
      return fake.transport
    }
  })

  await bridge.start({ userId: 'user-1', username: 'Alice' })
  assert.equal(fake.state.started, true)
  assert.equal(fake.state.config.account, 'user-1')
  assert.equal(fake.state.config.name, 'Alice')
  assert.equal(fake.state.config.receiveDir, 'C:/recv')

  fake.state.callbacks.onPeers([{ key: 'ipmsg:1|a', account: 'a' }])
  fake.state.callbacks.onText({ peerKey: 'ipmsg:1|a', text: 'hi', seq: 1, utf8: true })
  fake.state.callbacks.onFile({ id: 'f1', state: 'done' })

  assert.deepEqual(sent[0], ['ipmsg-peers', [{ key: 'ipmsg:1|a', account: 'a' }]])
  assert.deepEqual(sent[1], ['ipmsg-text', { peerKey: 'ipmsg:1|a', text: 'hi', seq: 1, utf8: true }])
  assert.deepEqual(sent[2], ['ipmsg-file', { id: 'f1', state: 'done' }])

  assert.equal(bridge.sendText('ipmsg:1|a', 'hello'), 42)
  assert.equal(await bridge.sendFile('ipmsg:1|a', 'C:/a.txt'), 'file-1')
  assert.deepEqual(fake.state.texts, [['ipmsg:1|a', 'hello']])
  assert.deepEqual(fake.state.files, [['ipmsg:1|a', 'C:/a.txt']])

  await bridge.stop()
  assert.equal(fake.state.stopped, true)
})
