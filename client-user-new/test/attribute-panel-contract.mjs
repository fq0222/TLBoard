import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parse as parseSfc } from '@vue/compiler-sfc'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 读取 Vue 单文件组件并返回模板内容，用于验证首页核心语义没有回退到模板示例。
 *
 * @param {string} relativePath - 相对 client-user-new 根目录的组件路径
 * @returns {string} 组件模板源码
 */
function readVueSource(relativePath) {
  const source = readFileSync(resolve(rootDir, relativePath), 'utf8')
  const { descriptor, errors } = parseSfc(source)
  assert.deepEqual(errors, [], `${relativePath} 应能被 Vue SFC 解析`)
  assert.ok(descriptor.template?.content, `${relativePath} 应包含模板`)
  return source
}

const publicPlansSource = readVueSource('src/views/PublicPlans.vue')
const plansSubscriptionSource = readVueSource('src/views/PlansSubscription.vue')
const dashboardSource = readVueSource('src/views/Ecommerce.vue')
const routerSource = readFileSync(resolve(rootDir, 'src/router/index.ts'), 'utf8')
const viteConfigSource = readFileSync(resolve(rootDir, 'vite.config.ts'), 'utf8')
const sidebarSource = readFileSync(resolve(rootDir, 'src/components/layout/AppSidebar.vue'), 'utf8')
const userMenuSource = readVueSource('src/components/layout/header/UserMenu.vue')
const headerSource = readVueSource('src/components/layout/AppHeader.vue')
const signinSource = readVueSource('src/views/Auth/Signin.vue')
const forgotPasswordSource = readVueSource('src/views/Auth/ForgotPassword.vue')
const resetPasswordSource = readVueSource('src/views/Auth/ResetPassword.vue')
const paymentCallbackSource = readVueSource('src/views/PaymentCallback.vue')
const apiSource = readFileSync(resolve(rootDir, 'src/api/index.ts'), 'utf8')
const userStoreSource = readFileSync(resolve(rootDir, 'src/stores/user.ts'), 'utf8')
const residentialIpSectionSource = plansSubscriptionSource.slice(
  plansSubscriptionSource.indexOf('家宽静态 IP 套餐')
)
const packageSectionStart = dashboardSource.indexOf('<section class="space-y-4">')
const overviewSectionSource = dashboardSource.slice(
  dashboardSource.indexOf('xl:grid-cols-4'),
  packageSectionStart
)
const packageSectionSource = dashboardSource.slice(
  packageSectionStart,
  dashboardSource.indexOf('v-if="selectedAnnouncement"')
)

