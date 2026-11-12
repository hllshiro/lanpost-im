import { describe, expect, it } from 'vitest'
import {
  fileTimeFromMs,
  groupDismissXml,
  groupKickXml,
  groupPushUserXml,
  groupInfoRspXml,
  groupSendXml,
  handshakeXml,
  heartbeatXml,
  helloFrame,
  messageTextJson,
  operateRecvFileXml,
  operateRecvFolderXml,
  operateSendFileXml,
  parsePrivate,
  progressRecvFileXml,
  quitXml,
  readyXml,
  sendFileXml,
  sendMsgAckXml,
  sendMsgXml,
  sendReceiptXml,
  shareDownloadFolderXml,
  shareDownloadFolderRspXml,
  remindFileXml
} from './messages'
import type { PrivateProfile } from './messages'
import { decodeBeacon } from './beacon'

describe('private messages', () => {
  it('builds X_SEND_MSG with the captured JSON shape', () => {
    const xml = sendMsgXml(7, '你好')
    expect(xml).toContain('<MSG_ID>7</MSG_ID>')
    expect(xml).toContain('<RECEIPT>0</RECEIPT>')
    expect(xml).toContain('&quot;app&quot;&nbsp;:&nbsp;&quot;shiyeline&quot;')
    expect(xml).toContain('&quot;v&quot;&nbsp;:&nbsp;&quot;你好&quot;')
    expect(xml).toContain('<MSG_TIME>0</MSG_TIME><OFFLINE>0</OFFLINE><HIDE_RECORD>0</HIDE_RECORD>')
    expect(parsePrivate(1004, xml)).toEqual({
      kind: 'text',
      msgId: 7,
      text: '你好',
      images: [],
      segments: [{ kind: 'text', text: '你好' }]
    })
  })

  it('parses ack and receipt', () => {
    expect(parsePrivate(1005, sendMsgAckXml(9))).toEqual({ kind: 'ack', msgId: 9 })
    expect(parsePrivate(1006, sendReceiptXml(9))).toEqual({ kind: 'receipt', msgId: 9 })
  })

  it('parses X_READY and heartbeat', () => {
    expect(parsePrivate(1018, readyXml('abc'))).toEqual({ kind: 'ready', userId: 'abc' })
    expect(parsePrivate(1016, heartbeatXml())).toEqual({ kind: 'heartbeat' })
  })

  it('builds a 304-byte type 4 hello', () => {
    const peerId = Buffer.alloc(16, 0x5a)
    const raw = helloFrame({
      ip: '192.168.1.20',
      broadcast: '192.168.1.255',
      userId: '0123456789abcdef0123456789abcdef',
      peerId,
      enetPort: 54321
    })
    expect(raw.length).toBe(304)
    expect(decodeBeacon(raw)).toMatchObject({ type: 4, ip: '192.168.1.20', enetPort: 54321 })
  })

  it('turns a link card into its url', () => {
    const xml =
      '<X_SEND_MSG docver="1"><MSG_ID>6</MSG_ID><RECEIPT>0</RECEIPT><MSG>{&quot;app&quot;:&quot;shiyeline&quot;,&quot;dt&quot;:[{&quot;lnk&quot;:{&quot;v&quot;:&quot;https://example.com/a&quot;}}]}</MSG></X_SEND_MSG>'
    expect(parsePrivate(1004, xml)).toEqual({
      kind: 'text',
      msgId: 6,
      text: 'https://example.com/a',
      images: [],
      segments: []
    })
  })

  it('shows a placeholder for an image and keeps its file id', () => {
    const image =
      '<X_SEND_MSG docver="1"><MSG_ID>3</MSG_ID><RECEIPT>0</RECEIPT><MSG>{&quot;app&quot;:&quot;shiyeline&quot;,&quot;dt&quot;:[{&quot;img&quot;:{&quot;v&quot;:&quot;x&quot;}}]}</MSG></X_SEND_MSG>'
    expect(parsePrivate(1004, image)).toEqual({
      kind: 'text',
      msgId: 3,
      text: '[图片]',
      images: [],
      segments: [{ kind: 'image', value: 'x' }]
    })
    const real =
      '<X_SEND_MSG docver="1"><MSG_ID>5</MSG_ID><RECEIPT>0</RECEIPT><MSG>{&quot;app&quot;:&quot;shiyeline&quot;,&quot;dt&quot;:[{&quot;img&quot;:{&quot;t&quot;:&quot;feihu&quot;,&quot;v&quot;:&quot;5723|6825bf031f45b541a19c305eb5c898a1&quot;}}]}</MSG></X_SEND_MSG>'
    expect(parsePrivate(1004, real)).toEqual({
      kind: 'text',
      msgId: 5,
      text: '[图片]',
      images: [{ id: 5723, type: 'feihu', value: '5723|6825bf031f45b541a19c305eb5c898a1' }],
      segments: [{ kind: 'image', value: '5723|6825bf031f45b541a19c305eb5c898a1' }]
    })
    const unknown =
      '<X_SEND_MSG docver="1"><MSG_ID>4</MSG_ID><RECEIPT>0</RECEIPT><MSG>{&quot;app&quot;:&quot;shiyeline&quot;,&quot;dt&quot;:[{&quot;voip&quot;:{}}]}</MSG></X_SEND_MSG>'
    expect(parsePrivate(1004, unknown)).toEqual({ kind: 'text-unsupported', msgId: 4 })
  })
})

