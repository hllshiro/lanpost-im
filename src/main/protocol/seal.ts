import { CMD_ANSREADMSG, CMD_READMSG, OPT_READCHECK } from './commands'

export function shouldAckRead(cmd: number): boolean {
  return (cmd & OPT_READCHECK) !== 0
}

// 收到 READMSG 时，带 READCHECK 的读者要求打开确认。
export function readReceiptCommand(inboundCmd: number): number {
  return (inboundCmd & OPT_READCHECK) !== 0 ? CMD_ANSREADMSG : CMD_READMSG
}
