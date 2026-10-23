import { describe, expect, it } from 'vitest'
import {
  decodeXml,
  encodeChangeInfo,
  encodeChangeSign,
  encodeChangeStatus,
  encodeChatMsg,
  encodeChatMsgAck,
  encodeChatReceipt,
  encodeHandshake,
  encodeHeartbeat,
  encodeQuit,
  encodeReady,
  rootTag,
  type ChangeInfo,
  type Handshake,
  type UserInfo
} from './xml'

const EMPTY_PORTS = {
  FileTranTCPPort: 0,
  FileTranEnetPort: 0,
  FolderTranTCPPort: 0,
  FolderTranEnetPort: 0,
  FileTranTCPReversePort: 0,
  FileTranEnetReversePort: 0,
  FolderTranTCPReversePort: 0,
  FolderTranEnetReversePort: 0,
  LanUpdateHTTPPort: 0
}

const EMPTY_FEATURE = {
  Major: '',
  Minor: '',
  Build: '',
  App: '',
  Msg: '',
  FileTran: '',
  FolderTran: '',
  RemoteAssistance: '',
  FileShare: '',
  QGroup: '',
  QGroupMsg: '',
  QGroupFile: '',
  QGroupFolder: '',
  OfflineMsg: '',
  OfflineFile: '',
  LanUpdate: '',
  HideRecord: ''
}

function userInfo(patch: Partial<UserInfo> = {}): UserInfo {
  return {
    CorpID: '',
    CorpTime: 0,
    Name: '',
    Group: '',
    Corporation: '',
    Department: '',
    Sex: 0,
    Post: '',
    Tel: '',
    Mobile: '',
    Email: '',
    Sign: '',
    SysFace: 0,
    Status: 0,
    ActiveSend: 0,
    OnlinePopup: 0,
    HideIP: 0,
    ColorName: 0,
    SortName: 0,
    DecorateName: 0,
    ...patch
  }
}

