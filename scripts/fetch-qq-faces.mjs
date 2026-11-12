// 从 koishijs/QFace 的仓库拉取经典 QQ 表情 GIF：node scripts/fetch-qq-faces.mjs <face_config.json> <tree.json> <输出目录>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [configPath, treePath, outDir] = process.argv.slice(2)
if (!configPath || !treePath || !outDir) {
  throw new Error('用法：node scripts/fetch-qq-faces.mjs <face_config.json> <tree.json> <输出目录>')
}

const config = JSON.parse(readFileSync(configPath, 'utf8'))
const tree = JSON.parse(readFileSync(treePath, 'utf8'))
const available = new Set(
  tree.tree
    .map((entry) => entry.path)
    .filter((path) => /^public\/gif\/s\d+\.gif$/.test(path))
    .map((path) => path.split('/').pop())
)

const faces = config.sysface.filter(
  (entry) =>
    /^\d+$/.test(entry.QSid) &&
    !entry.AniStickerType &&
    !entry.isCMEmoji &&
    entry.QHide !== '1' &&
    available.has(`s${entry.QSid}.gif`)
)

mkdirSync(outDir, { recursive: true })
const names = {}
for (const face of faces) {
  const file = `s${face.QSid}.gif`
  const url = `https://raw.githubusercontent.com/koishijs/QFace/master/public/gif/${file}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`下载失败 ${url}: ${response.status}`)
  writeFileSync(join(outDir, file), Buffer.from(await response.arrayBuffer()))
  names[face.QSid] = face.QDes.replace(/^\//, '')
  console.log(`${file} ${names[face.QSid]}`)
}
writeFileSync(join(outDir, 'names.json'), `${JSON.stringify(names, null, 2)}\n`)
console.log(`共 ${faces.length} 个 QQ 表情`)
