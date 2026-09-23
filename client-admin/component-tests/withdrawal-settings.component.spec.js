import { defineComponent, h, nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  getAdmins: vi.fn(),
  getEmailConfig: vi.fn(),
  getResourceConfig: vi.fn(),
  getTrafficConfig: vi.fn(),
  getSubscriptionConfig: vi.fn(),
  getTelegramConfig: vi.fn(),
  getTelegramAdminBindings: vi.fn(),
  getWithdrawalSettings: vi.fn(),
  saveWithdrawalSettings: vi.fn()
}))

const messageMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn()
}))

vi.mock('@/api', () => ({ default: { admin: apiMocks } }))
vi.mock('@/stores/admin', () => ({
  useAdminStore: () => ({ changePassword: vi.fn() })
}))
vi.mock('element-plus/es/components/message/index.mjs', () => ({
  ElMessage: messageMocks
}))
vi.mock('element-plus/es/components/message-box/index.mjs', () => ({
  ElMessageBox: { confirm: vi.fn() }
}))

import Settings from '../src/views/Settings.vue'

const PassthroughStub = defineComponent({
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => h('div', attrs, [slots.default?.(), slots.footer?.(), slots.dropdown?.()])
  }
})

/** 表格列不执行需要 row 参数的作用域插槽；提现设置测试不依赖表格内容。 */
const ElTableColumnStub = defineComponent({
  name: 'ElTableColumn',
  setup() {
    return () => h('div')
  }
})

/** 数值输入替身保留 v-model 数字语义，避免测试框架替代金额转换逻辑。 */
const ElInputNumberStub = defineComponent({
  name: 'ElInputNumber',
  inheritAttrs: false,
  props: { modelValue: Number },
  emits: ['update:modelValue'],
  setup(props, { attrs, emit }) {
    return () => h('input', {
      ...attrs,
      type: 'number',
      value: props.modelValue,
      onInput: event => emit('update:modelValue', Number(event.target.value))
    })
  }
})

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

/** 挂载真实设置页，仅替换 UI 外壳与 HTTP 边界。 */
function mountSettings() {
  return mount(Settings, {
    global: {
      stubs: {
        ElAlert: PassthroughStub,
        ElButton: ElButtonStub,
        ElDescriptions: PassthroughStub,
        ElDescriptionsItem: PassthroughStub,
        ElDialog: PassthroughStub,
        ElForm: PassthroughStub,
        ElFormItem: PassthroughStub,
        ElIcon: PassthroughStub,
        ElInput: PassthroughStub,
        ElInputNumber: ElInputNumberStub,
        ElOption: PassthroughStub,
        ElSelect: PassthroughStub,
        ElSwitch: PassthroughStub,
        ElTabPane: PassthroughStub,
        ElTabs: PassthroughStub,
        ElTable: PassthroughStub,
        ElTableColumn: ElTableColumnStub,
        ElTag: PassthroughStub
      }
    }
  })
}

async function settle() {
  await flushPromises()
  await nextTick()
}

beforeEach(() => {
  vi.resetAllMocks()
  apiMocks.getAdmins.mockResolvedValue({ code: 0, data: { list: [] } })
  apiMocks.getEmailConfig.mockResolvedValue({ code: 0, data: {} })
  apiMocks.getResourceConfig.mockResolvedValue({ code: 0, data: {} })
  apiMocks.getTrafficConfig.mockResolvedValue({ code: 0, data: {} })
  apiMocks.getSubscriptionConfig.mockResolvedValue({ code: 0, data: {} })
  apiMocks.getTelegramConfig.mockResolvedValue({ code: 0, data: {} })
  apiMocks.getTelegramAdminBindings.mockResolvedValue({ code: 0, data: { list: [] } })
  apiMocks.getWithdrawalSettings.mockResolvedValue({
    code: 0,
    data: { minimum_withdrawal_amount: 2034 }
  })
  apiMocks.saveWithdrawalSettings.mockResolvedValue({
    code: 0,
    data: { minimum_withdrawal_amount: 2567 }
  })
})

describe('Settings 提现设置', () => {
  it('将后端整数分显示为元，并按精确整数分保存', async () => {
    const wrapper = mountSettings()
    await settle()

    const input = wrapper.get('.minimum-withdrawal-input')
    expect(input.element.value).toBe('20.34')
    await input.setValue('25.67')
    await wrapper.get('.save-withdrawal-settings').trigger('click')
    await settle()

    expect(apiMocks.saveWithdrawalSettings).toHaveBeenCalledWith({
      minimum_withdrawal_amount: 2567
    })
    expect(messageMocks.success).toHaveBeenCalledWith('提现设置已保存')
  })

  it('保存失败时保留管理员输入的元金额', async () => {
    apiMocks.saveWithdrawalSettings.mockRejectedValue(new Error('保存失败'))
    const wrapper = mountSettings()
    await settle()

    const input = wrapper.get('.minimum-withdrawal-input')
    await input.setValue('88.88')
    await wrapper.get('.save-withdrawal-settings').trigger('click')
    await settle()

    expect(input.element.value).toBe('88.88')
    expect(messageMocks.error).toHaveBeenCalledWith('提现设置保存失败')
  })
})
