// 设置：开放接入的生图模型和保存位置。
import React from 'react'
import { saveSettings, setDesk, testImage, useDesk } from './desk.js'
import { t, useLang } from './i18n.js'
import { Dialog, Icon } from './ui.jsx'

// 常见服务的 OpenAI 兼容地址，模型名以各家文档为准。label 是中文原文，显示时再翻译
const PRESETS = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1', size: '1536x1024', quality: 'medium', extra: '' },
  { id: 'xai', label: 'xAI', baseUrl: 'https://api.x.ai/v1', model: 'grok-2-image', size: '', quality: '', extra: '' },
  { id: 'ark', label: '火山方舟', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: '', size: '1024x1024', quality: '', extra: '' },
  { id: 'zhipu', label: '智谱', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'cogview-4', size: '1024x1024', quality: '', extra: '' },
  { id: 'silicon', label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: '', size: '', quality: '', extra: '{"image_size":"1024x1024"}' },
  { id: 'custom', label: '其他自定义', baseUrl: '', model: '', size: '1024x1024', quality: '', extra: '' },
]

// 中文和 English 各用自己的语言写，切错了也认得出来
const LANGUAGES = [
  { value: 'auto', label: () => t('跟随 DeepSeek Harness') },
  { value: 'zh', label: () => '中文' },
  { value: 'en', label: () => 'English' },
]

