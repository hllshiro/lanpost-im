const IPC_WRAPPER = /^Error invoking remote method '[^']*':\s*/i
const ERROR_PREFIX = /^(?:Error:\s*)+/i

// Electron 会把主进程异常包成 "Error invoking remote method 'x': Error: 消息"，
// 界面只展示业务消息，去掉 IPC 前缀与 Error 类型名。
export function errorMessage(reason: unknown): string {
  let text: string
  if (reason instanceof Error) {
    text = reason.message
  } else if (typeof reason === 'string') {
    text = reason
  } else if (typeof reason === 'object' && reason !== null && 'message' in reason) {
    const message = (reason as { message?: unknown }).message
    text = typeof message === 'string' ? message : String(reason)
  } else if (reason === undefined || reason === null) {
    text = ''
  } else {
    text = String(reason)
  }
  text = text.replace(IPC_WRAPPER, '').replace(ERROR_PREFIX, '').trim()
  return text === '' ? '操作失败' : text
}
