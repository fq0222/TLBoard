import { defineComponent, h, nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  getWalletUsers: vi.fn(),
  getWalletUserDetail: vi.fn(),
  getWalletTransactions: vi.fn(),
  getWithdrawalQr: vi.fn(),
  completeWithdrawal: vi.fn(),
  rejectWithdrawal: vi.fn()
}))

const messageMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  confirm: vi.fn(),
  prompt: vi.fn()
}))

vi.mock('@/api', () => ({ default: { admin: apiMocks } }))
vi.mock('element-plus/es/components/message/index.mjs', () => ({
  ElMessage: {
    success: messageMocks.success,
    error: messageMocks.error,
    warning: messageMocks.warning
  }
}))
vi.mock('element-plus/es/components/message-box/index.mjs', () => ({
  ElMessageBox: {
    confirm: messageMocks.confirm,
    prompt: messageMocks.prompt
  }
}))

import Wallets from '../src/views/Wallets.vue'

const wrappers = []

/** 创建可控制完成顺序的 Promise，用于验证旧响应不能覆盖新选择。 */
function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function walletUser(id, overrides = {}) {
  return {
    user_id: id,
    email: `user${id}@example.com`,
    balance: 1234,
    reward_total: 5678,
    pending_withdrawal_id: id === 1 ? 101 : null,
    pending_withdrawal_amount: id === 1 ? 2000 : 0,
    pending_withdrawal_status: id === 1 ? 'pending' : null,
    ...overrides
  }
}

function listResponse(list = [walletUser(1), walletUser(2)]) {
  return { code: 0, data: { list, total: list.length, pending_count: 1, page: 1, limit: 20 } }
}

function detailResponse(id, pending = id === 1) {
  return {
    code: 0,
    data: {
      user: { id, email: `user${id}@example.com`, balance: 1234, reward_total: 5678 },
      pending_withdrawal: pending ? {
        id: 101,
        user_id: id,
        amount: 2000,
        payment_type: 'wechat',
        status: 'pending',
        created_at: 1700000000
      } : null
    }
  }
}

function transactionResponse(id, description = `用户${id}流水`) {
  return {
    code: 0,
    data: {
      list: [{
        id: id * 10,
        type: 'referral_reward',
        amount: 500,
        balance_after: 1234,
        description,
        created_at: 1700000000
      }],
      total: 1,
      page: 1,
      limit: 20
    }
  }
}

const PassthroughStub = defineComponent({
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => h('div', attrs, [slots.default?.(), slots.header?.(), slots.footer?.()])
  }
})

/** 输入框替身保留 v-model、input 和 clear 行为。 */
const ElInputStub = defineComponent({
  name: 'ElInput',
  inheritAttrs: false,
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue', 'input', 'clear'],
  setup(props, { attrs, emit }) {
    return () => h('input', {
      ...attrs,
      value: props.modelValue,
      onInput: event => {
        emit('update:modelValue', event.target.value)
        emit('input', event.target.value)
      }
    })
  }
})

/** 下拉框替身保留类型筛选 change 事件。 */
const ElSelectStub = defineComponent({
  name: 'ElSelect',
  inheritAttrs: false,
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue', 'change'],
  setup(props, { attrs, emit, slots }) {
    return () => h('select', {
      ...attrs,
      value: props.modelValue,
      onChange: event => {
        emit('update:modelValue', event.target.value)
        emit('change', event.target.value)
      }
    }, slots.default?.())
  }
})

const ElOptionStub = defineComponent({
  name: 'ElOption',
  props: ['label', 'value'],
  setup(props) {
    return () => h('option', { value: props.value }, props.label)
  }
})

/** 按钮替身使用原生 disabled，真实阻止处理中的重复点击。 */
const ElButtonStub = defineComponent({
  name: 'ElButton',
  inheritAttrs: false,
  props: { disabled: Boolean, loading: Boolean },
  emits: ['click'],
  setup(props, { attrs, emit, slots }) {
    return () => h('button', {
      ...attrs,
      disabled: props.disabled,
      'data-loading': String(props.loading),
      onClick: event => emit('click', event)
    }, slots.default?.())
  }
})

