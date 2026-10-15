/** 管理端 Passkey 集成测试：保留真实页面、路由、组件与 API，仅替换 HTTP 和确认窗口边界。 */
import axios from 'axios'
import { parse as parseVue } from '@vue/compiler-sfc'
import postcss from 'postcss'
import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const messages = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), confirm: vi.fn() }))
vi.mock('element-plus/es/components/message/index.mjs', () => ({ ElMessage: messages }))
vi.mock('element-plus/es/components/message-box/index.mjs', () => ({ ElMessageBox: { confirm: messages.confirm } }))

const requests = []
const responses = new Map()
const originalAdapter = axios.defaults.adapter
// 只替换传输边界，错误仍经过真实管理端响应拦截器。
axios.defaults.adapter = async config => {
  requests.push(config)
  let data = responses.get(`${config.method} ${config.url}`)
  if (typeof data === 'function') data = await data(config)
  if (data instanceof Error) throw Object.assign(data, { config })
  return { data: data || { code: 0, data: { count: 0 } }, status: 200, statusText: 'OK', headers: {}, config }
}

const { default: Passkeys } = await import('../src/views/Passkeys.vue')
const { default: pageSource } = await import('../src/views/Passkeys.vue?raw')
const { default: Layout } = await import('../src/views/Layout.vue')
const { default: router } = await import('../src/router/index.js')
const { default: ElementPlus } = await import('element-plus')
const wrappers = []
const firstKey = { id: 11, name: 'Windows Hello', created_at: 1791786600, last_used_at: 1792027080 }
const secondKey = { id: 12, name: '手机备用密钥', created_at: '1791786600', last_used_at: null }
const firstUser = { user_id: 7, email: 'first@example.test', passkey_count: 2, passkey_limit: 2, passkeys: [firstKey, secondKey] }
const secondUser = { user_id: 8, email: 'second@example.test', passkey_count: 1, passkey_limit: 2, passkeys: [{ ...firstKey, id: 13, name: '另一位用户的密钥' }] }

/** 生成完整分组信封；total 为匹配用户数，不能由密钥数量推导。 */
function setList(list = [firstUser], total = list.length) {
  responses.set('get /passkeys', { code: 0, data: { list, total, page: 1, limit: 15 } })
}

