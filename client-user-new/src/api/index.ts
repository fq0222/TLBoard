export type ApiResponse<T> = {
  code?: number
  success?: boolean
  message?: string
  data: T
}

export type Plan = {
  id: number
  name: string
  description?: string
  price_text: string
  duration_days: number | string
  traffic_text: string
  plan_type?: string
  show_on_home?: number | string
  sales_limit?: number
  sales_count?: number
  is_soldout?: boolean
  is_recommended?: boolean
  recommended?: boolean
}

export type LoginPayload = {
  email: string
  password: string
}

export type RegisterAndPayPayload = LoginPayload & {
  plan_id: number
  pay_type: number
  referral_code?: string
}

export type RenewPayload = {
  plan_id: number
  pay_type: number
  confirm_reset?: boolean
}

export type PasswordResetRequestPayload = {
  email: string
}

export type ResetPasswordPayload = {
  token: string
  password: string
}

export type UserProfile = {
  id: number
  email: string
  plan_id?: number
  plan_name?: string
  traffic_used_text?: string
  traffic_limit_text?: string
  traffic_percent?: number
  balance_text?: string
  expire_text?: string
  expire_at?: string | null
  enabled?: boolean | number
  status_text?: string
  payment_count?: number
}

export type Announcement = {
  id: number
  title: string
  content: string
  pinned?: boolean | number
  created_at?: string | number
  createdAt?: string | number
}

export type LoginResult = {
  token: string
  user: UserProfile
}

export type RegisterAndPayResult = {
  out_trade_no: string
  payment_url: string
}

export type RenewResult = {
  order_id: number
  out_trade_no: string
  pay_type: number
  payment_method?: 'balance' | string
  paid?: boolean
  really_price?: string
  payment_url: string
  expire_in?: number
}

export type PublicOrderStatus = {
  status: 'pending' | 'paid' | 'expired' | string
}

type RequestOptions = {
  method?: string
  body?: unknown
  token?: string
  timeout?: number
  params?: Record<string, string | number | undefined>
}

export class ApiRequestError extends Error {
  status: number
  code?: number
  data?: unknown
  response: { status: number; data: ApiResponse<unknown> }

  /**
   * 构造保留后端响应上下文的 API 错误。
   *
   * 职责：让页面能读取 HTTP 状态、业务 code 和 data，例如续费 4091 二次确认。
   * 关键参数：status 为 HTTP 状态码，response 为后端兼容响应体。
   * 核心分支：业务层缺失 message 时使用统一兜底文案。
   */
  constructor(status: number, response: ApiResponse<unknown>) {
    super(response.message || '请求失败')
    this.name = 'ApiRequestError'
    this.status = status
    this.code = response.code
    this.data = response.data
    this.response = { status, data: response }
  }
}

const apiConfig = {
  baseUrl: '/api/user',
}

const baseUrl = apiConfig.baseUrl

/**
 * 提取可展示的错误文案。
 *
 * 职责：兼容后端 legacy 响应与网络异常，避免页面直接解析异常结构。
 * 关键参数：error 为 fetch 或业务响应抛出的异常，fallback 为页面默认提示。
 * 核心分支：优先后端 message，其次 Error.message，最后使用 fallback。
 */
export function getApiErrorMessage(error: unknown, fallback = '请求失败') {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallback
}

/**
 * 发送用户端 API 请求。
 *
 * 职责：统一拼接 `/api/user`、注入 token、处理 JSON 响应和超时。
 * 关键参数：path 为用户端接口路径，options 控制方法、请求体、token 和超时。
 * 核心分支：HTTP 或业务 code 非 0 时抛出错误，成功时返回后端原始响应体。
 */
async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
  const controller = new AbortController()
  const timeout = options.timeout ?? 10000
  const timer = window.setTimeout(() => controller.abort(), timeout)
  const query = buildQueryString(options.params)

  try {
    const response = await fetch(`${baseUrl}${path}${query}`, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    })

    const result = (await response.json()) as ApiResponse<T>

    if (!response.ok || (typeof result.code === 'number' && result.code !== 0) || result.success === false) {
      throw new ApiRequestError(response.status, result as ApiResponse<unknown>)
    }

    return result
  } finally {
    window.clearTimeout(timer)
  }
}

/**
 * 构建查询字符串。
 *
 * 职责：为 GET 接口统一处理分页等查询参数，避免页面手写字符串拼接。
 * 关键参数：params 为可选键值对象，undefined 字段会被忽略。
 * 核心分支：没有有效参数时返回空字符串，有参数时返回以 `?` 开头的查询串。
 */
function buildQueryString(params?: Record<string, string | number | undefined>) {
  if (!params) return ''

  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      query.set(key, String(value))
    }
  })

  const queryString = query.toString()
  return queryString ? `?${queryString}` : ''
}

