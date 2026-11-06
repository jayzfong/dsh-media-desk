// 抓取网页和个人主页的公开信息。只读公开 HTML，不登录，也不绕过平台限制。
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { tr } from './i18n.js'

const MAX_BYTES = 1_500_000
const TIMEOUT_MS = 8000
const MAX_REDIRECTS = 4

function isPrivateAddress(address) {
  if (address === '::1' || address === '::') return true
  const lower = address.toLowerCase()
  if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true
  let v4 = lower.startsWith('::ffff:') ? lower.slice(7) : lower
  // URL 解析器会把 ::ffff:127.0.0.1 规范化成 ::ffff:7f00:1
  const mapped = /^([\da-f]{1,4}):([\da-f]{1,4})$/.exec(v4)
  if (mapped) {
    const high = parseInt(mapped[1], 16)
    const low = parseInt(mapped[2], 16)
    v4 = `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
  }
  if (isIP(v4) !== 4) return false
  const [a, b] = v4.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

/** 粘贴的链接可能来自任何地方，不能让它访问本机或内网服务。 */
export async function assertPublicUrl(raw) {
  const url = new URL(raw)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(tr('只支持 http 和 https 链接'))
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw new Error(tr('不能抓取本机地址'))
  const records = isIP(host) ? [{ address: host }] : await lookup(host, { all: true })
  if (records.some(record => isPrivateAddress(record.address))) throw new Error(tr('不能抓取内网地址'))
  return url
}

function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (all, name) => named[name.toLowerCase()] ?? all)
    .trim()
}

function meta(html, names) {
  for (const name of names) {
    const a = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i').exec(html)
    if (a?.[1]) return decodeEntities(a[1])
    const b = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, 'i').exec(html)
    if (b?.[1]) return decodeEntities(b[1])
  }
  return null
}

function followerHint(text) {
  const m = /([\d.,]+)\s*(万|千|k|K|m|M)?\s*(?:粉丝|关注者|followers)/.exec(text) ?? /(?:粉丝|followers)[^\d]{0,6}([\d.,]+)\s*(万|千|k|K|m|M)?/.exec(text)
  if (!m) return null
  const unit = { 万: 1e4, 千: 1e3, k: 1e3, K: 1e3, m: 1e6, M: 1e6 }[m[2]] ?? 1
  const value = Number(m[1].replace(/,/g, '')) * unit
  return Number.isFinite(value) ? Math.round(value) : null
}


const PRESERVED_QUERY = ['xsec_token', 'xsec_source']
const MIN_EMBEDDED_TEXT = 20

/** 从 start 处的 { 开始找配对的右括号；字符串里的括号不算。 */
function balancedObject(text, start) {
  if (text[start] !== '{') return null
  let depth = 0
  let quote = null
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (quote !== null) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"') { quote = ch; continue }
    if (ch === '{') depth += 1
    else if (ch === '}' && (depth -= 1) === 0) return text.slice(start, i + 1)
  }
  return null
}

/** JS 内嵌对象里有 undefined / NaN 这类 JSON 不认的字面量，替换成 null 再解析。 */
function jsonSafe(source) {
  let out = ''
  for (let i = 0; i < source.length;) {
    const ch = source[i]
    if (ch === '"') {
      let j = i + 1
      out += ch
      while (j < source.length) {
        out += source[j]
        if (source[j] === '\\') { out += source[j + 1] ?? ''; j += 2; continue }
        if (source[j] === '"') { j += 1; break }
        j += 1
      }
      i = j
      continue
    }
    const word = source.startsWith('undefined', i) ? 'undefined' : source.startsWith('NaN', i) ? 'NaN' : source.startsWith('Infinity', i) ? 'Infinity' : null
    if (word && !/[\w$]/.test(source[i - 1] ?? '') && !/[\w$]/.test(source[i + word.length] ?? '')) {
      out += 'null'
      i += word.length
      continue
    }
    out += ch
    i += 1
  }
  return out
}

/** 解析 window.__INITIAL_STATE__，失败返回 null；不执行页面里的任何代码。 */
export function initialPageState(html) {
  const marker = /window\.__INITIAL_STATE__\s*=\s*/.exec(html)
  if (!marker) return null
  let start = marker.index + marker[0].length
  while (/\s/.test(html[start] ?? '')) start += 1
  const block = balancedObject(html, start)
  if (!block) return null
  try {
    return JSON.parse(block)
  } catch {
    try {
      return JSON.parse(jsonSafe(block))
    } catch {
      return null
    }
  }
}

function plainText(value) {
  return decodeEntities(String(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function noteFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const title = [value.title, value.noteCard?.title, value.noteCard?.displayTitle]
    .find(row => typeof row === 'string' && row.trim()) ?? ''
  const desc = [value.desc, value.noteCard?.desc]
    .find(row => typeof row === 'string' && row.trim()) ?? ''
  if (!title && !desc) return null
  const shape = value.noteId || value.note_id || value.noteCard || value.interactInfo || value.user || value.type || value.noteType
  if (!shape && desc.length < MIN_EMBEDDED_TEXT) return null
  return { title: plainText(title), desc: plainText(desc) }
}

/**
 * 小红书等 SSR 页面把正文放在内嵌状态里。优先找 noteDetailMap 一类的结构，
 * 找不到再做一次浅层遍历，避免把导航栏里的 desc 之类配置误当正文。
 */
export function embeddedPost(html) {
  const state = initialPageState(html)
  if (!state) return null
  const direct = [
    state.note?.noteDetailMap,
    state.note?.noteData,
    state.noteData,
    state.note?.note,
    state.note,
  ]
  const queue = direct.map(value => ({ value, depth: 0 }))
  const seen = new Set()
  let best = null
  let visited = 0
  while (queue.length && visited < 20000) {
    const { value, depth } = queue.shift()
    visited += 1
    if (!value || typeof value !== 'object' || seen.has(value)) continue
    seen.add(value)
    if (!Array.isArray(value)) {
      const note = noteFields(value)
      if (note?.desc && (!best || note.desc.length > best.desc.length)) best = note
    }
    if (depth >= 7) continue
    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') queue.push({ value: child, depth: depth + 1 })
    }
  }
  if (!best) return null
  const text = best.desc || best.title
  return text.length >= MIN_EMBEDDED_TEXT ? { title: best.title || null, text } : null
}

/** 同站跳转时保留小红书的 xsec_token；跨域跳转不把参数带出去。 */
function carryQuery(previous, next) {
  const from = new URL(previous)
  const to = new URL(next)
  if (to.hostname !== from.hostname) return to.toString()
  for (const key of PRESERVED_QUERY) {
    if (!to.searchParams.has(key) && from.searchParams.has(key)) to.searchParams.set(key, from.searchParams.get(key))
  }
  return to.toString()
}

async function fetchPublic(raw, fetchImpl) {
  let current = raw
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = await assertPublicUrl(current)
    const res = await fetchImpl(url, {
      redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', accept: 'text/html,application/xhtml+xml', 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' },
    })
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = carryQuery(url.toString(), new URL(res.headers.get('location'), url).toString())
      continue
    }
    return { res, url }
  }
  throw new Error(tr('跳转次数过多'))
}

async function readHtml(raw, fetchImpl) {
  const { res, url } = await fetchPublic(raw, fetchImpl)
  if (!res.ok) throw new Error(tr('页面返回 {status}，可能需要登录或被平台拦截', { status: res.status }))
  const type = res.headers.get('content-type') || ''
  if (!/html|xml/i.test(type)) throw new Error(tr('这不是网页（{type}）', { type: type || tr('未知类型') }))
  const reader = res.body.getReader()
  const chunks = []
  let size = 0
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.length
  }
  await reader.cancel().catch(() => {})
  return { html: Buffer.concat(chunks).toString('utf8'), url }
}

/**
 * 抓一个公开页面的正文，用来提炼风格。
 * @param {string} raw - 页面地址。
 * @param {typeof fetch} [fetchImpl] - 便于测试替换。
 * @returns {Promise<{url: string, title: string|null, text: string}>} 页面文字。
 */
export async function harvestText(raw, fetchImpl = fetch) {
  const { html, url } = await readHtml(raw, fetchImpl)
  // SSR 页面的正文优先从内嵌状态里取，剥标签只做兜底。
  const embedded = embeddedPost(html)
  if (embedded) return { url: url.toString(), title: embedded.title, text: embedded.text }
  const title = meta(html, ['og:title']) ?? decodeEntities(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? '')
  const body = html
    .replace(/<(script|style|noscript|svg|nav|footer|header|aside)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|br|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  const text = decodeEntities(body).split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(line => line.length > 8).join('\n')
  return { url: url.toString(), title: title || null, text }
}

/**
 * 读取一个公开页面的标题、简介、封面和可见的粉丝数。
 * @param {string} raw - 页面地址。
 * @param {typeof fetch} [fetchImpl] - 便于测试替换。
 * @returns {Promise<{url: string, title: string|null, description: string|null, image: string|null, siteName: string|null, followers: number|null}>} 页面信息。
 */
export async function harvest(raw, fetchImpl = fetch) {
  const { html, url } = await readHtml(raw, fetchImpl)
  const title = meta(html, ['og:title', 'twitter:title']) ?? decodeEntities(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? '')
  const description = meta(html, ['og:description', 'description', 'twitter:description'])
  let image = meta(html, ['og:image', 'twitter:image', 'og:image:url'])
  if (image) {
    try {
      image = new URL(image, url).toString()
      if (!/^https?:/.test(image)) image = null
    } catch {
      image = null
    }
  }
  const siteName = meta(html, ['og:site_name']) ?? url.hostname.replace(/^www\./, '')
  return { url: url.toString(), title: title || null, description, image, siteName, followers: followerHint(`${description ?? ''} ${html.slice(0, 200000).replace(/<[^>]+>/g, ' ')}`) }
}
