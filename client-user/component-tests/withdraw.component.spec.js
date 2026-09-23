import { defineComponent, h, nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  getWithdrawalOverview: vi.fn(),
  getReferralSummary: vi.fn(),
  getBalanceTransactions: vi.fn(),
  createWithdrawal: vi.fn()
}))

const messageMocks = vi.hoisted(() => ({
  warning: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  confirm: vi.fn(),
  close: vi.fn()
}))

vi.mock('@/api', () => ({
  default: {
    user: apiMocks
  }
}))

vi.mock('element-plus', () => ({
  ElMessage: {
    warning: messageMocks.warning,
    success: messageMocks.success,
    error: messageMocks.error
  },
  ElMessageBox: {
    confirm: messageMocks.confirm,
    close: messageMocks.close
  }
}))

import Withdraw from '../src/views/user/Withdraw.vue'

const wrappers = []

/** 创建可由测试精确控制完成顺序的 Promise。 */
function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

/** 返回可提交提现的默认概览，可覆盖余额或 pending 等关键分支。 */
function overviewResponse(overrides = {}) {
  return {
    code: 0,
    data: {
      balance: 10000,
      payment_type: 'wechat',
      has_payment_qr: true,
      minimum_withdrawal_amount: 2000,
      pending_withdrawal: null,
      ...overrides
    }
  }
}

/** 返回后端真实分页结构，供乱序和刷新语义测试使用。 */
function transactionResponse({ list = [], total = list.length, page = 1 } = {}) {
  return { code: 0, data: { list, total, page, limit: 20 } }
}

/** 输入框替身保留 v-model、回车事件、disabled 与可访问属性。 */
const ElInputStub = defineComponent({
  name: 'ElInput',
  inheritAttrs: false,
  props: {
    modelValue: { type: String, default: '' },
    disabled: Boolean,
    maxlength: [Number, String],
    placeholder: String
  },
  emits: ['update:modelValue', 'keyup', 'clear'],
  setup(props, { attrs, emit }) {
    return () => h('input', {
      ...attrs,
      value: props.modelValue,
      disabled: props.disabled,
      maxlength: props.maxlength,
      placeholder: props.placeholder,
      onInput: event => emit('update:modelValue', event.target.value),
      onKeyup: event => emit('keyup', event)
    })
  }
})

