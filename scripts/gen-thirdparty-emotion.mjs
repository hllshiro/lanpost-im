// 把微信官方表情与 QQ 表情拷进渲染进程资源，并生成清单：
// node scripts/gen-thirdparty-emotion.mjs <QQ 表情目录> <微信官方 GIF 目录>
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [qqDir, wechatDir] = process.argv.slice(2)
if (!qqDir || !wechatDir) {
  throw new Error('用法：node scripts/gen-thirdparty-emotion.mjs <QQ 表情目录> <微信官方 GIF 目录>')
}

// 微信官方表情的编号顺序（0 起）
const WECHAT_TIPS = [
  '微笑',
  '撇嘴',
  '色',
  '发呆',
  '得意',
  '流泪',
  '害羞',
  '闭嘴',
  '睡',
  '大哭',
  '尴尬',
  '发怒',
  '调皮',
  '呲牙',
  '惊讶',
  '难过',
  '酷',
  '冷汗',
  '抓狂',
  '吐',
  '偷笑',
  '愉快',
  '白眼',
  '傲慢',
  '饥饿',
  '困',
  '惊恐',
  '流汗',
  '憨笑',
  '悠闲',
  '奋斗',
  '咒骂',
  '疑问',
  '嘘',
  '晕',
  '折磨',
  '衰',
  '骷髅',
  '敲打',
  '再见',
  '擦汗',
  '抠鼻',
  '鼓掌',
  '糗大了',
  '坏笑',
  '左哼哼',
  '右哼哼',
  '哈欠',
  '鄙视',
  '委屈',
  '快哭了',
  '阴险',
  '亲亲',
  '吓',
  '可怜',
  '菜刀',
  '西瓜',
  '啤酒',
  '篮球',
  '乒乓',
  '咖啡',
  '米饭',
  '猪头',
  '玫瑰',
  '凋谢',
  '嘴唇',
  '爱心',
  '心碎',
  '蛋糕',
  '闪电',
  '炸弹',
  '刀',
  '足球',
  '瓢虫',
  '便便',
  '月亮',
  '太阳',
  '礼物',
  '拥抱',
  '强',
  '弱',
  '握手',
  '胜利',
  '抱拳',
  '勾引',
  '拳头',
  '差劲',
  '爱你',
  'NO',
  'OK',
  '爱情',
  '飞吻',
  '跳跳',
  '发抖',
  '怄火',
  '转圈',
  '磕头',
  '回头',
  '跳绳',
  '投降',
  'Hooray',
  'Meditate',
  'Smooch',
  'TaiChi L',
  'TaiChi R'
]

const target = join('src', 'renderer', 'src', 'assets', 'emotion')
mkdirSync(join(target, 'qq'), { recursive: true })
// 微信表情整套替换
rmSync(join(target, 'wechat'), { recursive: true, force: true })
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

const wechatFiles = readdirSync(wechatDir)
  .filter((name) => /^\d+\.gif$/i.test(name))
  .sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10))

for (const file of wechatFiles) {
  const index = Number.parseInt(file, 10)
  copyFileSync(join(wechatDir, file), join(target, 'wechat', file))
  entries.push({
    group: '微信',
    tips: WECHAT_TIPS[index] ?? `表情 ${index}`,
    id: null,
    image: `wechat/${file}`,
    thumb: `wechat/${file}`,
    kind: 'image'
  })
}

writeFileSync(join(target, 'catalog-extra.json'), `${JSON.stringify(entries, null, 2)}\n`)
console.log(`已生成 ${entries.length} 个微信/QQ 表情到 ${target}`)
