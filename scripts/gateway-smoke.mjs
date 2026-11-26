#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type -- 纯 JS 冒烟脚本没有类型注解 */
// 网关冒烟脚本：Node 24 + rpc-websockets 客户端，用来验真实例的认证、联系人、发送与图片通道。
// 用法：
//   node scripts/gateway-smoke.mjs --url ws://127.0.0.1:8443/ws/dsh --token <token> list
//   node scripts/gateway-smoke.mjs ... send <protocol_id> "hello"
//   node scripts/gateway-smoke.mjs ... listen
//   node scripts/gateway-smoke.mjs ... upload ./a.png [protocol_id]
// 令牌也可以用环境变量 LANPOST_GATEWAY_TOKEN 提供；脚本不会打印令牌。

import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { request as httpRequest } from 'node:http'
import { Client } from 'rpc-websockets'

const DEFAULT_URL = 'ws://127.0.0.1:8443/ws/dsh'
const TIMEOUT_MS = 10_000
const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

function usage() {
  console.error(
    [
      '用法: node scripts/gateway-smoke.mjs [--url <ws://...>] [--token <token>] <命令>',
      '',
      '命令:',
      '  list                       列出联系人',
      '  send <protocol_id> <text>  给联系人发文字',
      '  listen                     订阅并打印事件（Ctrl+C 退出）',
      '  upload <file> [protocol_id] 上传图片，可选地发给联系人'
    ].join('\n')
  )
  process.exit(1)
}

function parseArgs(argv) {
  const options = { url: process.env.LANPOST_GATEWAY_URL ?? DEFAULT_URL, token: '' }
  const rest = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--url') {
      options.url = argv[++index]
    } else if (arg === '--token') {
      options.token = argv[++index]
    } else if (arg === '--help' || arg === '-h') {
      usage()
    } else {
      rest.push(arg)
    }
  }
  options.token = options.token || process.env.LANPOST_GATEWAY_TOKEN || ''
  return { options, command: rest[0], args: rest.slice(1) }
}

function timeout(promise, label) {
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超时（${TIMEOUT_MS}ms）`)), TIMEOUT_MS)
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

async function connect(options) {
  if (options.token === '') {
    throw new Error('缺少 --token 或 LANPOST_GATEWAY_TOKEN')
  }
  const client = new Client(options.url, {
    autoconnect: true
  })
  await timeout(
    new Promise((resolve, reject) => {
      client.once('open', resolve)
      client.once('error', reject)
    }),
    '连接'
  )
  const ok = await timeout(client.login({ token: options.token }), 'rpc.login')
  if (ok !== true) throw new Error('rpc.login 未返回 true')
  return client
}

async function list(client) {
  const result = await timeout(
    client.call('users.list', { page: 1, page_size: 50, online: null }),
    'users.list'
  )
  console.log(`共 ${result.total} 个联系人：`)
  for (const user of result.users) {
    console.log(
      `${user.online ? '●' : '○'} ${user.display_name || user.username}  ${user.protocol_id}  ${
        user.hostname || ''
      }`
    )
  }
}

async function send(client, protocolId, text) {
  const result = await timeout(
    client.call('message.sendUser', {
      request_id: randomUUID(),
      protocol_id: protocolId,
      content: { type: 'text', text }
    }),
    'message.sendUser'
  )
  console.log(JSON.stringify(result, null, 2))
}

async function listen(client) {
  await timeout(client.subscribe(['message.received', 'message.deliveryStatus']), 'subscribe')
  const resume = await timeout(client.call('events.resume', { last_sequence: 0 }), 'events.resume')
  for (const event of resume.events) console.log(JSON.stringify(event))
  const ack = (event) =>
    client
      .call('events.ack', { event_id: event.event_id, sequence: event.sequence })
      .catch((error) => console.error('ack 失败', error.message))
  client.on('message.received', (event) => {
    console.log(JSON.stringify(event))
    void ack(event)
  })
  client.on('message.deliveryStatus', (event) => {
    console.log(JSON.stringify(event))
    void ack(event)
  })
  console.log('已订阅 message.received / message.deliveryStatus，Ctrl+C 退出')
  await new Promise(() => {})
}

function postMedia(options, file, transfer, sha256, size, mimeType) {
  const target = new URL(options.url)
  const body = readFileSync(file)
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: target.hostname,
        port: Number(target.port || 8443),
        path: '/media',
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.token}`,
          'x-transfer-id': transfer,
          'x-sha256': sha256,
          'content-type': mimeType,
          'x-name': encodeURIComponent(basename(file)),
          'content-length': size
        }
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          if ((res.statusCode ?? 500) >= 300) {
            reject(new Error(`上传失败 HTTP ${res.statusCode}: ${text}`))
            return
          }
          resolve(JSON.parse(text))
        })
      }
    )
    req.on('error', reject)
    req.end(body)
  })
}

async function upload(client, options, file, protocolId) {
  const mimeType = MIME_BY_EXT[extname(file).toLowerCase()]
  if (mimeType === undefined) throw new Error(`不支持的图片扩展名: ${extname(file)}`)
  const body = readFileSync(file)
  const sha256 = createHash('sha256').update(body).digest('hex')
  const prepared = await timeout(
    client.call('media.prepareUpload', {
      mime_type: mimeType,
      name: basename(file),
      size: body.length,
      sha256
    }),
    'media.prepareUpload'
  )
  const uploaded = await timeout(
    postMedia(options, file, prepared.transfer_id, sha256, body.length, mimeType),
    'POST /media'
  )
  console.log(`attachment_id=${uploaded.attachment_id}`)
  if (protocolId !== undefined) {
    const result = await timeout(
      client.call('message.sendUser', {
        request_id: randomUUID(),
        protocol_id: protocolId,
        content: {
          type: 'image',
          attachment_id: uploaded.attachment_id,
          mime_type: mimeType,
          name: basename(file),
          size: body.length,
          sha256
        }
      }),
      'message.sendUser(image)'
    )
    console.log(JSON.stringify(result, null, 2))
  }
}

async function main() {
  const { options, command, args } = parseArgs(process.argv.slice(2))
  if (command === undefined) usage()
  const client = await connect(options)
  try {
    switch (command) {
      case 'list':
        await list(client)
        break
      case 'send':
        if (args.length < 2) usage()
        await send(client, args[0], args.slice(1).join(' '))
        break
      case 'listen':
        await listen(client)
        break
      case 'upload':
        if (args.length < 1) usage()
        await upload(client, options, args[0], args[1])
        break
      default:
        usage()
    }
  } finally {
    if (command !== 'listen') client.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
