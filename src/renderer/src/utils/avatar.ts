// 头像文件由主进程按 md5 缓存，渲染进程统一走自定义协议
export function avatarUrl(md5: string | undefined): string {
  return md5 === undefined || md5 === '' ? '' : `lanpost-avatar:///${encodeURIComponent(md5)}`
}
