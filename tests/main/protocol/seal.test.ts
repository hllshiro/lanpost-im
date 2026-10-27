import { describe, expect, it } from 'vitest'
import {
  CMD_ANSREADMSG,
  CMD_READMSG,
  OPT_READCHECK,
  OPT_SECRET
} from '../../../src/main/protocol/commands'
import { readReceiptCommand, shouldAckRead } from '../../../src/main/protocol/seal'

describe('seal', () => {
  it('requires an acknowledgement when READCHECK is set', () => {
    expect(shouldAckRead(OPT_READCHECK)).toBe(true)
    expect(shouldAckRead(OPT_SECRET)).toBe(false)
  })

  it('answers a read-check with ANSREADMSG', () => {
    expect(readReceiptCommand(CMD_READMSG | OPT_READCHECK)).toBe(CMD_ANSREADMSG)
    expect(readReceiptCommand(CMD_READMSG)).toBe(CMD_READMSG)
  })
})
