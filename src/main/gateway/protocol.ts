/** 网关对外的协议常量；服务端与客户端契约见 docs/gateway-api.md。 */

export const PROTOCOL_VERSION = '1.0'
export const RPC_PATH = '/ws/dsh'
export const MEDIA_PATH = '/media'
export const DEFAULT_RPC_PORT = 9015
export const DEFAULT_RPC_BIND = '127.0.0.1'
export const MAX_RPC_BYTES = 1024 * 1024
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_TEXT_BYTES = 16 * 1024

export const GW_METHODS = {
  usersList: 'users.list',
  sendUser: 'message.sendUser',
  sendGroup: 'message.sendGroup',
  prepareUpload: 'media.prepareUpload',
  eventsAck: 'events.ack',
  eventsResume: 'events.resume'
} as const

export const GW_EVENTS = ['message.received', 'message.deliveryStatus'] as const

export type GwMethod = (typeof GW_METHODS)[keyof typeof GW_METHODS]
export type GwEventName = (typeof GW_EVENTS)[number]
