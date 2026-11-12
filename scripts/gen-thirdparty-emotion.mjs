// 把微信与 QQ 的内置表情拷进渲染进程资源，并生成清单：
// node scripts/gen-thirdparty-emotion.mjs <QQ 表情目录> <微信 assets 目录>
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [qqDir, wechatDir] = process.argv.slice(2)
if (!qqDir || !wechatDir) {
  throw new Error('用法：node scripts/gen-thirdparty-emotion.mjs <QQ 表情目录> <微信 assets 目录>')
}

const target = join('src', 'renderer', 'src', 'assets', 'emotion')
mkdirSync(join(target, 'qq'), { recursive: true })
mkdirSync(join(target, 'wechat'), { recursive: true })

const entries = []

const qqNames = JSON.parse(readFileSync(join(qqDir, 'names.json'), 'utf8'))
for (const [id, name] of Object.entries(qqNames)) {
  const file = `s${id}.gif`
  copyFileSync(join(qqDir, file), join(target, 'qq', file))
  entries.push({
    group: 'QQ',
    tips: name,
    id: null,
    image: `qq/${file}`,
    thumb: `qq/${file}`,
    kind: 'image'
  })
}

const categories = ['face', 'gesture', 'animal', 'blessing', 'other']
for (const category of categories) {
  const dir = join(wechatDir, category)
  if (!existsSync(dir)) continue
  const files = readdirSync(dir).filter((name) => name.toLowerCase().endsWith('.png'))
  for (const file of files) {
    copyFileSync(join(dir, file), join(target, 'wechat', file))
    entries.push({
      group: '微信',
      tips: file.replace(/\.png$/i, ''),
      id: null,
      image: `wechat/${file}`,
      thumb: `wechat/${file}`,
      kind: 'image'
    })
  }
}

writeFileSync(join(target, 'catalog-extra.json'), `${JSON.stringify(entries, null, 2)}\n`)
console.log(`已生成 ${entries.length} 个微信/QQ 表情到 ${target}`)