const userApi = {
  /**
   * 获取公开套餐列表。
   *
   * 职责：供根目录套餐页读取后端上架套餐。
   * 关键参数：无。
   * 核心分支：接口成功时返回 `{ plans }`，失败由统一 request 抛出。
   */
  getPlans() {
    return request<{ plans: Plan[] }>('/plans')
  },

  /**
   * 用户登录。
   *
   * 职责：提交邮箱密码并换取用户 token。
   * 关键参数：data.email 和 data.password 来自登录表单。
   * 核心分支：未激活或密码错误由后端返回业务错误。
   */
  login(data: LoginPayload) {
    return request<LoginResult>('/login', {
      method: 'POST',
      body: data,
    })
  },

  /**
   * 申请密码重置邮件。
   *
   * 职责：提交邮箱并沿用后端模糊响应，不暴露账号是否存在。
   * 关键参数：data.email 为用户输入的邮箱。
   * 核心分支：成功和未知邮箱均由后端返回统一提示，限流或格式错误抛出业务错误。
   */
  requestPasswordReset(data: PasswordResetRequestPayload) {
    return request<{ message?: string }>('/forgot-password', {
      method: 'POST',
      body: data,
    })
  },

  /**
   * 提交新密码。
   *
   * 职责：把邮件链接中的一次性 token 和新密码提交给后端。
   * 关键参数：data.token 为 64 位重置 token，data.password 为新密码。
   * 核心分支：token 无效或过期时由后端返回业务错误。
   */
  resetPassword(data: ResetPasswordPayload) {
    return request<Record<string, never>>('/reset-password', {
      method: 'POST',
      body: data,
    })
  },

  /**
   * 注册并创建支付订单。
   *
   * 职责：只允许套餐购买流程创建账号和首单订单。
   * 关键参数：data.plan_id 为已选套餐，data.pay_type 为 VMQ 支付类型。
   * 核心分支：邮箱已激活或套餐售罄时由后端返回业务错误。
   */
  registerAndPay(data: RegisterAndPayPayload) {
    return request<RegisterAndPayResult>('/register-and-pay', {
      method: 'POST',
      body: data,
      timeout: 30000,
    })
  },

  /**
   * 获取当前用户信息。
   *
   * 职责：登录态页面读取个人资料和套餐状态。
   * 关键参数：token 为本地保存的登录令牌。
   * 核心分支：token 失效时统一抛错，由路由或页面引导重新登录。
   */
  getProfile(token: string) {
    return request<UserProfile>('/profile', {
      token,
    })
  },

  /**
   * 获取当前账号可续费套餐列表。
   *
   * 职责：沿用旧版续费入口，只返回与当前套餐类型一致的已上架套餐。
   * 关键参数：token 为当前登录用户令牌。
   * 核心分支：无当前套餐或鉴权失败时由后端返回业务错误。
   */
  getRenewPlans(token: string) {
    return request<{ plans: Plan[] }>('/renew/plans', {
      token,
    })
  },

  /**
   * 创建续费订单。
   *
   * 职责：提交续费套餐与支付方式，余额支付可直接完成，VMQ 支付返回支付链接。
   * 关键参数：token 为当前登录用户令牌，data.plan_id/pay_type 对应用户选择。
   * 核心分支：限时套餐未确认重置时后端返回 409/code=4091，页面需二次确认后重试。
   */
  renew(token: string, data: RenewPayload) {
    return request<RenewResult>('/renew', {
      method: 'POST',
      token,
      body: data,
      timeout: 30000,
    })
  },

  /**
   * 公共查询订单状态。
   *
   * 职责：支付回调页在未登录状态下轮询首单支付结果。
   * 关键参数：orderId 可为后端订单 ID 或商户订单号。
   * 核心分支：paid 表示可尝试自动登录，expired 表示需要重新下单。
   */
  getPublicOrderStatus(orderId: string) {
    return request<PublicOrderStatus>(`/orders/status/${encodeURIComponent(orderId)}`)
  },

  /**
   * 获取公开设置。
   *
   * 职责：登录页读取客服链接等匿名可见配置。
   * 关键参数：无。
   * 核心分支：未配置时后端返回空字段，页面隐藏对应入口。
   */
  getPublicSettings() {
    return request<{ online_customer_service_url?: string }>('/public-settings')
  },

  /**
   * 获取系统公告列表。
   *
   * 职责：供属性面板展示后端公告摘要。
   * 关键参数：params.limit 控制读取数量，params.page 控制页码。
   * 核心分支：公告列表接口公开可读，不依赖登录 token。
   */
  getAnnouncements(params: { page?: number; limit?: number } = {}) {
    return request<{ list: Announcement[]; total?: number }>('/announcements', {
      params,
    })
  },

  baseUrl,
}

export default {
  user: userApi,
}