assert.match(sidebarSource, /name:\s*["']属性面板["']/, '登录后侧边栏应保留属性面板入口')
assert.match(sidebarSource, /path:\s*["']\/profile["']/, '属性面板菜单应指向 /profile')
assert.match(sidebarSource, /name:\s*["']套餐订阅["']/, '侧边栏一级菜单应包含套餐订阅')
assert.match(sidebarSource, /path:\s*["']\/plans["']/, '套餐订阅菜单应指向 /plans')
assert.doesNotMatch(sidebarSource, /name:\s*["']登录["']/, '登录后侧边栏不应显示登录入口')
assert.doesNotMatch(sidebarSource, /path:\s*["']\/signup["']/, '侧边栏不应暴露自由注册入口')
assert.doesNotMatch(sidebarSource, /name:\s*["']Dashboard["']/, '侧边栏不应保留 Dashboard 文案')
assert.doesNotMatch(sidebarSource, /name:\s*["']Ecommerce["']/, '侧边栏不应保留 Ecommerce 下拉项')
assert.doesNotMatch(sidebarSource, /SidebarWidget/, '侧边栏不应继续渲染 Tailwind 模板购买卡片')
assert.doesNotMatch(sidebarSource, /Purchase Plan|Tailwind CSS Dashboard|Leading Tailwind CSS Admin/, '侧边栏不应保留模板购买卡片文案')
assert.doesNotMatch(userMenuSource, /owner\.jpg|\/images\/user\//, '顶部用户菜单不应继续展示模板头像图片')

assert.match(
  routerSource,
  /path:\s*["']\/["'][\s\S]*name:\s*["']PublicPlans["']/,
  '根路由应直接进入匿名套餐展示页'
)
assert.match(routerSource, /path:\s*["']\/plans["']/, '路由应注册套餐订阅页面')
assert.match(routerSource, /title:\s*["']套餐订阅["']/, '套餐订阅路由标题应为套餐订阅')
assert.match(routerSource, /path:\s*["']\/profile["'][\s\S]*Ecommerce\.vue/, '个人中心应进入新版属性面板页面')
assert.match(routerSource, /path:\s*["']\/plans["'][\s\S]*requiresAuth:\s*true/, '完整套餐订阅页应要求登录后访问')
assert.doesNotMatch(routerSource, /path:\s*["']\/signup["']/, '路由不应注册自由注册页面')
assert.doesNotMatch(routerSource, /import\(['"][^'"]*Signup\.vue['"]\)/, '路由不应再加载 Signup 组件')
assert.match(routerSource, /path:\s*["']\/forgot-password["']/, '路由应恢复忘记密码页面')
assert.match(routerSource, /path:\s*["']\/reset-password["']/, '路由应恢复重置密码页面')

assert.match(publicPlansSource, /套餐订阅/, '匿名首页应展示套餐订阅标题')
assert.match(publicPlansSource, /登录/, '匿名首页右上角应展示登录入口')
assert.match(publicPlansSource, /selectPlan\(plan\)/, '匿名首页套餐按钮应进入选套餐处理流程')
assert.match(publicPlansSource, /name:\s*['"]Signin['"]/, '匿名首页未登录购买套餐应跳转到登录页的注册购买模式')
assert.match(publicPlansSource, /plan_id/, '匿名首页跳转注册购买模式时应携带套餐 ID')
assert.doesNotMatch(publicPlansSource, /家宽静态 IP 套餐/, '匿名首页不应展示静态 IP 套餐')
assert.doesNotMatch(publicPlansSource, /residentialIpPlans/, '匿名首页不应保留静态 IP 套餐假数据')

assert.match(plansSubscriptionSource, /套餐订阅/, '套餐订阅页面应展示页面标题')
assert.match(plansSubscriptionSource, /getRenewPlans/, '登录后的套餐订阅页应从 /renew/plans 获取续费套餐')
assert.doesNotMatch(plansSubscriptionSource, /api\.user\.getPlans\(\)/, '登录后的套餐订阅页不应再读取公开套餐列表')
assert.match(plansSubscriptionSource, /fetchUserProfile/, '套餐订阅页应先读取用户资料以识别当前套餐')
assert.match(plansSubscriptionSource, /api\.user\.renew/, '套餐订阅页应对接旧版续费接口')
assert.match(plansSubscriptionSource, /confirmReset:\s*true/, '套餐订阅页应支持限时套餐重置二次确认后重试续费')
assert.match(plansSubscriptionSource, /confirm_reset:\s*confirmReset/, '套餐订阅页应把二次确认状态提交给后端 confirm_reset 字段')
assert.match(plansSubscriptionSource, /pay_type/, '套餐订阅页续费应提交支付方式')
assert.match(plansSubscriptionSource, /余额支付/, '套餐订阅页续费应保留余额支付方式')
assert.match(plansSubscriptionSource, /支付宝/, '套餐订阅页续费应保留支付宝支付方式')
assert.match(plansSubscriptionSource, /微信支付/, '套餐订阅页续费应保留微信支付方式')
assert.match(plansSubscriptionSource, /PaymentCallback/, 'VMQ 续费下单后应跳转现有支付回调页')
assert.match(plansSubscriptionSource, /限时/, '普通套餐区域应支持限时筛选')
assert.match(plansSubscriptionSource, /不限时/, '普通套餐区域应支持不限时筛选')
assert.match(plansSubscriptionSource, /selectPlan\(plan\)/, '套餐订阅按钮应进入选套餐处理流程')
assert.doesNotMatch(plansSubscriptionSource, />\s*Subscription\s*</, '套餐订阅标题上方不应展示英文小标签')
assert.doesNotMatch(plansSubscriptionSource, />\s*推荐\s*</, '套餐卡片不应展示推荐徽标')
assert.match(plansSubscriptionSource, /xl:grid-cols-4/, '套餐卡片桌面端应一排展示 4 个')
assert.match(plansSubscriptionSource, /家宽静态 IP 套餐/, '页面下半部分应展示家宽静态 IP 套餐')
assert.match(plansSubscriptionSource, /待后端接口接入/, '静态 IP 套餐应展示待后端接口接入空状态')
assert.doesNotMatch(plansSubscriptionSource, /美国洛杉矶/, '静态 IP 套餐不应展示前端硬编码地区')
assert.doesNotMatch(plansSubscriptionSource, /15\/月/, '静态 IP 套餐不应展示前端硬编码价格')
assert.doesNotMatch(plansSubscriptionSource, /5人共享/, '静态 IP 套餐不应展示前端硬编码共享人数')
assert.doesNotMatch(residentialIpSectionSource, /v-for="ipPlan/, '静态 IP 套餐不应遍历前端假数据')
assert.doesNotMatch(residentialIpSectionSource, /min-h-\[220px\]/, '家宽静态 IP 卡片不应通过固定最小高度扩大卡片')
assert.doesNotMatch(residentialIpSectionSource, /mt-auto/, '家宽静态 IP 卡片按钮不应通过自动上边距压到底部')
assert.match(viteConfigSource, /proxy:/, '开发服务器应代理后端 API，确保套餐页面可拉取数据')
assert.match(viteConfigSource, /\/api/, '开发服务器应代理 /api 路径')
assert.match(viteConfigSource, /localhost:30000/, '用户端 API 代理应指向后端用户端口 30000')

assert.doesNotMatch(headerSource, /<SearchBar\s*\/>/, '顶部导航不应渲染搜索框')
assert.doesNotMatch(headerSource, /import SearchBar/, '移除搜索框后不应继续导入 SearchBar 组件')

assert.match(signinSource, /isRegisterMode/, '登录页应根据套餐参数切换注册购买模式')
assert.match(signinSource, /registerAndPay/, '注册购买模式应调用注册并支付流程')
assert.match(signinSource, /pay_type/, '注册购买模式应提供支付方式字段')
assert.doesNotMatch(signinSource, /to=["']\/signup["']/, '登录页不应链接到自由注册页')
assert.match(signinSource, /to=["']\/forgot-password["']/, '登录页应恢复忘记密码入口')
assert.match(signinSource, /text-error-500/, '忘记密码链接应使用独立警示色')
assert.match(signinSource, /text-brand-600/, '返回首页选择套餐应使用品牌色')
assert.match(signinSource, /text-blue-light-600/, '联系我们链接应使用区别于其它入口的颜色')
assert.doesNotMatch(signinSource, /登录流程保留/, '图 1 蓝框中的登录流程保留徽标应删除')
assert.match(signinSource, /lg:items-stretch/, '登录页双卡片桌面端应等高对齐')
assert.doesNotMatch(signinSource, /min-h-\[calc\(100vh-4rem\)\]/, '登录页卡片行不应被撑到全屏高度')
assert.match(signinSource, /showConfirmPassword/, '注册购买模式确认密码输入框应提供可见性切换状态')
assert.match(
  signinSource,
  /id=["']confirm-password["'][\s\S]*:type=["']showConfirmPassword \? 'text' : 'password'["']/,
  '确认密码输入框应根据 showConfirmPassword 切换明文和密文'
)
assert.match(
  signinSource,
  /@click=["']showConfirmPassword = !showConfirmPassword["']/,
  '确认密码输入框右侧应提供小眼睛切换按钮'
)
assert.match(
  signinSource,
  /<div class="[^"]*min-h-screen[^"]*items-center[^"]*justify-center[^"]*"/,
  '登录页页面容器应把自然高度卡片组垂直居中'
)
assert.match(dashboardSource, /fetchUserProfile/, '属性面板应从用户状态层读取后端个人信息')
assert.match(dashboardSource, /getAnnouncements/, '属性面板应从 API 层读取后端公告')
assert.match(packageSectionSource, /<h2[^>]*>\s*我的套餐\s*<\/h2>/, '我的套餐标题应单独成一行')
assert.match(packageSectionSource, /grid-cols-1[\s\S]*xl:grid-cols-4/, '我的套餐具体卡片应复用顶部四列布局宽度')
assert.doesNotMatch(dashboardSource, /h-\[224px\]/, '卡片不应通过新写死的 224px 高度来强行同高')
assert.match(packageSectionSource, /mt-5 space-y-3/, '我的套餐卡片应复用顶部概览卡片的内容间距来保持自然高度一致')
assert.match(packageSectionSource, /to=["']\/plans["'][\s\S]*续订/, '我的套餐卡片右上角应提供跳转套餐订阅页的续订按钮')
assert.match(dashboardSource, /平台公告/, '属性面板公告卡片标题应改为平台公告')
assert.match(overviewSectionSource, /平台公告/, '平台公告应移动到顶部第四张概览卡位置')
assert.doesNotMatch(packageSectionSource, /平台公告/, '下方套餐区域右侧不应继续展示平台公告卡片')
assert.doesNotMatch(dashboardSource, /\{\{\s*announcements\.length\s*\}\}\s*条/, '平台公告卡片不应展示公告数量统计')
assert.match(dashboardSource, /visibleAnnouncements/, '平台公告列表应使用处理后的最多 3 条公告')
assert.match(dashboardSource, /slice\(0,\s*3\)/, '平台公告列表最多展示 3 条')
assert.match(
  dashboardSource,
  /Number\(next\.pinned\)\s*-\s*Number\(current\.pinned\)/,
  '平台公告列表应将置顶公告排序到前面'
)
assert.match(dashboardSource, /openAnnouncement\(announcement\)/, '平台公告列表项应支持点击打开详情弹窗')
assert.match(dashboardSource, /getAnnouncementDate\(announcement\)/, '公告列表右侧日期应读取兼容后的公告时间字段')
assert.match(dashboardSource, /createdAt/, '公告日期应兼容后端可能返回的 createdAt 字段')
assert.match(dashboardSource, /timestamp \* 1000/, '公告日期应按照旧版方式处理后端秒级时间戳')
assert.match(dashboardSource, /selectedAnnouncement/, '公告详情弹窗应记录当前选中的公告')
assert.match(dashboardSource, /公告详情/, '点击公告后应弹窗展示公告详情')
assert.match(dashboardSource, /stripMarkdown\(selectedAnnouncement\.content\)/, '公告详情弹窗应展示公告完整内容')
assert.doesNotMatch(dashboardSource, /fuqiang_2015@163\.com/, '属性面板不应继续使用静态测试账号')
assert.doesNotMatch(dashboardSource, /筑基月卡/, '属性面板不应继续使用静态套餐数据')
assert.match(apiSource, /baseUrl:\s*['"]\/api\/user['"]/, '用户 API 层应统一使用 /api/user 基础路径')
assert.match(apiSource, /registerAndPay/, '用户 API 层应封装注册并支付接口')
assert.match(apiSource, /getRenewPlans/, '用户 API 层应封装当前账号可续费套餐接口')
assert.match(apiSource, /renew\(/, '用户 API 层应封装续费下单接口')
assert.match(apiSource, /status:/, '用户 API 层业务错误应保留 HTTP 状态，供续费 4091 分支判断')
assert.match(apiSource, /getPublicOrderStatus/, '用户 API 层应封装公共订单状态接口')
assert.match(apiSource, /getAnnouncements/, '用户 API 层应封装公告接口')
assert.match(apiSource, /requestPasswordReset/, '用户 API 层应封装忘记密码接口')
assert.match(apiSource, /resetPassword/, '用户 API 层应封装重置密码接口')
assert.match(userStoreSource, /useUserStore/, '用户状态层应导出 useUserStore')
assert.match(userStoreSource, /localStorage\.setItem\(['"]user_token['"]/, '用户状态层应持久化登录 token')
assert.match(forgotPasswordSource, /requestPasswordReset/, '忘记密码页面应调用后端找回密码接口')
assert.match(resetPasswordSource, /resetPassword/, '重置密码页面应调用后端重置密码接口')
assert.match(paymentCallbackSource, /userStore\.isLoggedIn\.value/, '支付回调页应识别登录态续费场景')
assert.match(paymentCallbackSource, /续费已完成/, '登录态续费支付成功后应展示续费完成文案')
assert.match(paymentCallbackSource, /import QRCode from ['"]qrcode['"]/, '支付回调页应按旧版方式引入 qrcode 本地生成二维码')
assert.match(paymentCallbackSource, /qrCodeDataUrl/, '支付回调页应保存生成后的支付二维码 Data URL')
assert.match(paymentCallbackSource, /QRCode\.toDataURL\(paymentUrl\.value/, '支付回调页应根据后端 payment_url 生成二维码')
assert.match(paymentCallbackSource, /alt=["']支付二维码["']/, '支付回调页应渲染支付二维码图片')
assert.match(paymentCallbackSource, /watch\(paymentUrl/, '支付链接变化时应重新生成二维码')
assert.doesNotMatch(paymentCallbackSource, /打开\{\{\s*payTypeName\s*\}\}支付链接/, '支付回调页不应展示打开支付链接按钮')
assert.doesNotMatch(paymentCallbackSource, /return loading\.value \? '正在确认支付状态'/, '后台轮询支付状态时标题不应随 loading 改变')
assert.doesNotMatch(paymentCallbackSource, /loading \? '检查中\.\.\.' : '重新检查支付状态'/, '后台轮询支付状态时检查按钮文案不应跳变')
assert.match(paymentCallbackSource, /min-h-12 w-full flex-none/, '支付回调页移动端底部按钮应保持足够触控高度且不被 flex 压缩')
assert.match(paymentCallbackSource, /sm:h-11 sm:flex-1/, '支付回调页桌面端底部按钮仍应横向均分宽度')

console.log('新版用户端注册购买入口契约验证通过')
