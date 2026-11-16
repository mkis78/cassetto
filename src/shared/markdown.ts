import { Marked } from 'marked'

// links that may open outside the app
export function isSafeLink(url: string): boolean {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(url).protocol)
  } catch {
    return false
  }
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// raw HTML in a file shows as text and only safe links stay links: the preview runs next to window.api
const md = new Marked({
  gfm: true,
  renderer: {
    html: ({ text }) => escape(text),
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens)
      return isSafeLink(href) ? `<a href="${escape(href)}">${label}</a>` : label
    },
    // the CSP only loads local images: a remote one becomes a link to it
    image: ({ href, text }) => (isSafeLink(href) ? `<a href="${escape(href)}">${escape(text || href)}</a>` : escape(text))
  }
})

export const renderMarkdown = (text: string): string => md.parse(text, { async: false })
