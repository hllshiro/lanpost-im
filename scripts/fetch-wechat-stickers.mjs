// 从 Liadrins/WeChat-Emoticon 拉取微信动图表情：node scripts/fetch-wechat-stickers.mjs <tree.json> <输出目录> <表情包目录...>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [treePath, outDir, ...packs] = process.argv.slice(2)
if (!treePath || !outDir || packs.length === 0) {
  throw new Error(
    '用法：node scripts/fetch-wechat-stickers.mjs <tree.json> <输出目录> <表情包目录...>'
  )
}

const tree = JSON.parse(readFileSync(treePath, 'utf8')).tree

async function fetchWithRetry(url) {
  let lastError = null
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return response
      lastError = new Error(`下载失败 ${url}: ${response.status}`)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

for (const pack of packs) {
  const files = tree.filter(
    (entry) => entry.path.startsWith(`WeChat-Emoticons/${pack}/`) && /\.gif$/i.test(entry.path)
  )
  if (files.length === 0) throw new Error(`表情包里没有 GIF：${pack}`)
  const target = join(outDir, pack)
  mkdirSync(target, { recursive: true })
  for (const file of files) {
    const name = file.path.split('/').pop()
    const url = `https://raw.githubusercontent.com/Liadrins/WeChat-Emoticon/master/${file.path
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/')}`
    const response = await fetchWithRetry(url)
    writeFileSync(join(target, name), Buffer.from(await response.arrayBuffer()))
    console.log(`${pack}/${name}`)
  }
  console.log(`${pack}：${files.length} 个 GIF`)
}
