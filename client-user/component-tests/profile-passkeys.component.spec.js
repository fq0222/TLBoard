/** Passkey 管理卡片集成测试：保留真实组件、API 拦截器和注册客户端，仅替换 HTTP 与系统认证器边界。 */
import axios from 'axios'
import { parse as parseVue } from '@vue/compiler-sfc'
import postcss from 'postcss'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const browser = vi.hoisted(() => ({ startRegistration: vi.fn() }))
const messages = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@simplewebauthn/browser', () => browser)
vi.mock('element-plus', async importOriginal => ({ ...await importOriginal(), ElMessage: messages }))

const requests = []
const responses = new Map()
const originalAdapter = axios.defaults.adapter
// 记录真实 Axios 配置，断言密码发送范围和错误提示归属。
axios.defaults.adapter = async config => {
  requests.push(config)
  let data = responses.get(config.url)
  if (typeof data === 'function') data = await data(config)
  if (data instanceof Error) throw Object.assign(data, { config })
  return { data: data || { code: 0, data: {} }, status: 200, statusText: 'OK', headers: {}, config }
}
const { default: PasskeyCard } = await import('../src/components/profile/PasskeyCard.vue')
const { default: passkeyCardSource } = await import('../src/components/profile/PasskeyCard.vue?raw')
const { PasskeyClient } = await import('../src/utils/passkey-client.js')
const { default: My } = await import('../src/views/user/My.vue')
const { default: ElementPlus } = await import('element-plus')
const wrappers = []
const styleHosts = []
const firstKey = { id: 8, name: 'Windows Hello', created_at: 1791786600, last_used_at: 1792027080 }
const secondKey = { id: 9, name: '工作电脑', created_at: '1791786600', last_used_at: null }

/** 提供真实后端列表信封；list 参数指定当前账号拥有的安全元数据。 */
function setList(list) {
  responses.set('/auth/passkeys', { code: 0, data: { list, limit: 2, remaining: 2 - list.length } })
}