describe('private messages round-trip', () => {
  it('falls back to a non-empty group because the sample rejects a blank one', () => {
    const xml = handshakeXml(
      { name: '本机', group: '  ', corporation: '', department: '', sign: '', status: 0 },
      '0123456789abcdef0123456789abcdef'
    )
    expect(xml).toContain('<GROUP>Default</GROUP>')
    expect(parsePrivate(1000, xml)).toMatchObject({
      kind: 'handshake',
      profile: { group: 'Default' }
    })
  })

  it('round-trips a handshake that enables MSG, FILE_TRAN and HIDE_RECORD', () => {
    const profile: PrivateProfile = {
      name: '本机',
      group: '研发部',
      corporation: '示例公司',
      department: '一组',
      sign: '在线',
      status: 1
    }
    const userId = '0123456789abcdef0123456789abcdef'
    const xml = handshakeXml(profile, userId, 9013)
    expect(xml).toContain('<MSG>2:1</MSG>')
    expect(xml).toContain('<HIDE_RECORD>1</HIDE_RECORD>')
    expect(xml).toContain('<FILE_TRAN>1</FILE_TRAN>')
    expect(xml).toContain('<FILE_TRAN_TCP_PORT>9013</FILE_TRAN_TCP_PORT>')
    expect(xml).toContain('<FILE_TRAN_TCP_REVERSE_PORT>9013</FILE_TRAN_TCP_REVERSE_PORT>')
    expect(xml).toContain(`<CORP_ID>${userId}</CORP_ID>`)
    expect(parsePrivate(1000, xml)).toEqual({
      kind: 'handshake',
      profile: { ...profile, userId },
      filePort: 9013,
      reversePort: 9013,
      folderPort: 0,
      folderReversePort: 0
    })
  })

  it('round-trips the folder ports in the handshake', () => {
    const profile: PrivateProfile = {
      name: '本机',
      group: '研发部',
      corporation: '',
      department: '',
      sign: '',
      status: 0
    }
    const xml = handshakeXml(profile, '0123456789abcdef0123456789abcdef', 9013, 9014)
    expect(xml).toContain('<FOLDER_TRAN_TCP_PORT>9014</FOLDER_TRAN_TCP_PORT>')
    expect(xml).toContain('<FOLDER_TRAN_TCP_REVERSE_PORT>9014</FOLDER_TRAN_TCP_REVERSE_PORT>')
    expect(parsePrivate(1000, xml)).toMatchObject({ folderPort: 9014, folderReversePort: 9014 })
  })

  it('parses a folder invite and the receive-side operation', () => {
    const xml =
      '<X_SEND_FOLDER docver="1"><TASK_ID>fc8467cf</TASK_ID><FOLDER_NAME>资料</FOLDER_NAME>' +
      '<FOLDER_SIZE>4372509</FOLDER_SIZE><MAX_ITEM_PATH>41</MAX_ITEM_PATH>' +
      '<MAX_ITEM_SIZE>4073951</MAX_ITEM_SIZE><OFFLINE>0</OFFLINE></X_SEND_FOLDER>'
    expect(parsePrivate(1013, xml)).toEqual({
      kind: 'folder-offer',
      offer: {
        taskId: 'fc8467cf',
        name: '资料',
        size: 4372509,
        maxItemPath: 41,
        maxItemSize: 4073951
      }
    })

    const operate = parsePrivate(1015, operateRecvFolderXml('fc8467cf', 2))
    expect(operate).toEqual({
      kind: 'folder-operate',
      cmd: 1015,
      taskId: 'fc8467cf',
      op: 2
    })
  })

  it('parses X_QUIT', () => {
    expect(parsePrivate(1017, quitXml())).toEqual({ kind: 'quit' })
  })

  it('keeps spaces and XML characters from the message text', () => {
    const text = 'a b<c>'
    const xml = sendMsgXml(11, text)
    expect(xml).toContain('&quot;a&nbsp;b&lt;c&gt;&quot;')
    expect(parsePrivate(1004, xml)).toEqual({
      kind: 'text',
      msgId: 11,
      text,
      images: [],
      segments: [{ kind: 'text', text }]
    })
  })

  it('keeps quotes in the message text', () => {
    const text = 'say "hi"'
    const xml = sendMsgXml(13, text)
    expect(parsePrivate(1004, xml)).toEqual({
      kind: 'text',
      msgId: 13,
      text,
      images: [],
      segments: [{ kind: 'text', text }]
    })
  })

  it('concatenates every text segment', () => {
    const xml =
      '<X_SEND_MSG docver="1"><MSG_ID>4</MSG_ID><RECEIPT>0</RECEIPT><MSG>{&quot;app&quot;:&quot;shiyeline&quot;,&quot;dt&quot;:[{&quot;txt&quot;:{&quot;t&quot;:&quot;normal&quot;,&quot;v&quot;:&quot;a&quot;}},{&quot;img&quot;:{&quot;v&quot;:&quot;x&quot;}},{&quot;txt&quot;:{&quot;t&quot;:&quot;normal&quot;,&quot;v&quot;:&quot;b&quot;}}]}</MSG></X_SEND_MSG>'
    expect(parsePrivate(1004, xml)).toEqual({
      kind: 'text',
      msgId: 4,
      text: 'a[图片]b',
      images: [],
      segments: [
        { kind: 'text', text: 'a' },
        { kind: 'image', value: 'x' },
        { kind: 'text', text: 'b' }
      ]
    })
  })

  it('returns other instead of throwing on malformed input', () => {
    expect(parsePrivate(1004, '<X_HEARTBEAT docver="1" />')).toEqual({ kind: 'other', cmd: 1004 })
    expect(parsePrivate(1004, '<X_SEND_MSG docver="1"><MSG_ID>1</MSG_ID>')).toEqual({
      kind: 'other',
      cmd: 1004
    })
    expect(
      parsePrivate(1006, '<X_SEND_RECEIPT docver="1"><MSG_ID>abc</MSG_ID></X_SEND_RECEIPT>')
    ).toEqual({ kind: 'other', cmd: 1006 })
    expect(parsePrivate(1008, 'plain text')).toEqual({ kind: 'other', cmd: 1008 })
  })

  it('writes the captured self-closing heartbeat and quit', () => {
    expect(heartbeatXml()).toBe('<X_HEARTBEAT docver="1" />')
    expect(Buffer.byteLength(heartbeatXml(), 'utf8')).toBe(26)
    expect(quitXml()).toBe('<X_QUIT docver="1" />')
  })

  it('writes the json body with escaped spaces and quotes', () => {
    const json = messageTextJson('你好')
    expect(json).toContain('&quot;app&quot;&nbsp;:&nbsp;&quot;shiyeline&quot;')
    expect(json).toContain('&quot;n&quot;&nbsp;:&nbsp;&quot;微软雅黑&quot;')
    expect(json).toContain('&quot;s&quot;&nbsp;:&nbsp;&quot;9&quot;')
    expect(json).toContain('&quot;ver&quot;&nbsp;:&nbsp;&quot;6.0&quot;')
    expect(json).toContain('&quot;v&quot;&nbsp;:&nbsp;&quot;你好&quot;')
    expect(json).toMatch(/&quot;id&quot;&nbsp;:&nbsp;&quot;[0-9a-f]{32}&quot;/)
    expect(json.startsWith('{')).toBe(true)
    expect(json.endsWith('}')).toBe(true)
  })
})

