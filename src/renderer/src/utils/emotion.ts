import catalog from '../assets/emotion/catalog.json'

export interface EmotionItem {
  group: string
  tips: string
  id: number | null
  image: string
  thumb: string
}

// 表情图在打包时由 Vite 处理成静态资源地址
const gifs = import.meta.glob('../assets/emotion/*.gif', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>
const thumbs = import.meta.glob('../assets/emotion/*.png', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>

export const emotions = catalog as EmotionItem[]

export const emotionGroups = [...new Set(emotions.map((item) => item.group))]

// 收到的表情节点是 Id（1251–1334）或「班车小子」组的文件名（2001.gif）
export function emotionByKey(key: string): EmotionItem | null {
  if (/^\d+$/.test(key)) {
    const id = Number(key)
    return emotions.find((item) => item.id === id) ?? null
  }
  const name = key.toLowerCase()
  return emotions.find((item) => item.image.toLowerCase() === name) ?? null
}

export function emotionUrl(item: EmotionItem): string {
  return gifs[`../assets/emotion/${item.image}`] ?? ''
}

export function emotionThumb(item: EmotionItem): string {
  return thumbs[`../assets/emotion/${item.thumb}`] ?? ''
}