/** 挂载真实 Element Plus 页面；保留实际表格行和分页交互。 */
async function mountPage() {
  const wrapper = mount(Passkeys, { attachTo: document.body, global: { plugins: [ElementPlus] } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

/** 控制异步操作完成时机，复现确认与 HTTP 请求期间重复操作。 */
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

/** 从真实 Axios 配置筛选分组查询，避免将布局提醒接口计入。 */
function listRequests() {
  return requests.filter(request => request.url === '/passkeys' && request.method === 'get')
}

beforeEach(() => {
  vi.clearAllMocks()
  requests.length = 0
  responses.clear()
  localStorage.setItem('admin_token', 'admin-session')
  setList()
  messages.confirm.mockResolvedValue('confirm')
})
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  document.querySelectorAll('[data-passkey-test-style]').forEach(style => style.remove())
})
afterAll(() => { axios.defaults.adapter = originalAdapter })

describe('管理端 Passkey 分组', () => {
  it('移动端一名用户显示为一个记录块，密钥保留独立字段标签和操作', async () => {
    const css = postcss.parse(parseVue(pageSource).descriptor.styles[0].content)
    css.walkAtRules(rule => rule.name === 'media' ? rule.replaceWith(...rule.nodes) : rule.remove())
    css.walkRules(rule => { rule.selector = rule.selector.replace(/:deep\(([^)]+)\)/g, '$1') })
    const style = document.createElement('style')
    style.dataset.passkeyTestStyle = ''
    style.textContent = css.toString()
    document.head.appendChild(style)
    const wrapper = await mountPage()
    const row = wrapper.get('.el-table__body tbody > tr')
    expect(getComputedStyle(row.element).display).toBe('block')
    expect(row.findAll('.passkey-record')).toHaveLength(2)
    for (const record of row.findAll('.passkey-record')) {
      expect(getComputedStyle(record.element).gridTemplateColumns).toBe('minmax(0, 1fr)')
      for (const label of record.findAll('.field-label')) expect(getComputedStyle(label.element).display).not.toBe('none')
      expect(record.get('button').attributes('aria-label')).toContain('撤销')
    }
  })
  it('注册受保护路由，并在用户管理后显示侧栏入口', async () => {
    const route = router.resolve('/admin/passkeys')
    expect(route.name).toBe('Passkeys')
    expect(route.meta).toMatchObject({ requiresAuth: true, title: 'Passkey 管理' })
    const module = await route.matched.at(-1).components.default()
    expect(module.default).toBe(Passkeys)
    const wrapper = mount(Layout, { global: { plugins: [createPinia(), router, ElementPlus], stubs: { RouterView: true } } })
    wrappers.push(wrapper)
    await flushPromises()
    const links = wrapper.findAll('.sidebar-nav a')
    const userIndex = links.findIndex(link => link.attributes('href') === '/admin/users')
    expect(links[userIndex + 1].attributes('href')).toBe('/admin/passkeys')
    expect(links[userIndex + 1].text()).toBe('Passkey 管理')
  })

  it('一名用户只占一个外层行，两个密钥保留独立名称、上海时间和撤销按钮', async () => {
    const wrapper = await mountPage()
    const rows = wrapper.findAll('.el-table__body tbody > tr')
    expect(rows).toHaveLength(1)
    expect(rows[0].text().match(/first@example.test/g)).toHaveLength(1)
    expect(rows[0].text()).toContain('2 / 2')
    const keys = rows[0].findAll('.passkey-record')
    expect(keys).toHaveLength(2)
    expect(keys[0].text()).toContain('Windows Hello')
    expect(keys[0].text()).toContain('2026-10-12 14:30')
    expect(keys[0].text()).toContain('2026-10-15 09:18')
    expect(keys[1].text()).toContain('尚未使用')
    for (const key of keys) {
      expect(key.text()).toContain('创建时间')
      expect(key.text()).toContain('上次使用')
      expect(key.get('button').attributes('aria-label')).toContain('first@example.test')
    }
    expect(wrapper.text()).toContain('共 1 位用户')
  })

  it('按用户分页并使用修剪关键词搜索，搜索重新回到第一页', async () => {
    setList([firstUser], 31)
    const wrapper = await mountPage()
    await wrapper.get('.el-pagination .btn-next').trigger('click')
    await flushPromises()
    expect(listRequests().at(-1).params).toEqual({ page: 2, limit: 15, keyword: '' })
    await wrapper.get('.passkey-search input').setValue('  手机备用密钥  ')
    await wrapper.get('.passkey-search-form').trigger('submit')
    await flushPromises()
    expect(listRequests().at(-1).params).toEqual({ page: 1, limit: 15, keyword: '手机备用密钥' })
    expect(wrapper.text()).toContain('共 31 位用户')
    expect(wrapper.findAll('.passkey-record')).toHaveLength(2)
    expect(listRequests()[0].headers.Authorization).toBe('Bearer admin-session')
  })

  it('空结果与用户无密钥都提供明确空状态', async () => {
    setList([], 0)
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('暂无 Passkey 用户')
    expect(wrapper.text()).toContain('共 0 位用户')
    setList([{ ...firstUser, passkeys: [], passkey_count: 0 }])
    await wrapper.get('.passkey-search-form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('尚未添加 Passkey')
    expect(wrapper.findAll('.passkey-revoke')).toHaveLength(0)
  })

  it.each([[0, 11, 'Windows Hello'], [1, 12, '手机备用密钥']])('第 %s 个撤销按钮仅删除所选密钥并刷新完整分组', async (index, id, name) => {
    const wrapper = await mountPage()
    responses.set(`delete /passkeys/${id}`, () => {
      setList([{ ...firstUser, passkey_count: 1, passkeys: firstUser.passkeys.filter(key => key.id !== id) }])
      return { code: 0, data: { message: 'Passkey 已撤销' } }
    })
    await wrapper.findAll('.passkey-revoke')[index].trigger('click')
    await flushPromises()
    const [copy, , options] = messages.confirm.mock.calls[0]
    expect(copy).toContain('first@example.test')
    expect(copy).toContain(name)
    expect(copy).toContain('仅撤销该登录密钥')
    expect(options).toMatchObject({ confirmButtonText: '确定撤销', cancelButtonText: '取消', type: 'warning' })
    const deletions = requests.filter(request => request.method === 'delete')
    expect(deletions.map(request => request.url)).toEqual([`/passkeys/${id}`])
    expect(deletions[0].data).toBeUndefined()
    expect(wrapper.findAll('.passkey-record')).toHaveLength(1)
    expect(wrapper.text()).toContain('1 / 2')
    expect(messages.success).toHaveBeenCalledOnce()
  })

  it('确认窗口与请求期间锁定所有用户操作，取消时恢复且不发送撤销', async () => {
    setList([firstUser, secondUser])
    const confirmation = deferred()
    messages.confirm.mockReturnValue(confirmation.promise)
    const wrapper = await mountPage()
    await wrapper.findAll('.passkey-revoke')[0].trigger('click')
    for (const button of wrapper.findAll('.passkey-revoke')) expect(button.attributes('disabled')).toBeDefined()
    await wrapper.findAll('.passkey-revoke')[2].trigger('click')
    await wrapper.get('.passkey-search-form').trigger('submit')
    expect(messages.confirm).toHaveBeenCalledOnce()
    expect(listRequests()).toHaveLength(1)
    confirmation.resolve('confirm')
    const deletion = deferred()
    responses.set('delete /passkeys/11', () => deletion.promise)
    await flushPromises()
    expect(wrapper.findAll('.passkey-revoke')[2].attributes('disabled')).toBeDefined()
    deletion.resolve({ code: 0, data: { message: 'Passkey 已撤销' } })
    await flushPromises()
    expect(wrapper.findAll('.passkey-revoke')[2].attributes('disabled')).toBeUndefined()
    messages.confirm.mockRejectedValueOnce('cancel')
    await wrapper.findAll('.passkey-revoke')[1].trigger('click')
    await flushPromises()
    expect(requests.filter(request => request.method === 'delete')).toHaveLength(1)
    expect(messages.error).not.toHaveBeenCalled()
  })

  it.each(['list', 'revoke'])('%s 的 HTTP 错误只提示一次，失败保留数据并可重试', async stage => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const wrapper = await mountPage()
      const error = Object.assign(new Error('HTTP failed'), { response: { status: 500, data: { code: 500, message: '操作失败，请重试' } } })
      responses.set(stage === 'list' ? 'get /passkeys' : 'delete /passkeys/11', error)
      await wrapper.get(stage === 'list' ? '.passkey-search-form' : '.passkey-revoke').trigger(stage === 'list' ? 'submit' : 'click')
      await flushPromises()
      expect(messages.error).toHaveBeenCalledTimes(1)
      expect(wrapper.findAll('.passkey-record')).toHaveLength(2)
      expect(wrapper.get('.passkey-revoke').attributes('disabled')).toBeUndefined()
    } finally { consoleError.mockRestore() }
  })

  it('业务错误显示一次，初次加载失败提供重试入口', async () => {
    responses.set('get /passkeys', { code: 1001, message: '暂时无法查询', data: null })
    const wrapper = await mountPage()
    expect(messages.error).toHaveBeenCalledTimes(1)
    expect(messages.error).toHaveBeenCalledWith('暂时无法查询')
    expect(wrapper.find('[role="status"]').exists()).toBe(true)
    setList()
    await wrapper.get('.passkey-retry').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.passkey-record')).toHaveLength(2)
  })

  it('删除末页最后一位用户的最后密钥后回到有效页', async () => {
    setList([secondUser], 16)
    const wrapper = await mountPage()
    await wrapper.get('.el-pagination .btn-next').trigger('click')
    await flushPromises()
    responses.set('delete /passkeys/13', () => {
      setList([firstUser], 15)
      return { code: 0, data: { message: 'Passkey 已撤销' } }
    })
    await wrapper.get('.passkey-revoke').trigger('click')
    await flushPromises()
    expect(listRequests().at(-1).params.page).toBe(1)
    expect(wrapper.text()).toContain('first@example.test')
  })
})