describe('private file messages', () => {
  it('round-trips X_SEND_FILE with the captured fields', () => {
    const xml = sendFileXml({
      taskId: '1',
      fileId: 10932,
      name: 'C:\\Users\\xqkj\\Desktop\\流程.txt',
      size: 2441,
      lastModify: '134339123560000000'
    })
    expect(xml).toContain('<TASK_ID>1</TASK_ID>')
    expect(xml).toContain('<FILE_ID>10932</FILE_ID>')
    expect(xml).toContain('<SIZE>2441</SIZE>')
    expect(xml).toContain('<LAST_MODIFY>134339123560000000</LAST_MODIFY>')
    expect(parsePrivate(1009, xml)).toEqual({
      kind: 'file-offer',
      offer: {
        taskId: '1',
        fileId: 10932,
        name: 'C:\\Users\\xqkj\\Desktop\\流程.txt',
        size: 2441,
        lastModify: '134339123560000000'
      }
    })
  })

  it('round-trips the operate and progress commands', () => {
    expect(parsePrivate(1010, operateSendFileXml('7', 2))).toEqual({
      kind: 'file-operate',
      cmd: 1010,
      taskId: '7',
      op: 2
    })
    expect(parsePrivate(1011, operateRecvFileXml('7', 2))).toEqual({
      kind: 'file-operate',
      cmd: 1011,
      taskId: '7',
      op: 2
    })
    expect(parsePrivate(1012, progressRecvFileXml('7', 2441, 2441, '未知速度'))).toEqual({
      kind: 'file-progress',
      taskId: '7',
      totalSize: 2441,
      recvdSize: 2441
    })
  })

  it('converts milliseconds to a windows file time string', () => {
    expect(fileTimeFromMs(0)).toBe('116444736000000000')
    expect(fileTimeFromMs(1_700_000_000_000)).toBe('133444736000000000')
  })
})

