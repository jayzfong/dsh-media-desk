import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { articlePlanPrompts, articlePrompts } from '../src/ai.js'
import { articleCardPrompt } from '../src/images.js'
import { Producer } from '../src/produce.js'
import { Settings } from '../src/settings.js'
import { buildSeed } from '../src/seed.js'
import { Store } from '../src/store.js'

test('小红书图文提示词：竖向配图、话题标签，不写口播分镜', () => {
  const state = buildSeed(new Date('2026-11-06T10:00:00+08:00'))
  const item = state.items[0]
  const note = articlePrompts(state, item, '', null, 'article').system
  assert.match(note, /小红书/)
  assert.match(note, /# 开头/)
  assert.doesNotMatch(note, /口播脚本/)
  const plan = articlePlanPrompts(state, item, { imageCount: 3, voice: '' }).system
  assert.match(plan, /3:4/)
  assert.match(plan, /不要输出 shots/)
})

test('小红书图卡提示词包含卡片标题正文，且不要编号', () => {
  const prompt = articleCardPrompt('三个动作', '先收集，再去重，最后只留重点。', 'three cards on a desk')
  assert.match(prompt, /标题：三个动作/)
  assert.match(prompt, /正文：先收集/)
  assert.match(prompt, /3:4/)
  assert.match(prompt, /page numbers/i)
  assert.doesNotMatch(prompt, /no text/i)
})

test('图文模式：只生成正文和配图，不生成视频分镜', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'media-desk-article-'))
  const store = new Store(dir)
  await store.read()
  const settings = new Settings(dir)
  await settings.update({ imageCount: 1, articleImageCount: 1, shotCount: 2 })

  const callText = async ({ system }) => {
    if (system.includes('策划案')) {
      return {
        text: JSON.stringify({ title: '图文标题', coverText: '封面字', facts: ['事实'], outline: ['第一节', '第二节'], cover: 'cover visual', images: [{ anchor: '第一节', caption: '图注', prompt: 'figure visual' }] }),
        model: 'mock',
      }
    }
    return { text: '# 图文标题\n\n## 第一节\n正文一\n\n## 第二节\n正文二', model: 'mock' }
  }
  const producer = new Producer({ store, settings, callText, generate: async () => { throw new Error('没有生图服务') } })
  try {
    await producer.start('seed_2', 'article', { planOnly: true })
    for (let i = 0; i < 200 && producer.isRunning('seed_2'); i += 1) await new Promise(r => setTimeout(r, 5))
    let item = (await store.read()).items.find(row => row.id === 'seed_2')
    let production = item.productions.article
    assert.equal(production.status, 'planned')
    assert.equal(production.stage, 'plan')
    assert.equal(production.article, '')
    assert.equal(production.images.length, 1)
    assert.equal(production.images[0].title, '')

    await producer.continue('seed_2', 'article')
    for (let i = 0; i < 200 && producer.isRunning('seed_2'); i += 1) await new Promise(r => setTimeout(r, 5))
    item = (await store.read()).items.find(row => row.id === 'seed_2')
    production = item.productions.article
    assert.equal(production.status, 'done')
    assert.equal(production.mode, 'article')
    assert.equal(production.shots.length, 0)
    assert.match(production.article, /## 第一节/)
    assert.equal(item.production.mode, 'article')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})


test('小红书图文确认策划案后逐张生成图片', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'media-desk-article-seq-'))
  const store = new Store(dir)
  await store.read()
  const settings = new Settings(dir)
  await settings.update({ imageCount: 0, articleImageCount: 2, shotCount: 0, image: { baseUrl: 'https://i.example/v1', model: 'm', apiKey: 'k' } })
  const callText = async ({ system }) => {
    if (system.includes('策划案')) {
      return { text: JSON.stringify({ title: '逐张标题', coverText: '封面字', facts: [], outline: ['第一节'], cover: 'cover', images: [{ anchor: '第一节', title: '第一张', body: '正文', prompt: 'one' }, { anchor: '第一节', title: '第二张', body: '正文', prompt: 'two' }] }), model: 'mock' }
    }
    return { text: '# 逐张标题\n\n## 第一节\n正文', model: 'mock' }
  }
  let active = 0
  let maxActive = 0
  const producer = new Producer({
    store,
    settings,
    callText,
    generate: async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise(r => setTimeout(r, 5))
      active -= 1
      return { buffer: Buffer.from([1, 2, 3]), ext: '.png' }
    },
  })
  try {
    await producer.start('seed_2', 'article', { planOnly: true })
    for (let i = 0; i < 200 && producer.isRunning('seed_2'); i += 1) await new Promise(r => setTimeout(r, 5))
    await producer.continue('seed_2', 'article')
    for (let i = 0; i < 200 && producer.isRunning('seed_2'); i += 1) await new Promise(r => setTimeout(r, 5))
    const production = (await store.read()).items.find(row => row.id === 'seed_2').productions.article
    assert.equal(production.status, 'done')
    assert.equal(production.images.length, 2)
    assert.ok(production.images.every(image => image.status === 'done'))
    assert.equal(maxActive, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
