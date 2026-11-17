// file sizes the way Finder shows them: powers of 1000, one decimal below 10
import { locale } from './i18n'
export function formatSize(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1000 && i < units.length - 1) (n /= 1000), i++
  return `${i ? n.toLocaleString(locale(), { maximumFractionDigits: n < 10 ? 1 : 0 }) : n} ${units[i]}`
}

const IMAGES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon' }
// the image MIME type for a file name, by extension; undefined for anything else
export const imageType = (name: string): string | undefined => {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? undefined : IMAGES[name.slice(dot + 1).toLowerCase()]
}
