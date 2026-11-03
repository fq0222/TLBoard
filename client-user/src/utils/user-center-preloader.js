/**
 * 空闲时预加载用户中心首屏；options.loaders 可替换默认的布局和首页资源加载器。
 * 优先使用空闲回调，不支持时延迟 300ms；每个任务独立吞掉失败，避免阻塞登录或产生未处理异常。
 */
export function scheduleUserCenterPreload(options = {}) {
  const loaders = options.loaders || [
    () => import('@/views/user/Layout.vue'),
    () => import('@/views/user/Profile.vue')
  ]
  const preload = () => {
    loaders.forEach(loader => {
      Promise.resolve().then(loader).catch(() => {})
    })
  }

  if (typeof globalThis.requestIdleCallback === 'function') {
    globalThis.requestIdleCallback(preload)
  } else {
    globalThis.setTimeout(preload, 300)
  }
}
