'use strict'

const DEFAULT_PORT = 2425

function defaultCreateTransport(config, callbacks) {
  const { IpmsgTransport } = require('./dist/index.js')
  return new IpmsgTransport(config, callbacks)
}

function createIpmsgBridge(options) {
  const sendToRenderer = options.sendToRenderer
  const log = options.log || (() => undefined)
  const createTransport = options.createTransport || defaultCreateTransport
  let transport = null

  function requireTransport() {
    if (!transport) throw new Error('IPMSG transport is not started')
    return transport
  }

  async function start(identity) {
    if (transport) return
    const config = {
      name: identity.username || identity.userId || 'Orbit',
      account: identity.userId || identity.username || 'orbit',
      host: options.host || 'orbit-host',
      status: 0,
      port: DEFAULT_PORT,
      bindAddr: '0.0.0.0',
      seeds: [],
      broadcastInterval: 30,
      receiveDir: options.receiveDir,
      autoAccept: true
    }
    const callbacks = {
      onPeers: (peers) => sendToRenderer('ipmsg-peers', peers),
      onText: (text) => sendToRenderer('ipmsg-text', text),
      onTextStatus: (peerKey, seq, status) =>
        sendToRenderer('ipmsg-text-status', { peerKey, seq, status }),
      onFile: (file) => sendToRenderer('ipmsg-file', file),
      onLog: (message) => log('[ipmsg] ' + message),
      onError: (error) => log('[ipmsg] error: ' + (error && error.message ? error.message : String(error)))
    }
    const next = createTransport(config, callbacks)
    try {
      await next.start()
      transport = next
      log('[ipmsg] started on UDP/TCP ' + DEFAULT_PORT)
    } catch (error) {
      log('[ipmsg] start failed: ' + (error && error.message ? error.message : String(error)))
      throw error
    }
  }

  async function stop() {
    const current = transport
    transport = null
    if (current) await current.stop()
  }

  function sendText(peerKey, text) {
    return requireTransport().sendText(peerKey, text)
  }

  function sendFile(peerKey, filePath) {
    return requireTransport().sendFile(peerKey, filePath)
  }

  function acceptFile(id) {
    requireTransport().acceptFile(id)
  }

  function rejectFile(id) {
    requireTransport().rejectFile(id)
  }

  function cancelFile(id) {
    requireTransport().cancelFile(id)
  }

  return { start, stop, sendText, sendFile, acceptFile, rejectFile, cancelFile }
}

module.exports = { createIpmsgBridge }