describe('private XML messages', () => {
  it('encodes X_SEND_MSG exactly like the Go reference', () => {
    const xml = encodeChatMsg({
      Docver: 1,
      MsgID: 7,
      Receipt: 1,
      Msg: '你好',
      MsgTime: 1700000000,
      Offline: 0,
      HideRecord: 0
    })
    expect(xml).toBe(
      '<X_SEND_MSG docver="1"><MSG_ID>7</MSG_ID><RECEIPT>1</RECEIPT><MSG>你好</MSG><MSG_TIME>1700000000</MSG_TIME><OFFLINE>0</OFFLINE><HIDE_RECORD>0</HIDE_RECORD></X_SEND_MSG>'
    )
    const decoded = decodeXml(Buffer.from(xml, 'utf8'), 'X_SEND_MSG')
    expect(decoded).toEqual({
      Docver: 1,
      MsgID: 7,
      Receipt: 1,
      Msg: '你好',
      MsgTime: 1700000000,
      Offline: 0,
      HideRecord: 0
    })
  })

  it('escapes XML characters in chat text', () => {
    const text = 'a<b>&"c"'
    const xml = encodeChatMsg({
      Docver: 1,
      MsgID: 8,
      Receipt: 1,
      Msg: text,
      MsgTime: 1,
      Offline: 0,
      HideRecord: 0
    })
    expect(xml).toContain('a&lt;b&gt;&amp;&quot;c&quot;')
    expect(decodeXml(xml, 'X_SEND_MSG')?.Msg).toBe(text)
  })

  it('decodes a handshake from the reference client', () => {
    const body =
      '<X_HANDSHARK docver="1"><FEATURE><MAJOR>3</MAJOR><MINOR>4</MINOR><BUILD>3055</BUILD><APP>1</APP><MSG>1</MSG><FILE_TRAN>1</FILE_TRAN></FEATURE><INFO><NAME>张三</NAME><GROUP>研发部</GROUP><STATUS>0</STATUS></INFO><NET><FILE_TRAN_TCP_PORT>9012</FILE_TRAN_TCP_PORT><FILE_TRAN_ENET_PORT>9011</FILE_TRAN_ENET_PORT></NET></X_HANDSHARK>'
    const handshake = decodeXml(body, 'X_HANDSHARK')
    expect(handshake?.Info.Name).toBe('张三')
    expect(handshake?.Info.Group).toBe('研发部')
    expect(handshake?.Net.FileTranTCPPort).toBe(9012)
    expect(handshake?.Net.FileTranEnetPort).toBe(9011)
    expect(handshake?.Feature.Build).toBe('3055')
  })

  it('round-trips a full handshake including NET and USER_FACE', () => {
    const handshake: Handshake = {
      Docver: 1,
      Feature: {
        Major: '3',
        Minor: '4',
        Build: '3055',
        App: '1',
        Msg: '1',
        FileTran: '1',
        FolderTran: '1',
        RemoteAssistance: '0',
        FileShare: '0',
        QGroup: '1',
        QGroupMsg: '1',
        QGroupFile: '0',
        QGroupFolder: '0',
        OfflineMsg: '0',
        OfflineFile: '0',
        LanUpdate: '0',
        HideRecord: '0'
      },
      Info: userInfo({
        CorpID: 'corp-1',
        Name: '张三',
        Group: '研发部',
        Corporation: '内网通',
        Department: '平台组',
        Sign: '在工位',
        Status: 1,
        UserFace: { ID: 9, Data: 'face' }
      }),
      Net: { ...EMPTY_PORTS, FileTranTCPPort: 2425, FileTranEnetPort: 2425 }
    }
    const xml = encodeHandshake(handshake)
    expect(xml).toContain('<USER_FACE id="9">face</USER_FACE>')
    expect(decodeXml(xml, 'X_HANDSHARK')).toEqual(handshake)
  })

  it('round-trips status, sign and info changes', () => {
    const status = { Docver: 1, Status: 2 }
    expect(decodeXml(encodeChangeStatus(status), 'X_CHANGE_STATUS')).toEqual(status)

    const sign = { Docver: 1, Sign: '外出中' }
    expect(decodeXml(encodeChangeSign(sign), 'X_CHANGE_SIGN')).toEqual(sign)

    const info: ChangeInfo = {
      Docver: 1,
      ...userInfo({ Name: '李四', Group: '测试部', Sign: '调试', Status: 1 })
    }
    const xml = encodeChangeInfo(info)
    expect(xml.startsWith('<X_CHANGE_INFO docver="1"><CORP_ID>')).toBe(true)
    expect(decodeXml(xml, 'X_CHANGE_INFO')).toEqual(info)
  })

  it('round-trips heartbeat, ready, quit, ack and receipt', () => {
    expect(decodeXml(encodeHeartbeat({ Docver: 1 }), 'X_HEARTBEAT')).toEqual({ Docver: 1 })
    expect(decodeXml(encodeQuit({ Docver: 1 }), 'X_QUIT')).toEqual({ Docver: 1 })
    expect(decodeXml(encodeReady({ Docver: 1, UserID: 'abc', Param: 0 }), 'X_READY')).toEqual({
      Docver: 1,
      UserID: 'abc',
      Param: 0
    })
    expect(decodeXml(encodeChatMsgAck({ Docver: 1, MsgID: 11 }), 'X_SEND_MSG_ACK')).toEqual({
      Docver: 1,
      MsgID: 11
    })
    expect(decodeXml(encodeChatReceipt({ Docver: 1, MsgID: 12 }), 'X_SEND_RECEIPT')).toEqual({
      Docver: 1,
      MsgID: 12
    })
  })

  it('returns null when the root tag does not match', () => {
    const xml = encodeHeartbeat({ Docver: 1 })
    expect(decodeXml(xml, 'X_QUIT')).toBeNull()
    expect(decodeXml('plain text', 'X_HEARTBEAT')).toBeNull()
  })

  it('extracts the root tag', () => {
    expect(rootTag('<X_HEARTBEAT docver="1" />')).toBe('X_HEARTBEAT')
    expect(rootTag('<X_READY docver="1"><USER_ID>a</USER_ID></X_READY>')).toBe('X_READY')
    expect(rootTag('plain text')).toBe('')
    expect(rootTag('<?xml version="1.0"?><X_QUIT docver="1"></X_QUIT>')).toBe('xml')
  })

  it('throws on malformed XML with the expected root tag', () => {
    expect(() =>
      decodeXml('<X_SEND_MSG docver="1"><MSG>未闭合</X_SEND_MSG>', 'X_SEND_MSG')
    ).toThrow()
  })

  it('exposes empty feature defaults when decoding a reduced handshake', () => {
    const xml = '<X_HANDSHARK docver="1"><INFO><NAME>甲</NAME></INFO></X_HANDSHARK>'
    const decoded = decodeXml(xml, 'X_HANDSHARK')
    expect(decoded?.Feature).toEqual(EMPTY_FEATURE)
    expect(decoded?.Info).toEqual(userInfo({ Name: '甲' }))
    expect(decoded?.Net).toEqual(EMPTY_PORTS)
  })
})
