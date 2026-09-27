import { defineComponent, h, nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  getOrders: vi.fn()
}))

vi.mock('@/api', () => ({ default: { admin: apiMocks } }))

import Orders from '@/views/Orders.vue'

const ElDatePickerStub = defineComponent({
  name: 'ElDatePicker',
  props: {
    modelValue: { type: Array, default: null },
    valueFormat: { type: String, default: '' }
  },
  emits: ['update:modelValue', 'change'],
  setup() {
    return () => h('div', { class: 'date-picker-stub' })
  }
})

beforeEach(() => {
  vi.resetAllMocks()
  apiMocks.getOrders.mockResolvedValue({
    code: 0,
    data: {
      list: [],
      total: 0,
      summary: { total_amount: '0.00', ord_count: 0, ren_count: 0 }
    }
  })
})

describe('订单日期筛选', () => {
  it('按用户选择的本地日期原样请求列表和汇总', async () => {
    const wrapper = mount(Orders, {
      global: {
        stubs: {
          ElDatePicker: ElDatePickerStub,
          ElIcon: true,
          ElInput: true,
          ElButton: true,
          ElSelect: true,
          ElOption: true,
          ElTable: true,
          ElTableColumn: true,
          ElTag: true,
          ElPagination: true
        }
      }
    })
    await flushPromises()

    const picker = wrapper.findComponent(ElDatePickerStub)
    expect(picker.props('valueFormat')).toBe('YYYY-MM-DD')

    picker.vm.$emit('update:modelValue', ['2026-09-01', '2026-09-30'])
    await nextTick()
    picker.vm.$emit('change', ['2026-09-01', '2026-09-30'])
    await flushPromises()

    expect(apiMocks.getOrders).toHaveBeenLastCalledWith({
      page: 1,
      limit: 15,
      start_date: '2026-09-01',
      end_date: '2026-09-30'
    })
  })
})
