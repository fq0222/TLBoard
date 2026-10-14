/** 订单号筛选交互测试：验证输入、搜索和清空后传给 API 的实际参数。 */
import { flushPromises, mount } from '@vue/test-utils'
import { ElButton, ElInput } from 'element-plus'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({ getOrders: vi.fn() }))
vi.mock('@/api', () => ({ default: { admin: apiMocks } }))

import Orders from '@/views/Orders.vue'

beforeEach(() => {
  vi.resetAllMocks()
  apiMocks.getOrders.mockResolvedValue({
    code: 0,
    data: {
      list: [], total: 0,
      summary: { total_amount: '0.00', ord_count: 0, ren_count: 0 }
    }
  })
})

describe('订单号筛选', () => {
  it.each(['enter', 'button'])('通过 %s 搜索并与邮箱、状态和日期组合，清空后移除订单号参数', async (trigger) => {
    const wrapper = mount(Orders, {
      global: {
        components: { ElInput, ElButton },
        stubs: {
          ElIcon: true, ElSelect: true, ElOption: true, ElDatePicker: true,
          ElTable: true, ElTableColumn: true, ElTag: true, ElPagination: true
        }
      }
    })
    await flushPromises()
    const inputs = wrapper.findAll('input')
    expect(inputs.map(input => input.attributes('placeholder'))).toEqual(['搜索订单号', '搜索邮箱'])
    const orderInput = wrapper.get('input[placeholder="搜索订单号"]')
    await orderInput.setValue('REN202610')
    await wrapper.get('input[placeholder="搜索邮箱"]').setValue('user@example.com')
    wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', 'paid')
    wrapper.findComponent({ name: 'ElDatePicker' }).vm.$emit('update:modelValue', ['2026-09-01', '2026-09-30'])
    await flushPromises()

    if (trigger === 'enter') await orderInput.trigger('keyup.enter')
    else await wrapper.get('button[aria-label="搜索订单号"]').trigger('click')
    await flushPromises()
    expect(apiMocks.getOrders).toHaveBeenLastCalledWith({
      page: 1, limit: 15, order_no: 'REN202610', email: 'user@example.com',
      status: 'paid', start_date: '2026-09-01', end_date: '2026-09-30'
    })

    await orderInput.setValue('')
    await orderInput.trigger('keyup.enter')
    await flushPromises()
    expect(apiMocks.getOrders).toHaveBeenLastCalledWith({
      page: 1, limit: 15, email: 'user@example.com',
      status: 'paid', start_date: '2026-09-01', end_date: '2026-09-30'
    })
    wrapper.unmount()
  })
})
