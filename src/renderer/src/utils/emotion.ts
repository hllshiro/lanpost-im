import builtinCatalog from '../assets/emotion/catalog.json'
import extraCatalog from '../assets/emotion/catalog-extra.json'

export interface EmotionItem {
  group: string
  tips: string
  id: number | null
  image: string
  thumb: string
  // emotion：内网通内置表情，按 Id 发卡片；image：微信/QQ 表情，按图片文件发送
  kind: 'emotion' | 'image'
}

// 表情图在打包时由 Vite 处理成静态资源地址
const gifs = import.meta.glob(['../assets/emotion/*.gif', '../assets/emotion/**/*.gif'], {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>
const images = import.meta.glob(['../assets/emotion/*.png', '../assets/emotion/**/*.png'], {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>

const builtin = builtinCatalog as EmotionItem[]
const extra = extraCatalog as EmotionItem[]

export const emotions: EmotionItem[] = [...builtin, ...extra]

const order = ['QQ', '微信', '内网通']
export const emotionGroups = order.filter((group) => emotions.some((item) => item.group === group))

// 内网通表情节点是 Id（1251–1334）或「班车小子」组的文件名（2001.gif）
export function emotionByKey(key: string): EmotionItem | null {
  if (/^\d+$/.test(key)) {
    const id = Number(key)
    return builtin.find((item) => item.id === id) ?? null
  }
  const name = key.toLowerCase()
  return builtin.find((item) => item.image.toLowerCase() === name) ?? null
}

export function emotionUrl(item: EmotionItem): string {
  const key = `../assets/emotion/${item.image}`
  return gifs[key] ?? images[key] ?? ''
}

// 从消息里已经渲染出来的表情图片反查回表情键，复制聊天记录时用
const emotionKeyBySrc = new Map<string, string>()
for (const item of emotions) {
  const url = emotionUrl(item)
  if (url === '') continue
  emotionKeyBySrc.set(url, item.id !== null ? String(item.id) : item.image)
}

export function emotionKeyByUrl(url: string): string | null {
  return emotionKeyBySrc.get(url) ?? null
}

export function emotionThumb(item: EmotionItem): string {
  const key = `../assets/emotion/${item.thumb}`
  return images[key] ?? gifs[key] ?? ''
}
