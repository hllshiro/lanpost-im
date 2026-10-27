/* IPMSG peer/message mapping shared by the renderer and unit tests. */
(function (root) {
  function statusOf(peer) {
    if (!peer || peer.online === false) return 'offline'
    if (peer.status === 1) return 'busy'
    if (peer.status === 2) return 'away'
    return 'online'
  }

  function peerToFriend(peer) {
    return {
      userId: 'ipmsg:' + peer.key,
      username: peer.name || peer.account || peer.key,
      usertag: 'IPMSG',
      status: statusOf(peer),
      avatar: null,
      bio: 'IPMSG · ' + (peer.account || ''),
      transport: 'ipmsg',
      ipmsgAccount: peer.account || '',
      ipmsgHost: peer.host || '',
      lastIp: peer.ip || '',
      lastSeen: peer.lastSeen || Date.now()
    }
  }

  function textToPacket(text) {
    var chatId = 'ipmsg:' + text.peerKey
    return {
      type: 'MESSAGE',
      from: chatId,
      timestamp: new Date().toISOString(),
      payload: {
        chatId: chatId,
        text: text.text || '',
        msgId: 'ipmsg:' + text.seq,
        transport: 'ipmsg',
        remoteSeq: text.seq
      }
    }
  }

  function isImageName(name) {
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name || '')
  }

  function fileToPacket(file) {
    var chatId = 'ipmsg:' + file.peerKey
    var type = isImageName(file.name) ? 'image' : 'file'
    return {
      type: 'MESSAGE',
      from: chatId,
      timestamp: new Date().toISOString(),
      payload: {
        chatId: chatId,
        text: '',
        msgId: 'ipmsg-file:' + file.id,
        transport: 'ipmsg',
        attachments: [{
          id: 'ipmsg-file-' + file.id,
          type: type,
          name: file.name,
          size: file.size,
          path: file.path,
          localPath: file.path,
          url: 'orbit-file://' + encodeURIComponent(file.path)
        }]
      }
    }
  }

  var api = { peerToFriend: peerToFriend, textToPacket: textToPacket, fileToPacket: fileToPacket, statusOf: statusOf }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.IpmsgMap = api
})(typeof window !== 'undefined' ? window : globalThis)