/** 下拉框替身保留 v-model、change 与 aria-label 透传。 */
const ElSelectStub = defineComponent({
  name: 'ElSelect',
  inheritAttrs: false,
  props: {
    modelValue: { type: String, default: '' }
  },
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

/** 按钮替身把组件 click 转换为真实按钮点击，保留禁用守卫。 */
const ElButtonStub = defineComponent({
  name: 'ElButton',
  inheritAttrs: false,
  props: {
    disabled: Boolean,
    loading: Boolean
  },
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

/** 分页替身提供跳到第二页的真实交互入口。 */
const ElPaginationStub = defineComponent({
  name: 'ElPagination',
  emits: ['current-change', 'update:currentPage'],
  setup(_, { emit }) {
    return () => h('button', {
      class: 'go-page-two',
      onClick: () => {
        emit('update:currentPage', 2)
        emit('current-change', 2)
      }
    }, '第 2 页')
  }
})

const PassthroughStub = defineComponent({
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => h('div', attrs, slots.default?.())
  }
})

/** 表格列不主动执行需要 row 参数的作用域插槽，移动卡片仍覆盖真实流水渲染。 */
const ElTableColumnStub = defineComponent({
  name: 'ElTableColumn',
  setup() {
    return () => h('div')
  }
})

const ElOptionStub = defineComponent({
  name: 'ElOption',
  props: ['label', 'value'],
  setup(props) {
    return () => h('option', { value: props.value }, props.label)
  }
})

/** 挂载真实 Withdraw 组件，仅替换外部 UI 外壳与 HTTP API。 */
function mountWithdraw() {
  const wrapper = mount(Withdraw, {
    global: {
      directives: { loading: {} },
      stubs: {
        ElAlert: PassthroughStub,
        ElButton: ElButtonStub,
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

/** 等待 API Promise、Vue 响应式更新与 DOM patch 全部完成。 */
async function settle() {
  await flushPromises()
  await nextTick()
}

/** 配置除当前断言目标之外的默认成功 API。 */
function mockDefaultApis() {
  apiMocks.getWithdrawalOverview.mockResolvedValue(overviewResponse())
  apiMocks.getReferralSummary.mockResolvedValue({ code: 0, data: { reward_amount: 1234 } })
  apiMocks.getBalanceTransactions.mockResolvedValue(transactionResponse())
  apiMocks.createWithdrawal.mockResolvedValue({ code: 0, data: { id: 9 } })
  messageMocks.confirm.mockResolvedValue('confirm')
}

beforeEach(() => {
  vi.resetAllMocks()
  mockDefaultApis()
})

afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
})

describe('Withdraw', () => {
  it('概览失败时仍独立展示奖励加载态', async () => {
    const reward = deferred()
    apiMocks.getWithdrawalOverview.mockRejectedValue(new Error('概览不可用'))
    apiMocks.getReferralSummary.mockReturnValue(reward.promise)

    const wrapper = mountWithdraw()
    await settle()

    expect(wrapper.text()).toContain('钱包信息加载失败')
    expect(wrapper.text()).toContain('累计奖励')
    expect(wrapper.text()).toContain('加载中')
    reward.resolve({ code: 0, data: { reward_amount: 1234 } })
  })

  it('概览失败时仍独立展示奖励错误态', async () => {
    apiMocks.getWithdrawalOverview.mockRejectedValue(new Error('概览不可用'))
    apiMocks.getReferralSummary.mockRejectedValue(new Error('奖励不可用'))

    const wrapper = mountWithdraw()
    await settle()

    expect(wrapper.text()).toContain('钱包信息加载失败')
    expect(wrapper.text()).toContain('累计奖励')
    expect(wrapper.text()).toContain('加载失败')
  })

  it('概览失败时仍独立展示奖励成功值', async () => {
    apiMocks.getWithdrawalOverview.mockRejectedValue(new Error('概览不可用'))

    const wrapper = mountWithdraw()
    await settle()

    expect(wrapper.text()).toContain('钱包信息加载失败')
    expect(wrapper.text()).toContain('累计奖励')
    expect(wrapper.text()).toContain('¥12.34')
  })

  it('搜索与类型筛选控件提供可访问名称', async () => {
    const wrapper = mountWithdraw()
    await settle()

    expect(wrapper.get('[aria-label="搜索余额明细"]')).toBeTruthy()
    expect(wrapper.get('[aria-label="筛选余额明细类型"]')).toBeTruthy()
  })

  it.each(['resolve', 'reject'])('卸载时不关闭全局确认框且延迟 %s 后不再提交', async result => {
    const confirmation = deferred()
    messageMocks.confirm.mockReturnValue(confirmation.promise)
    const wrapper = mountWithdraw()
    await settle()
    await wrapper.get('#withdraw-amount').setValue('20.00')
    await wrapper.get('.submit-button').trigger('click')
    await nextTick()
    expect(messageMocks.confirm).toHaveBeenCalledOnce()

    wrapper.unmount()
    if (result === 'resolve') {
      confirmation.resolve('confirm')
    } else {
      confirmation.reject(new Error('cancel'))
    }
    await settle()

    expect(messageMocks.close).not.toHaveBeenCalled()
    expect(apiMocks.createWithdrawal).not.toHaveBeenCalled()
  })

  it('确认期间固定金额与收款展示快照并按原始金额字符串提交', async () => {
    const confirmation = deferred()
    messageMocks.confirm.mockReturnValue(confirmation.promise)
    const wrapper = mountWithdraw()
    await settle()
    const amountInput = wrapper.get('#withdraw-amount')
    await amountInput.setValue('20.00')
    await wrapper.get('.submit-button').trigger('click')
    await nextTick()
    wrapper.findAllComponents(ElInputStub)[0].vm.$emit('update:modelValue', '30.00')
    await nextTick()
    expect(wrapper.get('#withdraw-amount').element.value).toBe('30.00')

    confirmation.resolve('confirm')
    await settle()

    expect(messageMocks.confirm.mock.calls[0][0]).toContain('¥20.00 至微信收款码')
    expect(apiMocks.createWithdrawal).toHaveBeenCalledWith({ amount: '20.00' })
  })

  it.each(['2e1', ' 20', '20 ', '+20', '20.001', '.5', '20.'])('严格拒绝非法金额字符串 %s', async amount => {
    const wrapper = mountWithdraw()
    await settle()
    await wrapper.get('#withdraw-amount').setValue(amount)
    await wrapper.get('.submit-button').trigger('click')
    await settle()

    expect(messageMocks.confirm).not.toHaveBeenCalled()
    expect(apiMocks.createWithdrawal).not.toHaveBeenCalled()
    expect(messageMocks.warning).toHaveBeenCalledWith('请输入正数金额，最多保留两位小数')
  })

  it('pending 状态禁用提交并阻止进入确认流程', async () => {
    apiMocks.getWithdrawalOverview.mockResolvedValue(overviewResponse({
      pending_withdrawal: { id: 8, amount: 2000, created_at: 1700000000000 }
    }))
    const wrapper = mountWithdraw()
    await settle()

    expect(wrapper.get('.submit-button').attributes('disabled')).toBeDefined()
    await wrapper.get('.submit-button').trigger('click')
    expect(messageMocks.confirm).not.toHaveBeenCalled()
    expect(apiMocks.createWithdrawal).not.toHaveBeenCalled()
  })

  it('忽略后完成的旧流水响应，保留最新搜索结果', async () => {
    const oldRequest = deferred()
    const newRequest = deferred()
    apiMocks.getBalanceTransactions
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise)
    const wrapper = mountWithdraw()
    await settle()
    await wrapper.get('.search-input').setValue('新的')
    await wrapper.get('.filters button').trigger('click')

    newRequest.resolve(transactionResponse({
      list: [{ id: 2, type: 'referral_reward', amount: 200, balance_after: 5200, description: '最新流水', created_at: 1700000000000 }]
    }))
    await settle()
    expect(wrapper.text()).toContain('最新流水')

    oldRequest.resolve(transactionResponse({
      list: [{ id: 1, type: 'opening_balance', amount: 100, balance_after: 5000, description: '旧流水', created_at: 1700000000000 }]
    }))
    await settle()
    expect(wrapper.text()).toContain('最新流水')
    expect(wrapper.text()).not.toContain('旧流水')
  })

  it('提交成功后强制刷新概览和第一页流水', async () => {
    apiMocks.getBalanceTransactions.mockResolvedValue(transactionResponse({ total: 30 }))
    const wrapper = mountWithdraw()
    await settle()
    await wrapper.get('.go-page-two').trigger('click')
    await settle()
    await wrapper.get('#withdraw-amount').setValue('20.00')
    await wrapper.get('.submit-button').trigger('click')
    await settle()

    expect(apiMocks.getBalanceTransactions.mock.calls.map(([params]) => params.page)).toEqual([1, 2, 1])
    expect(apiMocks.getWithdrawalOverview).toHaveBeenCalledTimes(2)
    expect(messageMocks.success).toHaveBeenCalledWith('提现申请已提交')
  })

  it('409 冲突仅由全局层提示并由页面刷新 pending 状态', async () => {
    const conflict = Object.assign(new Error('已有处理中提现申请'), {
      response: { status: 409, data: { code: 409 } },
      userMessage: '已有处理中提现申请'
    })
    apiMocks.createWithdrawal.mockRejectedValue(conflict)
    const wrapper = mountWithdraw()
    await settle()
    await wrapper.get('#withdraw-amount').setValue('20.00')
    await wrapper.get('.submit-button').trigger('click')
    await settle()

    expect(messageMocks.error).not.toHaveBeenCalled()
    expect(apiMocks.getWithdrawalOverview).toHaveBeenCalledTimes(2)
  })

  it('余额明细使用 section，避免嵌套 Layout 主内容语义', () => {
    const wrapper = mountWithdraw()
    expect(wrapper.find('main').exists()).toBe(false)
    expect(wrapper.find('section.transactions-panel').exists()).toBe(true)
  })
})