describe('private group messages', () => {
  // 抓包原文：真实客户端建群时推送的成员列表
  const pushUser =
    '<X_QGROUP_PUSH_USER docver="1"><INFO><QGROUP_ID>3793f2276684a242a0b0aabc68b3660b</QGROUP_ID>' +
    '<QGROUP_NAME>上网机PC3，笔记本2</QGROUP_NAME><QGROUP_MASTER>68e24da0fa70794981775dd7dbfb7c6f</QGROUP_MASTER>' +
    '<QGROUP_INTR></QGROUP_INTR><QGROUP_ANN></QGROUP_ANN><QGROUP_INFO_VER>2</GROUP_INFO_VER>' +
    '<QGROUP_USER_VER>2</QGROUP_USER_VER><QGROUP_ALLOW_OTHER_ADD>0</QGROUP_ALLOW_OTHER_ADD>' +
    '<QGROUP_PHOTO_MD5></QGROUP_PHOTO_MD5></INFO><USER><ID name="笔记本2">3d2f84b92bd3d542839590568661971c</ID>' +
    '<ID name="上网机PC3">68e24da0fa70794981775dd7dbfb7c6f</ID></USER></X_QGROUP_PUSH_USER>'

  it('parses the group info and member list even with the broken closing tag', () => {
    const parsed = parsePrivate(3003, pushUser)
    expect(parsed).toEqual({
      kind: 'group-user',
      info: {
        id: '3793f2276684a242a0b0aabc68b3660b',
        name: '上网机PC3，笔记本2',
        master: '68e24da0fa70794981775dd7dbfb7c6f',
        topic: '',
        announcement: '',
        infoVersion: 2,
        userVersion: 2,
        allowOtherAdd: 0,
        photoMd5: ''
      },
      members: [
        { name: '笔记本2', userId: '3d2f84b92bd3d542839590568661971c' },
        { name: '上网机PC3', userId: '68e24da0fa70794981775dd7dbfb7c6f' }
      ]
    })
  })

  it('parses a group message and keeps its text', () => {
    const xml = groupSendXml('3793f2276684a242a0b0aabc68b3660b', 7, '大家好')
    const parsed = parsePrivate(3011, xml)
    expect(parsed).toEqual({
      kind: 'group-message',
      groupId: '3793f2276684a242a0b0aabc68b3660b',
      msgId: 7,
      text: '大家好',
      images: [],
      files: [],
      segments: [{ kind: 'text', text: '大家好' }]
    })
  })

  it('builds a push frame the real client can parse', () => {
    const xml = groupPushUserXml(
      {
        id: '3793f2276684a242a0b0aabc68b3660b',
        name: '测试群',
        master: '68e24da0fa70794981775dd7dbfb7c6f',
        topic: '',
        announcement: '',
        infoVersion: 1,
        userVersion: 1,
        allowOtherAdd: 0,
        photoMd5: ''
      },
      [{ name: '笔记本2', userId: '3d2f84b92bd3d542839590568661971c' }]
    )
    expect(xml).toContain('<QGROUP_INFO_VER>1</GROUP_INFO_VER>')
    expect(parsePrivate(3003, xml)).toMatchObject({ kind: 'group-user' })
  })

  it('parses dismiss, exit and kick frames with only the group id', () => {
    expect(
      parsePrivate(
        3008,
        '<X_QGROUP_DISMISS docver="1"><QGROUP_ID>g1</QGROUP_ID></X_QGROUP_DISMISS>'
      )
    ).toEqual({ kind: 'group-dismiss', groupId: 'g1' })
    expect(
      parsePrivate(3009, '<X_QGROUP_EXIT docver="1"><QGROUP_ID>g2</QGROUP_ID></X_QGROUP_EXIT>')
    ).toEqual({ kind: 'group-exit', groupId: 'g2' })
    expect(
      parsePrivate(3010, '<X_QGROUP_KICK docver="1"><QGROUP_ID>g3</QGROUP_ID></X_QGROUP_KICK>')
    ).toEqual({ kind: 'group-kick', groupId: 'g3' })
  })

  it('parses a group info response and answers with the same shape', () => {
    const info = {
      id: '7ad4b2b4f0213b4a832fc807632bc23b',
      name: '上网机 笔记本',
      master: '3d2f84b92bd3d542839590568661971c',
      topic: '',
      announcement: '',
      infoVersion: 2,
      userVersion: 2,
      allowOtherAdd: 0,
      photoMd5: ''
    }
    const parsed = parsePrivate(3005, groupInfoRspXml(info))
    expect(parsed).toEqual({ kind: 'group-info-rsp', ret: 20, groupId: info.id, info })
  })

  it('treats a response without INFO as a missing group', () => {
    const parsed = parsePrivate(
      3005,
      '<X_QGROUP_REQ_INFO_RSP docver="1"><RET>10</RET><QGROUP_ID>gone</QGROUP_ID></X_QGROUP_REQ_INFO_RSP>'
    )
    expect(parsed).toEqual({ kind: 'group-info-rsp', ret: 10, groupId: 'gone', info: null })
  })

  it('decodes &nbsp; and other entities in group fields', () => {
    const xml =
      '<X_QGROUP_PUSH_USER docver="1"><INFO><QGROUP_ID>g1</QGROUP_ID>' +
      '<QGROUP_NAME>上网机&nbsp;笔记本</QGROUP_NAME><QGROUP_MASTER>m1</QGROUP_MASTER>' +
      '<QGROUP_INTR>主题&amp;备注</QGROUP_INTR><QGROUP_ANN>公告&nbsp;一</QGROUP_ANN>' +
      '<QGROUP_INFO_VER>2</GROUP_INFO_VER><QGROUP_USER_VER>2</QGROUP_USER_VER>' +
      '<QGROUP_ALLOW_OTHER_ADD>0</QGROUP_ALLOW_OTHER_ADD><QGROUP_PHOTO_MD5></QGROUP_PHOTO_MD5>' +
      '</INFO><USER><ID name="上网机&nbsp;笔记本">u1</ID></USER></X_QGROUP_PUSH_USER>'
    expect(parsePrivate(3003, xml)).toEqual({
      kind: 'group-user',
      info: {
        id: 'g1',
        name: '上网机 笔记本',
        master: 'm1',
        topic: '主题&备注',
        announcement: '公告 一',
        infoVersion: 2,
        userVersion: 2,
        allowOtherAdd: 0,
        photoMd5: ''
      },
      members: [{ name: '上网机 笔记本', userId: 'u1' }]
    })
  })

  it('builds dismiss and kick frames that parse back to the same group', () => {
    expect(parsePrivate(3008, groupDismissXml('g1'))).toEqual({
      kind: 'group-dismiss',
      groupId: 'g1'
    })
    expect(parsePrivate(3010, groupKickXml('g2'))).toEqual({
      kind: 'group-kick',
      groupId: 'g2'
    })
  })

  it('parses the group folder request and response', () => {
    expect(parsePrivate(5006, shareDownloadFolderXml(1, 'share1', 'chan1'))).toEqual({
      kind: 'share-download-folder',
      reqId: 1,
      shareId: 'share1',
      channelId: 'chan1'
    })
    expect(parsePrivate(5007, shareDownloadFolderRspXml(1, 'chan1'))).toEqual({
      kind: 'share-download-folder-rsp',
      reqId: 1,
      err: 0,
      channelId: 'chan1'
    })
  })

  it('marks the remind frame as a folder when FILE is 0', () => {
    expect(parsePrivate(1025, remindFileXml('g1', 120, 'C:\\ces', true))).toEqual({
      kind: 'remind-file',
      groupId: 'g1',
      name: 'C:\\ces',
      size: 120,
      folder: true
    })
    expect(parsePrivate(1025, remindFileXml('g1', 120, 'C:\\a.txt', false))).toMatchObject({
      folder: false
    })
  })
})