export function SettingsDialog() {
  useLang()
  const open = useDesk(s => s.settingsOpen)
  const settings = useDesk(s => s.settings)
  const [form, setForm] = React.useState(null)
  const [testing, setTesting] = React.useState(false)
  const [sample, setSample] = React.useState(null)
  const [advanced, setAdvanced] = React.useState(false)
  React.useEffect(() => {
    if (!open || !settings) return
    const { image } = settings
    setForm({ language: settings.language ?? 'auto', baseUrl: image.baseUrl, model: image.model, apiKey: '', size: image.size, quality: image.quality, extra: image.extra, exportDir: settings.exportDir ?? '', imageCount: settings.imageCount, shotCount: settings.shotCount, articleImageCount: settings.articleImageCount ?? 3, articleSize: settings.articleSize ?? '1024x1536' })
    setSample(null)
  }, [open, settings])
  if (!open || !form) return null
  const close = () => setDesk({ settingsOpen: false })
  const set = (key, value) => setForm(f => ({ ...f, [key]: value }))
  const payload = () => ({
    language: form.language,
    image: { baseUrl: form.baseUrl, model: form.model, apiKey: form.apiKey, size: form.size, quality: form.quality, extra: form.extra },
    exportDir: form.exportDir, imageCount: Number(form.imageCount), shotCount: Number(form.shotCount), articleImageCount: Number(form.articleImageCount), articleSize: form.articleSize,
  })
  const activePreset = PRESETS.find(p => p.baseUrl && p.baseUrl === form.baseUrl)?.id ?? (form.baseUrl ? 'custom' : null)
  return (
    <Dialog title={t('设置')} onClose={close} width={520}>
      <form className="md-form" onSubmit={async (event) => {
        event.preventDefault()
        if (await saveSettings(payload())) close()
      }}>
        <div className="md-field">
          <span>{t('语言')}</span>
          <div className="md-presets" role="radiogroup" aria-label={t('语言')}>
            {LANGUAGES.map(option => (
              <button type="button" key={option.value} role="radio" aria-checked={form.language === option.value} className={form.language === option.value ? 'is-on' : ''} onClick={() => set('language', option.value)}>{option.label()}</button>
            ))}
          </div>
        </div>
        <label className="md-field">
          <span>{t('成稿保存到')}</span>
          <input value={form.exportDir} onChange={e => set('exportDir', e.target.value)} placeholder={settings.defaultExportDir} />
        </label>

        <div className="md-field">
          <span>{t('生图模型')}</span>
          <div className="md-presets">
            {PRESETS.map(preset => (
              <button type="button" key={preset.id} className={activePreset === preset.id ? 'is-on' : ''} onClick={() => setForm(f => ({ ...f, baseUrl: preset.baseUrl, model: preset.model, size: preset.size, quality: preset.quality, extra: preset.extra }))}>{t(preset.label)}</button>
            ))}
          </div>
          <small>{t('支持任何兼容 OpenAI 图片接口（/images/generations）的服务。')}</small>
        </div>
        <label className="md-field">
          <span>{t('接口地址')}</span>
          <input type="url" value={form.baseUrl} onChange={e => set('baseUrl', e.target.value)} placeholder="https://…/v1" />
        </label>
        <label className="md-field">
          <span>{t('模型')}</span>
          <input value={form.model} onChange={e => set('model', e.target.value)} placeholder={t('模型名称')} />
        </label>
        <label className="md-field">
          <span>{t('密钥')}{settings.image.hasKey ? t('（已保存，末四位 {hint}）', { hint: settings.image.keyHint }) : ''}</span>
          <input type="password" autoComplete="off" value={form.apiKey} onChange={e => set('apiKey', e.target.value)} placeholder={settings.image.hasKey ? t('留空表示不修改') : 'sk-…'} />
          <small>{t('只保存在这台电脑上，不会写进内容数据，也不会被打包或发给模型。')}</small>
        </label>
        <div className="md-form-section">
          <h3>{t('视频成稿')}</h3>
          <div className="md-field-row">
            <label className="md-field"><span>{t('视频配图数量')}</span><input type="number" min="0" max="4" value={form.imageCount} onChange={e => set('imageCount', e.target.value)} /></label>
            <label className="md-field"><span>{t('分镜格数')}</span><input type="number" min="0" max="12" value={form.shotCount} onChange={e => set('shotCount', e.target.value)} /></label>
          </div>
        </div>
        <div className="md-form-section">
          <h3>{t('小红书图文')}</h3>
          <div className="md-field-row">
            <label className="md-field"><span>{t('小红书配图数量')}</span><input type="number" min="0" max="8" value={form.articleImageCount} onChange={e => set('articleImageCount', e.target.value)} /></label>
            <label className="md-field"><span>{t('小红书图片尺寸')}</span><input value={form.articleSize} onChange={e => set('articleSize', e.target.value)} placeholder={t('留空沿用通用尺寸')} /></label>
          </div>
          <small>{t('小红书图片建议 3:4 竖图，例如 1024x1536。留空时沿用下面「高级」里的通用尺寸。')}</small>
          {settings.articleImageCount === undefined ? <small>{t('当前 Host 还是旧版本，重启 DeepSeek Harness 后图文设置才会保存生效。')}</small> : null}
        </div>
        <button type="button" className="md-advanced" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}><Icon name={advanced ? 'chevD' : 'chevR'} size={12} />{t('高级')}</button>
        {advanced ? (
          <>
            <div className="md-field-row">
              <label className="md-field"><span>{t('尺寸')}</span><input value={form.size} onChange={e => set('size', e.target.value)} placeholder="1536x1024" /></label>
              <label className="md-field"><span>{t('质量')}</span><input value={form.quality} onChange={e => set('quality', e.target.value)} placeholder="low / medium / high" /></label>
            </div>
            <label className="md-field">
              <span>{t('附加参数（JSON）')}</span>
              <input value={form.extra} onChange={e => set('extra', e.target.value)} placeholder='{"output_format":"jpeg"}' />
            </label>
          </>
        ) : null}
        {sample ? <img className="md-test-sample" src={sample} alt={t('测试图')} /> : null}
        <div className="md-form-foot">
          <button type="button" className="md-btn" disabled={testing} onClick={async () => {
            setTesting(true)
            setSample(null)
            setSample(await testImage(payload()))
            setTesting(false)
          }}>{testing ? <span className="md-shimmer">{t('正在试画…')}</span> : t('试画一张')}</button>
          <span style={{ flex: 1 }} />
          <button type="button" className="md-btn" onClick={close}>{t('取消')}</button>
          <button type="submit" className="md-btn is-primary">{t('保存')}</button>
        </div>
      </form>
    </Dialog>
  )
}