/** 挂载真实 Element Plus 卡片，将弹窗保留在组件树便于行为断言。 */
async function mountCard(list = []) {
  setList(list)
  const wrapper = mount(PasskeyCard, { global: { plugins: [ElementPlus] } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

/** 按用户操作打开添加窗口，名称可为空；密码字段仅用于当前绑定。 */
async function fillAdd(wrapper, name = '', password = 'current-password') {
  await wrapper.get('.passkey-add-button').trigger('click')
  await flushPromises()
  await wrapper.get('.passkey-add-dialog input[type="text"]').setValue(name)
  await wrapper.get('.passkey-add-dialog input[type="password"]').setValue(password)
}

/** 生成指定 HTTP 状态或业务码的失败，测试错误只由卡片显示一次。 */
function responseError(status, message) {
  return Object.assign(new Error('transport failed'), { response: { status, data: { code: status, message, data: null } } })
}

/** 将组件真实 CSS 注入 jsdom；narrow 选择窄容器，mobile 同时展开移动媒体规则以检查真实标签的样式。 */
function applyCardStyles(narrow = false, mobile = false) {
  const css = postcss.parse(parseVue(passkeyCardSource).descriptor.styles[0].content)
  css.walkAtRules(rule => {
    if (narrow && rule.name === 'container') rule.replaceWith(...rule.nodes)
    else if (mobile && rule.name === 'media' && rule.params === '(max-width: 768px)') rule.replaceWith(...rule.nodes)
    else rule.remove()
  })
  const style = document.createElement('style')
  style.textContent = css.toString()
  document.head.appendChild(style)
  styleHosts.push(style)
}

beforeEach(() => {
  vi.clearAllMocks()
  requests.length = 0
  responses.clear()
  localStorage.setItem('user_token', 'session-token')
  browser.startRegistration.mockResolvedValue({ id: 'new-key', response: {} })
  responses.set('/auth/passkeys/registration/options', { code: 0, data: { ceremony_id: 'ceremony-1', options: { challenge: 'challenge' } } })
  responses.set('/auth/passkeys/registration/verify', () => {
    setList([firstKey])
    return { code: 0, data: firstKey }
  })
})
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  styleHosts.splice(0).forEach(style => style.remove())
})
afterAll(() => { axios.defaults.adapter = originalAdapter })

describe('Passkey 密钥展示', () => {
  it.each([
    { layout: '桌面', mobile: false, sectionPadding: '16px', cardPadding: '16px', titleSize: '18px', titleMargin: '14px', headerGap: '16px', headerMargin: '16px', rowPadding: '8px 12px', rowGap: '16px', timesGap: '16px', emptyPadding: '20px 12px' },
    { layout: '移动', mobile: true, sectionPadding: '8px', cardPadding: '10px', titleSize: '17px', titleMargin: '8px', headerGap: '6px', headerMargin: '8px', rowPadding: '8px 0px', rowGap: '6px', timesGap: '3px', emptyPadding: '12px 8px' }
  ])('$layout 布局保持外大内小的标题层级、紧凑间距及可触控操作', async expected => {
    applyCardStyles(expected.mobile, expected.mobile)
    const wrapper = await mountCard([firstKey])
    const emptyWrapper = await mountCard()
    document.body.append(wrapper.element, emptyWrapper.element)
    try {
      const style = selector => getComputedStyle(wrapper.get(selector).element)
      const outerTitle = style('.passkey-section-title')
      const innerTitle = style('.passkey-heading h3')
      expect(outerTitle.fontSize).toBe(expected.titleSize)
      expect(innerTitle.fontSize).toBe('16px')
      expect(parseFloat(outerTitle.fontSize)).toBeGreaterThan(parseFloat(innerTitle.fontSize))
      expect(outerTitle.marginBottom).toBe(expected.titleMargin)
      expect(style('.passkey-section').padding).toBe(expected.sectionPadding)
      expect(style('.passkey-card').padding).toBe(expected.cardPadding)
      expect(style('.passkey-header').gap).toBe(expected.headerGap)
      expect(style('.passkey-header').marginBottom).toBe(expected.headerMargin)
      expect(style('.passkey-heading p').marginTop).toBe('4px')
      expect(style('.passkey-list-header').padding).toBe('10px 12px')
      expect(style('.passkey-row').minHeight).toBe('56px')
      expect(style('.passkey-row').padding).toBe(expected.rowPadding)
      expect(style('.passkey-row').gap).toBe(expected.rowGap)
      expect(style('.passkey-times').gap).toBe(expected.timesGap)
      expect(style('.passkey-add-button').height).toBe(expected.mobile ? '36px' : '40px')
      expect(style('.passkey-delete-button').minHeight).toBe(expected.mobile ? '36px' : '40px')
      expect(getComputedStyle(emptyWrapper.get('.passkey-empty').element).padding).toBe(expected.emptyPadding)
    } finally {
      wrapper.element.remove()
      emptyWrapper.element.remove()
    }
  })

  it.each([
    { layout: '桌面', narrow: false, mobile: false, descriptionSize: '14px', descriptionHeight: '1.6', countSize: '14px', timeSize: '14px', actionsGap: '16px', timeFieldGap: '' },
    { layout: '窄容器', narrow: true, mobile: false, descriptionSize: '12px', descriptionHeight: '1.4', countSize: '12px', timeSize: '12px', actionsGap: '6px', timeFieldGap: '6px' },
    { layout: '移动', narrow: true, mobile: true, descriptionSize: '12px', descriptionHeight: '1.4', countSize: '12px', timeSize: '12px', actionsGap: '6px', timeFieldGap: '6px' }
  ])('$layout 的描述、计数、时间和操作间距采用真实源 CSS 计算结果', async expected => {
    applyCardStyles(expected.narrow, expected.mobile)
    const wrapper = await mountCard([firstKey, secondKey])
    document.body.appendChild(wrapper.element)
    try {
      const style = selector => getComputedStyle(wrapper.get(selector).element)
      expect(style('.passkey-heading p').fontSize).toBe(expected.descriptionSize)
      expect(style('.passkey-heading p').lineHeight).toBe(expected.descriptionHeight)
      expect(style('.passkey-count').fontSize).toBe(expected.countSize)
      expect(style('.passkey-times').fontSize).toBe(expected.timeSize)
      expect(style('.passkey-header-actions').gap).toBe(expected.actionsGap)
      expect(style('.passkey-times div').gap).toBe(expected.timeFieldGap)
    } finally { wrapper.element.remove() }
  })

  it('移动端两条密钥在两行描述与完整时间标签下满足纵向几何预算', async () => {
    applyCardStyles(true, true)
    const wrapper = await mountCard([firstKey, secondKey])
    document.body.appendChild(wrapper.element)
    try {
      // jsdom 不执行排版；按真实计算样式累加盒模型，标题正常行高按 1.5 倍保守预算。
      // 两行描述覆盖常见窄屏换行，每条密钥包含按钮首行及两行完整日期。
      const style = selector => getComputedStyle(wrapper.get(selector).element)
      const px = value => parseFloat(value) || 0
      const verticalBox = css => px(css.paddingTop) + px(css.paddingBottom) + px(css.borderTopWidth) + px(css.borderBottomWidth)
      const title = style('.passkey-section-title')
      const heading = style('.passkey-heading h3')
      const description = style('.passkey-heading p')
      const header = style('.passkey-header')
      const row = style('.passkey-row')
      const times = style('.passkey-times')
      const rowHeight = Math.max(px(row.minHeight), verticalBox(row) + px(style('.passkey-delete-button').minHeight) + px(row.gap) + 2 * px(times.fontSize) * 1.5 + px(times.gap))
      const headerHeight = px(heading.fontSize) * 1.5 + px(description.marginTop) + 2 * px(description.fontSize) * px(description.lineHeight) + px(header.gap) + px(style('.passkey-add-button').height) + px(header.marginBottom)
      const sectionHeight = verticalBox(style('.passkey-section')) + px(title.fontSize) * 1.5 + px(title.marginBottom) + verticalBox(style('.passkey-card')) + headerHeight + wrapper.findAll('.passkey-row').length * rowHeight
      expect(rowHeight).toBeLessThanOrEqual(98)
      expect(sectionHeight).toBeLessThanOrEqual(440)
    } finally { wrapper.element.remove() }
  })

  it.each([false, true])('窄布局=%s 时每个日期标签保留无障碍可见性，并按布局切换视觉隐藏', async narrow => {
    applyCardStyles(narrow)
    const wrapper = await mountCard([firstKey])
    document.body.appendChild(wrapper.element)
    try {
      const labels = wrapper.findAll('.passkey-times dt')
      expect(labels.map(label => label.text())).toEqual(['创建时间', '上次使用'])
      for (const label of labels) {
        const style = getComputedStyle(label.element)
        expect(style.display).not.toBe('none')
        expect(style.visibility).not.toBe('hidden')
        expect(label.element.closest('[aria-hidden="true"], [hidden]')).toBeNull()
        expect(style.position || 'static').toBe(narrow ? 'static' : 'absolute')
        expect(style.overflow || 'visible').toBe(narrow ? 'visible' : 'hidden')
      }
    } finally { wrapper.element.remove() }
  })

  it('在实际“我的”页面展示安全卡片，同时保留收款、推广和服务入口', async () => {
    setList([firstKey])
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: My }] })
    await router.push('/user/my')
    await router.isReady()
    const wrapper = mount(My, { global: { plugins: [createPinia(), router, ElementPlus], stubs: { ReferralPosterDialog: true } } })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.get('.passkey-section').text()).toContain('Windows Hello')
    expect(wrapper.get('.wallet-card').text()).toContain('收款信息')
    expect(wrapper.text()).toContain('推广链接')
    expect(wrapper.get('a[href="/user/orders"]').text()).toContain('我的订单')
  })

  it('空列表提示尚未添加并允许绑定第一个密钥', async () => {
    const wrapper = await mountCard()
    expect(wrapper.text()).toContain('已添加 0 / 2')
    expect(wrapper.text()).toContain('尚未添加 Passkey')
    expect(wrapper.get('.passkey-add-button').attributes('disabled')).toBeUndefined()
  })

  it('显示后端名称、上海时间和未使用状态，每条记录自带移动端字段标签', async () => {
    const wrapper = await mountCard([firstKey, secondKey])
    const rows = wrapper.findAll('.passkey-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('Windows Hello')
    expect(rows[0].text()).toContain('2026-10-12 14:30')
    expect(rows[0].text()).toContain('2026-10-15 09:18')
    expect(rows[1].text()).toContain('尚未使用')
    for (const row of rows) {
      expect(row.findAll('dt').map(label => label.text())).toEqual(['创建时间', '上次使用'])
    }
    expect(wrapper.text()).toContain('已添加 2 / 2')
    expect(wrapper.get('.passkey-add-button').attributes('disabled')).toBeDefined()
    await wrapper.get('.passkey-add-button').trigger('click')
    expect(wrapper.find('.passkey-add-dialog input').exists()).toBe(false)
  })

  it('一个密钥时仍可添加，名称按原文显示而不推断设备类型', async () => {
    const wrapper = await mountCard([firstKey])
    expect(wrapper.text()).toContain('已添加 1 / 2')
    expect(wrapper.findAll('.passkey-key-icon')).toHaveLength(1)
    expect(wrapper.get('.passkey-add-button').attributes('disabled')).toBeUndefined()
  })
})

