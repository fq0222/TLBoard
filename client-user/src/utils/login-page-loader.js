/**
 * 按需下载完整登录表单，保留独立代码分割边界。
 * 无参数；返回模块 Promise，失败交由登录壳展示错误并允许重新调用重试。
 */
export function loadLoginPage() {
  return import('@/views/Login.vue')
}