/** 分页替身可触发第二页，用类名区分列表和流水。 */
const ElPaginationStub = defineComponent({
  name: 'ElPagination',
  inheritAttrs: false,
  emits: ['current-change', 'update:currentPage'],
  setup(_, { attrs, emit }) {
    return () => h('button', {
      ...attrs,
      onClick: () => {
        emit('update:currentPage', 2)
        emit('current-change', 2)
      }
    }, '第 2 页')
  }
})

/** 抽屉替身只在打开时渲染，并提供可验证关闭生命周期的按钮。 */
const ElDrawerStub = defineComponent({
  name: 'ElDrawer',
  inheritAttrs: false,
  props: { modelValue: Boolean },
  emits: ['update:modelValue', 'closed'],
  setup(props, { attrs, emit, slots }) {
    return () => props.modelValue
      ? h('aside', { ...attrs, class: ['drawer-stub', attrs.class] }, [
          slots.header?.(),
          slots.default?.(),
          h('button', {
            class: 'drawer-close',
            onClick: () => {
              emit('update:modelValue', false)
              emit('closed')
            }
          }, '关闭')
        ])
      : null
  }
})

const ElTableColumnStub = defineComponent({
  name: 'ElTableColumn',
  setup() {
    return () => h('div')
  }
})

function mountWallets() {
  const wrapper = mount(Wallets, {
    global: {
      directives: { loading: {} },
      stubs: {
        ElAlert: PassthroughStub,
        ElButton: ElButtonStub,
        ElDescriptions: PassthroughStub,
        ElDescriptionsItem: PassthroughStub,
        ElDrawer: ElDrawerStub,
        ElEmpty: PassthroughStub,
        ElIcon: PassthroughStub,
        ElInput: ElInputStub,
        ElOption: ElOptionStub,
        ElPagination: ElPaginationStub,
        ElSelect: ElSelectStub,
        ElTable: PassthroughStub,
        ElTableColumn: ElTableColumnStub,
        ElTag: PassthroughStub
      }
    }
  })
  wrappers.push(wrapper)
  return wrapper
}

async function settle() {
  await flushPromises()
  await nextTick()
}

beforeEach(() => {
  vi.resetAllMocks()
  apiMocks.getWalletUsers.mockResolvedValue(listResponse())
  apiMocks.getWalletUserDetail.mockImplementation(id => Promise.resolve(detailResponse(id)))
  apiMocks.getWalletTransactions.mockImplementation(id => Promise.resolve(transactionResponse(id)))
  apiMocks.getWithdrawalQr.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
  apiMocks.completeWithdrawal.mockResolvedValue({ code: 0, data: { status: 'completed' } })
  apiMocks.rejectWithdrawal.mockResolvedValue({ code: 0, data: { status: 'rejected' } })
  messageMocks.confirm.mockResolvedValue('confirm')
  messageMocks.prompt.mockResolvedValue({ value: '资料不符' })
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn()
      .mockReturnValueOnce('blob:wallet-qr-1')
      .mockReturnValueOnce('blob:wallet-qr-2')
      .mockReturnValue('blob:wallet-qr-more')
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn()
  })
})

afterEach(() => {
  vi.useRealTimers()
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
})

