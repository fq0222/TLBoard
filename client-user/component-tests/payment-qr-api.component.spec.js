/** 收款码 API 集成契约：经过真实 Axios 请求转换后，适配器仍收到带文件的 FormData。 */
import axios from 'axios'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('element-plus', () => ({ ElMessage: { error: vi.fn() } }))

const originalAdapter = axios.defaults.adapter
afterEach(() => {
  axios.defaults.adapter = originalAdapter
  vi.resetModules()
})

it('保存收款码不会继承 JSON 默认头并丢失 multipart 文件', async () => {
  const requests = []
  // 仅替换网络边界；保留实际 apiClient、拦截器和 Axios transformRequest。
  axios.defaults.adapter = async config => {
    requests.push(config)
    return { data: { code: 0 }, status: 200, statusText: 'OK', headers: {}, config }
  }
  const { default: api } = await import('../src/api/index.js')
  const form = new FormData()
  form.append('payment_type', 'wechat')
  form.append('qr_code', new File(['image fixture'], 'qr.png', { type: 'image/png' }))

  await api.user.savePaymentQr(form)

  expect(requests[0].url).toBe('/wallet/payment-qr')
  expect(requests[0].data).toBeInstanceOf(FormData)
  expect(requests[0].data.get('payment_type')).toBe('wechat')
  expect(requests[0].data.get('qr_code')).toBeInstanceOf(File)
  expect(requests[0].headers.get('Content-Type')).not.toContain('application/json')
})