describe('添加 Passkey', () => {
  it.each([403, 404, 429, 500, 'network', 'timeout'])('verify %s 失败只显示一次错误并清除密码', async kind => {
    const expected = kind === 'network' ? '网络连接失败' : kind === 'timeout' ? '请求超时，请检查网络连接' : '密钥绑定失败'
    const error = typeof kind === 'number' ? responseError(kind, expected) : new Error('transport failed')
    if (kind === 'timeout') error.code = 'ECONNABORTED'
    responses.set('/auth/passkeys/registration/verify', error)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const wrapper = await mountCard()
      await fillAdd(wrapper)
      await wrapper.get('.passkey-add-confirm').trigger('click')
      await flushPromises()
      expect(messages.error.mock.calls).toEqual([[expected]])
      expect(wrapper.get('.passkey-add-dialog input[type="password"]').element.value).toBe('')
      expect(wrapper.get('.passkey-add-confirm').attributes('disabled')).toBeUndefined()
      expect(wrapper.text()).toContain('已添加 0 / 2')
    } finally { log.mockRestore() }
  })

  it('名称可留空，先复验密码再调系统窗口，成功刷新列表且 verify 不重复发送密码', async () => {
    const wrapper = await mountCard()
    await fillAdd(wrapper)
    await wrapper.get('.passkey-add-confirm').trigger('click')
    await flushPromises()
    expect(JSON.parse(requests.find(request => request.url.endsWith('/options')).data)).toEqual({ name: '', password: 'current-password' })
    expect(browser.startRegistration).toHaveBeenCalledWith({ optionsJSON: { challenge: 'challenge' } })
    expect(JSON.parse(requests.find(request => request.url.endsWith('/verify')).data)).toEqual({ ceremony_id: 'ceremony-1', response: { id: 'new-key', response: {} }, name: '' })
    expect(wrapper.text()).toContain('已添加 1 / 2')
    expect(messages.success).toHaveBeenCalledTimes(1)
  })

  it('密码为空时就地提示，不发送请求', async () => {
    const wrapper = await mountCard()
    await fillAdd(wrapper, '我的密钥', '')
    await wrapper.get('.passkey-add-confirm').trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.text()).toContain('请输入当前密码'))
    expect(requests).toHaveLength(1)
    expect(browser.startRegistration).not.toHaveBeenCalled()
  })

  it('密码错误不调用浏览器且只显示一次服务端错误，随后允许重试', async () => {
    responses.set('/auth/passkeys/registration/options', responseError(403, '当前密码错误'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const wrapper = await mountCard()
      await fillAdd(wrapper, '工作电脑')
      await wrapper.get('.passkey-add-confirm').trigger('click')
      await flushPromises()
      expect(browser.startRegistration).not.toHaveBeenCalled()
      expect(messages.error.mock.calls).toEqual([['当前密码错误']])
      expect(wrapper.get('.passkey-add-confirm').attributes('disabled')).toBeUndefined()
    } finally { log.mockRestore() }
  })

  it('系统窗口取消静默并清除密码，恢复操作锁', async () => {
    browser.startRegistration.mockRejectedValue(new DOMException('cancelled', 'NotAllowedError'))
    const wrapper = await mountCard()
    await fillAdd(wrapper)
    await wrapper.get('.passkey-add-confirm').trigger('click')
    await flushPromises()
    expect(messages.error).not.toHaveBeenCalled()
    expect(messages.success).not.toHaveBeenCalled()
    expect(requests.some(request => request.url.endsWith('/verify'))).toBe(false)
    expect(wrapper.get('.passkey-add-dialog input[type="password"]').element.value).toBe('')
    expect(wrapper.get('.passkey-add-confirm').attributes('disabled')).toBeUndefined()
  })

  it('注册和系统窗口期间锁定所有操作，阻止重复提交和跨记录删除', async () => {
    let finish
    browser.startRegistration.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const wrapper = await mountCard([firstKey])
    await fillAdd(wrapper, '新密钥')
    await wrapper.get('.passkey-add-confirm').trigger('click')
    await flushPromises()
    expect(wrapper.get('.passkey-add-button').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.passkey-delete-button').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.passkey-add-cancel').attributes('disabled')).toBeDefined()
    await wrapper.get('.passkey-add-confirm').trigger('click')
    expect(requests.filter(request => request.url.endsWith('/options'))).toHaveLength(1)
    finish(null)
    await flushPromises()
    expect(wrapper.get('.passkey-delete-button').attributes('disabled')).toBeUndefined()
  })

  it.each([
    ['business', []], ['business', [firstKey]], ['http', []], ['http', [firstKey]]
  ])('%s 上限冲突后把旧 %s 刷新为两条并禁止再次绑定', async (kind, initialList) => {
    responses.set('/auth/passkeys/registration/verify', () => {
      setList([firstKey, secondKey])
      if (kind === 'http') {
        const error = responseError(400, '每个用户最多绑定两个 Passkey')
        error.response.data.code = 2103
        return error
      }
      return { code: 2103, message: '每个用户最多绑定两个 Passkey', data: null }
    })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const wrapper = await mountCard(initialList)
      await fillAdd(wrapper, '新密钥')
      await wrapper.get('.passkey-add-confirm').trigger('click')
      await flushPromises()
      expect(messages.error.mock.calls).toEqual([['每个用户最多绑定两个 Passkey']])
      expect(messages.success).not.toHaveBeenCalled()
      expect(wrapper.text()).toContain('已添加 2 / 2')
      expect(wrapper.findAll('.passkey-row')).toHaveLength(2)
      expect(wrapper.get('.passkey-add-button').attributes('disabled')).toBeDefined()
      expect(requests.filter(request => request.url === '/auth/passkeys')).toHaveLength(2)
      await wrapper.get('.passkey-add-button').trigger('click')
      await wrapper.get('.passkey-add-confirm').trigger('click')
      await flushPromises()
      expect(requests.filter(request => request.url.endsWith('/verify'))).toHaveLength(1)
    } finally { log.mockRestore() }
  })

  it.each([2102, '2103'])('业务码 %s 不当作上限冲突或虚构已绑定数量', async code => {
    responses.set('/auth/passkeys/registration/verify', { code, message: '绑定失败', data: null })
    const wrapper = await mountCard()
    await fillAdd(wrapper)
    await wrapper.get('.passkey-add-confirm').trigger('click')
    await flushPromises()
    expect(messages.error.mock.calls).toEqual([['绑定失败']])
    expect(wrapper.text()).toContain('已添加 0 / 2')
    expect(requests.filter(request => request.url === '/auth/passkeys')).toHaveLength(1)
    expect(wrapper.get('.passkey-add-confirm').attributes('disabled')).toBeUndefined()
  })
})

