import { defineComponent, h, nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  getUsers: vi.fn(),
  getBatchGenerateSubscriptionStatus: vi.fn()
}))

vi.mock('@/api', () => ({ default: { admin: apiMocks } }))

import Users from '@/views/Users.vue'

/** 状态下拉框替身，保留选项渲染与 change 事件契约。 */
const ElSelectStub = defineComponent({
  name: 'ElSelect',
  emits: ['update:modelValue', 'change'],
  setup(_, { slots }) {
    return () => h('div', { class: 'select-stub' }, slots.default?.())
  }
})

/** 下拉选项替身，用可观察文本和值验证用户可选的筛选条件。 */
const ElOptionStub = defineComponent({
  name: 'ElOption',
  props: { label: String, value: String },
  setup(props) {
    return () => h('span', { class: 'option-stub', 'data-value': props.value }, props.label)
  }
})

beforeEach(() => {
  vi.resetAllMocks()
  apiMocks.getUsers.mockResolvedValue({ code: 0, data: { list: [], total: 0 } })
  apiMocks.getBatchGenerateSubscriptionStatus.mockResolvedValue({ code: 0, data: null })
})

describe('用户状态筛选', () => {
  it('只展示正常、续费和拥有家宽，并发送对应筛选值', async () => {
    const wrapper = mount(Users, {
      global: {
        stubs: {
          ElSelect: ElSelectStub,
          ElOption: ElOptionStub,
          ElInput: true,
          ElButton: true,
          ElIcon: true,
          ElTable: true,
          ElTableColumn: true,
          ElTag: true,
          ElPagination: true,
          ElDialog: true,
          ElDivider: true,
          ElForm: true,
          ElFormItem: true,
          ElSwitch: true,
          ElInputNumber: true,
          ElDatePicker: true,
          ElCheckbox: true
        }
      }
    })
    await flushPromises()

    const options = wrapper.findAll('.option-stub').map(option => ({
      label: option.text(),
      value: option.attributes('data-value')
    }))
    expect(options).toEqual([
      { label: '正常', value: 'active' },
      { label: '续费', value: 'renew' },
      { label: '拥有家宽', value: 'has_home_plan' }
    ])

    const select = wrapper.findComponent(ElSelectStub)
    select.vm.$emit('update:modelValue', 'has_home_plan')
    await nextTick()
    select.vm.$emit('change', 'has_home_plan')
    await flushPromises()

    expect(apiMocks.getUsers).toHaveBeenLastCalledWith({
      page: 1,
      limit: 15,
      status: 'has_home_plan'
    })
  })
})
