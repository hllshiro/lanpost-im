// 从内网通安装目录的 Emotion 表生成表情清单：node scripts/gen-emotion.mjs <Emotion 目录>
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const source = process.argv[2]
if (!source) throw new Error('用法：node scripts/gen-emotion.mjs <Emotion 目录>')

const xml = readFileSync(join(source, 'Emotion.xml'), 'utf8')
const target = join('src', 'renderer', 'src', 'assets', 'emotion')
mkdirSync(target, { recursive: true })

const entries = []
for (const group of xml.matchAll(/<EmotionGroup Name="([^"]*)"[^>]*>([\s\S]*?)<\/EmotionGroup>/g)) {
  const [, name, body] = group
  for (const item of body.matchAll(/<Emotion ([^>]*)\/>/g)) {
    const attrs = Object.fromEntries(
      [...item[1].matchAll(/(\w+)="([^"]*)"/g)].map(([, key, value]) => [key, value])
    )
    if (!attrs.Image) continue
    entries.push({
      group: name,
      tips: attrs.Tips ?? '',
      id: attrs.Id ? Number(attrs.Id) : null,
      image: attrs.Image,
      thumb: attrs.Thumb ?? attrs.Image.replace(/\.gif$/i, '.png')
    })
  }
}

for (const entry of entries) {
  copyFileSync(join(source, entry.image), join(target, entry.image))
  copyFileSync(join(source, entry.thumb), join(target, entry.thumb))
}

writeFileSync(join(target, 'catalog.json'), `${JSON.stringify(entries, null, 2)}\n`)
console.log(`已生成 ${entries.length} 个表情到 ${target}`)