describe('Passkey 业务错误边界', () => {
  it('仅保留安全数字业务码，不附带响应内容', () => {
    const client = new PasskeyClient()
    expect.assertions(3)
    try { client.unwrap({ code: 2103, message: '达到上限', data: { secret: '不得传播' } }) } catch (error) {
      expect(error.code).toBe(2103)
      expect(error.message).toBe('达到上限')
      expect(error.data).toBeUndefined()
    }
  })

  it.each(['2103', NaN, Infinity, 2103.5, Number.MAX_SAFE_INTEGER + 1, { limit: 2103 }])('不把不安全业务码 %s 传播为数字 error.code', code => {
    const client = new PasskeyClient()
    expect.assertions(1)
    try { client.unwrap({ code, message: '绑定失败' }) } catch (error) {
      expect(error.code).toBeUndefined()
    }
  })
})

describe('删除 Passkey', () => {
  it('撤销请求期间禁止重复删除和添加，完成后恢复操作', async () => {
    let finish
    responses.set('/auth/passkeys/8', () => new Promise(resolve => { finish = resolve }))
    const wrapper = await mountCard([firstKey])
    await wrapper.get('.passkey-delete-button').trigger('click')
    await flushPromises()
    await wrapper.get('.passkey-delete-dialog input[type="password"]').setValue('current-password')
    await wrapper.get('.passkey-delete-confirm').trigger('click')
    await flushPromises()
    expect(wrapper.get('.passkey-delete-confirm').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.passkey-delete-cancel').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.passkey-add-button').attributes('disabled')).toBeDefined()
    await wrapper.get('.passkey-delete-confirm').trigger('click')
    expect(requests.filter(request => request.method === 'delete')).toHaveLength(1)
    setList([])
    finish({ code: 0, data: firstKey })
    await flushPromises()
    expect(wrapper.text()).toContain('已添加 0 / 2')
    expect(wrapper.get('.passkey-add-button').attributes('disabled')).toBeUndefined()
  })

  it('中文确认包含影响说明和密码输入，取消不请求，确认仅删除选择的记录并刷新', async () => {
    const wrapper = await mountCard([firstKey, secondKey])
    await wrapper.findAll('.passkey-delete-button')[1].trigger('click')
    await flushPromises()
    expect(wrapper.get('.passkey-delete-dialog').text()).toContain('工作电脑')
    expect(wrapper.get('.passkey-delete-dialog').text()).toContain('无法再使用此密钥登录')
    expect(wrapper.get('.passkey-delete-cancel').text()).toBe('取消')
    expect(wrapper.get('.passkey-delete-confirm').text()).toBe('确认删除')
    await wrapper.get('.passkey-delete-cancel').trigger('click')
    expect(requests).toHaveLength(1)
    await wrapper.findAll('.passkey-delete-button')[1].trigger('click')
    await flushPromises()
    await wrapper.get('.passkey-delete-confirm').trigger('click')
    await flushPromises()
    expect(requests).toHaveLength(1)
    await wrapper.get('.passkey-delete-dialog input[type="password"]').setValue('current-password')
    responses.set('/auth/passkeys/9', () => { setList([firstKey]); return { code: 0, data: secondKey } })
    await wrapper.get('.passkey-delete-confirm').trigger('click')
    await flushPromises()
    const deletion = requests.find(request => request.method === 'delete')
    expect(deletion.url).toBe('/auth/passkeys/9')
    expect(JSON.parse(deletion.data)).toEqual({ password: 'current-password' })
    expect(wrapper.text()).toContain('已添加 1 / 2')
    expect(wrapper.findAll('.passkey-row')).toHaveLength(1)
    expect(wrapper.get('.passkey-row').text()).toContain('Windows Hello')
  })

  it.each(['list', 'delete'])('%s HTTP 失败只有一个可见错误出口', async stage => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const wrapper = await mountCard([firstKey])
      if (stage === 'list') {
        responses.set('/auth/passkeys', responseError(500, '密钥列表读取失败'))
        await wrapper.get('.passkey-delete-button').trigger('click')
        responses.set('/auth/passkeys/8', { code: 0, data: firstKey })
      } else {
        responses.set('/auth/passkeys/8', responseError(500, '密钥删除失败'))
        await wrapper.get('.passkey-delete-button').trigger('click')
      }
      await flushPromises()
      await wrapper.get('.passkey-delete-dialog input[type="password"]').setValue('current-password')
      await wrapper.get('.passkey-delete-confirm').trigger('click')
      await flushPromises()
      expect(messages.error.mock.calls).toEqual([[stage === 'list' ? '密钥列表读取失败' : '密钥删除失败']])
      if (stage === 'list') {
        expect(wrapper.get('.passkey-add-button').attributes('disabled')).toBeDefined()
        expect(wrapper.get('.passkey-retry-button').attributes('disabled')).toBeUndefined()
      } else {
        expect(wrapper.get('.passkey-add-button').attributes('disabled')).toBeUndefined()
      }
    } finally { log.mockRestore() }
  })
})
