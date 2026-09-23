import { beforeEach, describe, expect, it, vi } from 'vitest'

const httpMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  requestUse: vi.fn(),
  responseUse: vi.fn()
}))

vi.mock('axios', () => ({
  default: {
    create: () => ({
      get: httpMocks.get,
      post: httpMocks.post,
      put: httpMocks.put,
      delete: httpMocks.delete,
      interceptors: {
        request: { use: httpMocks.requestUse },
        response: { use: httpMocks.responseUse }
      }
    })
  }
}))

vi.mock('element-plus/es/components/message/index.mjs', () => ({
  ElMessage: { error: vi.fn() }
}))

import api from '../src/api/index.js'
import router from '../src/router/index.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('管理端钱包入口契约', () => {
  it('注册余额管理路由并可加载真实页面组件', async () => {
    const route = router.getRoutes().find(item => item.path === '/admin/wallets')

    expect(route?.name).toBe('Wallets')
    expect(route?.meta.title).toBe('余额管理')
    const module = await route.components.default()
    expect(module.default.name).toBe('Wallets')
  })

  it('钱包 API 使用后端实际路径且二维码声明 blob 响应', () => {
    api.admin.getWalletUsers({ page: 2, email: 'user@example.com' })
    api.admin.getWalletUserDetail(7)
    api.admin.getWalletTransactions(7, { page: 3, type: 'withdrawal' })
    api.admin.getWithdrawalQr(12)
    api.admin.completeWithdrawal(12)
    api.admin.rejectWithdrawal(12, '资料不符')

    expect(httpMocks.get.mock.calls).toEqual([
      ['/wallets/users', { params: { page: 2, email: 'user@example.com' } }],
      ['/wallets/users/7'],
      ['/wallets/users/7/transactions', { params: { page: 3, type: 'withdrawal' } }],
      ['/wallets/withdrawals/12/qr', { responseType: 'blob' }]
    ])
    expect(httpMocks.post.mock.calls).toEqual([
      ['/wallets/withdrawals/12/complete'],
      ['/wallets/withdrawals/12/reject', { reason: '资料不符' }]
    ])
  })
})
