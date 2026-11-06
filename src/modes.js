// 成稿模式：视频（口播 + 分镜）和图文（正文 + 配图）。旧数据没有 mode 时按视频处理。
export const PRODUCTION_MODES = ['video', 'article']

/** 把外部传来的模式值收口成两个合法值；未知值一律当视频，兼容旧数据。 */
export function normalizeMode(value) {
  return value === 'article' ? 'article' : 'video'
}

/** 读取某条灵感在指定模式下的成稿；没有就返回 null。 */
export function productionOf(item, mode = 'video') {
  const key = normalizeMode(mode)
  const variants = item?.productions
  if (variants && variants[key]) return variants[key]
  const production = item?.production
  if (!production) return null
  return normalizeMode(production.mode) === key ? production : null
}

/** 写入某条灵感的指定模式成稿，同时把 item.production 保留为最近一次生成的成稿。 */
export function storeProduction(item, mode, production) {
  const key = normalizeMode(mode)
  if (!item.productions) {
    item.productions = {}
    if (item.production) item.productions[normalizeMode(item.production.mode)] = item.production
  }
  item.productions[key] = production
  item.production = production
  return production
}

/** 一条灵感下所有已有的成稿（兼容旧数据）。 */
export function allProductions(item) {
  if (item?.productions) return Object.values(item.productions)
  return item?.production ? [item.production] : []
}
