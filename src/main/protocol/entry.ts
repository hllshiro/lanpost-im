import { decodeText, encodeGbkLossy } from './encoding'
import { splitNul } from './packet'

export interface EntryInput {
  name: string
  group: string
  account: string
  host: string
  version: string
}

export interface ParsedEntry {
  name: string
  group: string
  account: string
  host: string
  version: string
}

const NUL = Buffer.from([0])
const NEWLINE = '\n'

function hexEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('hex')
}

function hexDecode(value: string): string {
  if (value.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(value)) {
    return value
  }
  return Buffer.from(value, 'hex').toString('utf8')
}

export function encodeEntry(input: EntryInput): Buffer {
  const legacy = Buffer.concat([encodeGbkLossy(input.name), NUL, encodeGbkLossy(input.group), NUL])
  const extended = [
    '',
    `UN:${input.account}`,
    `HN:${input.host}`,
    `NN:${input.name}`,
    `GN:${input.group}`,
    `VS:${hexEncode(input.version)}`
  ].join(NEWLINE)
  return Buffer.concat([legacy, Buffer.from(extended, 'utf8')])
}

export function parseEntry(payload: Buffer): ParsedEntry {
  const fields = splitNul(payload)
  const legacyName = fields[0] !== undefined ? decodeText(fields[0], false) : ''
  const legacyGroup = fields[1] !== undefined ? decodeText(fields[1], false) : ''
  const parsed: ParsedEntry = {
    name: legacyName,
    group: legacyGroup,
    account: '',
    host: '',
    version: ''
  }
  const extensionField = fields.find((field) => field.length > 0 && field[0] === 0x0a)
  if (extensionField === undefined) {
    return parsed
  }
  const lines = extensionField.toString('utf8').split(NEWLINE)
  for (const line of lines) {
    if (line.startsWith('UN:')) parsed.account = line.slice(3)
    else if (line.startsWith('HN:')) parsed.host = line.slice(3)
    else if (line.startsWith('NN:')) parsed.name = line.slice(3)
    else if (line.startsWith('GN:')) parsed.group = line.slice(3)
    else if (line.startsWith('VS:')) parsed.version = hexDecode(line.slice(3))
  }
  return parsed
}