describe('Wallets', () => {
  it('展示余额、累计奖励和待处理提现，并防抖邮箱搜索', async () => {
    vi.useFakeTimers()
    const wrapper = mountWallets()
    await settle()

    expect(wrapper.text()).toContain('user1@example.com')
    expect(wrapper.text()).toContain('¥12.34')
    expect(wrapper.text()).toContain('¥56.78')
    expect(wrapper.text()).toContain('¥20.00')
    expect(wrapper.text()).toContain('待处理')
    expect(wrapper.get('.pending-withdrawal-notice').attributes('title')).toBe('当前有 1 笔待处理提现，已按申请时间优先展示')

    await wrapper.get('.wallet-email-search').setValue('  next@example.com  ')
    await vi.advanceTimersByTimeAsync(299)
    expect(apiMocks.getWalletUsers).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await settle()

    expect(apiMocks.getWalletUsers).toHaveBeenLastCalledWith({
      email: 'next@example.com',
      page: 1,
      limit: 20
    })
  })

  it('关闭、换用户和卸载时都释放二维码 Object URL', async () => {
    const wrapper = mountWallets()
    await settle()

    await wrapper.findAll('.view-wallet-detail')[0].trigger('click')
    await settle()
    expect(wrapper.get('.withdrawal-qr').attributes('src')).toBe('blob:wallet-qr-1')

    await wrapper.get('.drawer-close').trigger('click')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:wallet-qr-1')

    await wrapper.findAll('.view-wallet-detail')[0].trigger('click')
    await settle()
    await wrapper.findAll('.view-wallet-detail')[1].trigger('click')
    await settle()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:wallet-qr-2')
    expect(apiMocks.getWithdrawalQr).toHaveBeenCalledTimes(2)

    await wrapper.findAll('.view-wallet-detail')[0].trigger('click')
    await settle()
    wrapper.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:wallet-qr-more')
  })

  it('忽略后完成的旧用户详情与流水响应', async () => {
    const detailOne = deferred()
    const detailTwo = deferred()
    const transactionOne = deferred()
    const transactionTwo = deferred()
    apiMocks.getWalletUserDetail.mockImplementation(id => id === 1 ? detailOne.promise : detailTwo.promise)
    apiMocks.getWalletTransactions.mockImplementation(id => id === 1 ? transactionOne.promise : transactionTwo.promise)
    const wrapper = mountWallets()
    await settle()

    await wrapper.findAll('.view-wallet-detail')[0].trigger('click')
    await wrapper.findAll('.view-wallet-detail')[1].trigger('click')
    detailTwo.resolve(detailResponse(2, false))
    transactionTwo.resolve(transactionResponse(2, '最新用户流水'))
    await settle()
    expect(wrapper.get('.drawer-stub').text()).toContain('user2@example.com')
    expect(wrapper.get('.drawer-stub').text()).toContain('最新用户流水')

    detailOne.resolve(detailResponse(1, true))
    transactionOne.resolve(transactionResponse(1, '过期用户流水'))
    await settle()
    expect(wrapper.get('.drawer-stub').text()).toContain('user2@example.com')
    expect(wrapper.get('.drawer-stub').text()).toContain('最新用户流水')
    expect(wrapper.get('.drawer-stub').text()).not.toContain('过期用户流水')
    expect(apiMocks.getWithdrawalQr).not.toHaveBeenCalled()
  })

  it('流水翻到第二页时仍使用当前选中的用户编号', async () => {
    apiMocks.getWalletUsers.mockResolvedValue(listResponse([walletUser(7)]))
    apiMocks.getWalletUserDetail.mockResolvedValue(detailResponse(7, false))
    apiMocks.getWalletTransactions.mockImplementation(id => {
      const response = transactionResponse(id)
      response.data.total = 40
      return Promise.resolve(response)
    })
    const wrapper = mountWallets()
    await settle()

    await wrapper.get('.view-wallet-detail').trigger('click')
    await settle()
    await wrapper.get('.transaction-pagination').trigger('click')
    await settle()

    expect(apiMocks.getWalletTransactions).toHaveBeenLastCalledWith(7, {
      page: 2,
      limit: 20
    })
  })

  it('确认期间禁用两个处理按钮，成功后刷新列表、详情和流水', async () => {
    const confirmation = deferred()
    messageMocks.confirm.mockReturnValue(confirmation.promise)
    const wrapper = mountWallets()
    await settle()
    await wrapper.findAll('.view-wallet-detail')[0].trigger('click')
    await settle()

    await wrapper.get('.complete-withdrawal').trigger('click')
    await nextTick()
    expect(wrapper.get('.complete-withdrawal').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.reject-withdrawal').attributes('disabled')).toBeDefined()
    await wrapper.get('.complete-withdrawal').trigger('click')
    expect(messageMocks.confirm).toHaveBeenCalledOnce()

    confirmation.resolve('confirm')
    await settle()

    expect(apiMocks.completeWithdrawal).toHaveBeenCalledOnce()
    expect(apiMocks.getWalletUsers).toHaveBeenCalledTimes(2)
    expect(apiMocks.getWalletUserDetail).toHaveBeenCalledTimes(2)
    expect(apiMocks.getWalletTransactions).toHaveBeenCalledTimes(2)
    expect(messageMocks.success).toHaveBeenCalledWith('提现已确认完成')
  })

  it('提现处理成功后即使列表刷新失败，也立即递减并广播待处理数量', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const countEvents = []
    const listener = event => countEvents.push(event.detail.count)
    window.addEventListener('wallet-pending-count-changed', listener)
    try {
      apiMocks.getWalletUsers
        .mockResolvedValueOnce(listResponse())
        .mockRejectedValueOnce(new Error('列表刷新失败'))
      const wrapper = mountWallets()
      await settle()
      await wrapper.findAll('.view-wallet-detail')[0].trigger('click')
      await settle()

      await wrapper.get('.complete-withdrawal').trigger('click')
      await settle()

      expect(countEvents).toContain(0)
      expect(wrapper.find('.pending-withdrawal-notice').exists()).toBe(false)
    } finally {
      window.removeEventListener('wallet-pending-count-changed', listener)
      consoleError.mockRestore()
    }
  })

  it.each([
    ['确认', '.complete-withdrawal', apiMocks.completeWithdrawal],
    ['驳回', '.reject-withdrawal', apiMocks.rejectWithdrawal]
  ])('处理用户 A 的提现时切换到 B，%s成功后只刷新列表而不回刷 A 详情', async (_, selector, actionMock) => {
    const action = deferred()
    actionMock.mockReturnValue(action.promise)
    const wrapper = mountWallets()
    await settle()

    await wrapper.findAll('.view-wallet-detail')[0].trigger('click')
    await settle()
    await wrapper.get(selector).trigger('click')
    await nextTick()
    expect(actionMock).toHaveBeenCalledOnce()

    await wrapper.findAll('.view-wallet-detail')[1].trigger('click')
    await settle()
    expect(wrapper.get('.drawer-stub').text()).toContain('user2@example.com')

    action.resolve({ code: 0, data: { status: selector.includes('complete') ? 'completed' : 'rejected' } })
    await settle()

    expect(apiMocks.getWalletUsers).toHaveBeenCalledTimes(2)
    expect(apiMocks.getWalletUserDetail.mock.calls.map(([id]) => id)).toEqual([1, 2])
    expect(apiMocks.getWalletTransactions.mock.calls.map(([id]) => id)).toEqual([1, 2])
    expect(wrapper.get('.drawer-stub').text()).toContain('user2@example.com')
  })

  it.each([
    ['确认', '.complete-withdrawal', apiMocks.completeWithdrawal],
    ['驳回', '.reject-withdrawal', apiMocks.rejectWithdrawal]
  ])('%s成功后立即清除待处理状态，详情刷新失败也不会恢复旧二维码', async (_, selector, actionMock) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const wrapper = mountWallets()
      await settle()
      await wrapper.findAll('.view-wallet-detail')[0].trigger('click')
      await settle()
      const qrUrl = wrapper.get('.withdrawal-qr').attributes('src')
      const failedRefresh = deferred()
      apiMocks.getWalletUserDetail.mockReturnValueOnce(failedRefresh.promise)

      await wrapper.get(selector).trigger('click')
      await settle()

      expect(actionMock).toHaveBeenCalledOnce()
      expect(wrapper.find('.pending-card').exists()).toBe(false)
      expect(wrapper.find('.withdrawal-qr').exists()).toBe(false)
      expect(wrapper.find('[title="当前没有待处理提现"]').exists()).toBe(true)
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(qrUrl)

      failedRefresh.reject(new Error('详情刷新失败'))
      await settle()
      expect(wrapper.find('.pending-card').exists()).toBe(false)
      expect(wrapper.find('.withdrawal-qr').exists()).toBe(false)
    } finally {
      consoleError.mockRestore()
    }
  })

  it('驳回输入框使用非空校验并提交修剪后的原因', async () => {
    const wrapper = mountWallets()
    await settle()
    await wrapper.findAll('.view-wallet-detail')[0].trigger('click')
    await settle()
    await wrapper.get('.reject-withdrawal').trigger('click')
    await settle()

    const promptOptions = messageMocks.prompt.mock.calls[0][2]
    expect(promptOptions.confirmButtonText).toBe('确定驳回')
    expect(promptOptions.cancelButtonText).toBe('取消')
    expect(promptOptions.inputValidator('   ')).toBe('请填写驳回原因')
    expect(promptOptions.inputValidator('资料不符')).toBe(true)
    expect(apiMocks.rejectWithdrawal).toHaveBeenCalledWith(101, '资料不符')
  })
})
