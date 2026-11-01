/**
 * 家宽 routing 残留清理按钮交互测试。
 * 验证按钮位置、任务提交提示，以及请求失败后 loading 状态能够恢复。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { ElButton } from 'element-plus'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  getHomeProxies: vi.fn(),
  runPendingHomeRouteCleanupTask: vi.fn()
}))
const messages = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn()
}))

vi.mock('@/api', () => ({ default: { admin: apiMocks } }))
vi.mock('element-plus/es/components/message/index.mjs', () => ({ ElMessage: messages }))
vi.mock('element-plus/es/components/message-box/index.mjs', () => ({
  ElMessageBox: { confirm: vi.fn() }
}))

import HomeProxies from '@/views/HomeProxies.vue'

/** 创建可由测试控制完成时机的 Promise。 */
function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function mountHomeProxies() {
  return mount(HomeProxies, {
    global: {
      components: { ElButton },
      stubs: {
        ElIcon: true,
        ElEmpty: true,
        ElTag: true,
        ElDialog: true,
        ElForm: true,
        ElFormItem: true,
        ElInput: true,
        ElInputNumber: true
      }
    }
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  apiMocks.getHomeProxies.mockResolvedValue({
    code: 0,
    data: { home_proxies: [] }
  })
})

describe('家宽 routing 残留清理手动入口', () => {
  it('在添加按钮右侧提交清理任务并显示后端提示', async () => {
    apiMocks.runPendingHomeRouteCleanupTask.mockResolvedValue({
      code: 0,
      data: {
        queued: true,
        merged: false,
        message: '残留路由清理任务已加入队列'
      }
    })
    const wrapper = mountHomeProxies()
    await flushPromises()

    const toolbarButtons = wrapper.findAll('.toolbar button')
    expect(toolbarButtons.map(button => button.text())).toEqual([
      '添加家宽 IP',
      '清理残留路由'
    ])

    await toolbarButtons[1].trigger('click')
    await flushPromises()

    expect(apiMocks.runPendingHomeRouteCleanupTask).toHaveBeenCalledTimes(1)
    expect(messages.success).toHaveBeenCalledWith('残留路由清理任务已加入队列')
    wrapper.unmount()
  })

  it('提交期间显示 loading 且请求失败后恢复按钮', async () => {
    const request = deferred()
    apiMocks.runPendingHomeRouteCleanupTask.mockReturnValue(request.promise)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = mountHomeProxies()
    await flushPromises()

    const cleanupButton = wrapper.findAll('.toolbar button')[1]
    await cleanupButton.trigger('click')
    await flushPromises()
    expect(cleanupButton.text()).toContain('提交中')
    expect(cleanupButton.attributes('disabled')).toBeDefined()

    const requestError = Object.assign(new Error('提交失败'), {
      config: { headers: { Authorization: 'Bearer fixture-secret-token' } }
    })
    request.reject(requestError)
    await flushPromises()
    expect(cleanupButton.text()).toContain('清理残留路由')
    expect(cleanupButton.attributes('disabled')).toBeUndefined()
    expect(errorSpy).toHaveBeenCalledWith('提交家宽 routing 残留清理任务失败')
    expect(errorSpy.mock.calls.flat()).not.toContain(requestError)

    errorSpy.mockRestore()
    wrapper.unmount()
  })
})
