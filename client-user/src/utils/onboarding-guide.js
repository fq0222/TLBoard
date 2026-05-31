/**
 * 用户端新手引导配置工具。
 * 负责根据视口和订阅状态生成稳定的引导步骤，避免页面组件里散落选择器判断。
 */

export const MOBILE_ONBOARDING_BREAKPOINT = 768

/**
 * 判断新手引导展示模式。
 *
 * @param {number} windowWidth - 当前窗口宽度
 * @returns {'mobile'|'desktop'} 引导模式
 */
export function getOnboardingGuideMode(windowWidth) {
  return windowWidth <= MOBILE_ONBOARDING_BREAKPOINT ? 'mobile' : 'desktop'
}

/**
 * 生成新手引导步骤。
 *
 * @param {Object} options - 生成参数
 * @param {boolean} options.isMobile - 是否移动端
 * @param {boolean} options.subscriptionReady - 订阅链接是否已生成
 * @returns {Array<Object>} 引导步骤列表
 */
export function getOnboardingGuideSteps(options) {
  const { isMobile, subscriptionReady } = options
  const copyTarget = subscriptionReady
    ? (isMobile ? '.subscription-copy-target' : '.subscription-links')
    : '.subscription-workspace'
  const helpTarget = isMobile ? '.onboarding-help-bottom-nav' : '.onboarding-help-nav'

  return [
    {
      key: 'optimize',
      target: '.optimize-action',
      title: '第一步：优选 CF IP',
      description: '先点击这里测试并保存更适合当前网络的优选 IP，后续订阅节点会使用这些结果。',
      placement: isMobile ? 'top' : 'bottom',
      nextText: '下一步',
      mobilePanel: isMobile
    },
    {
      key: 'generate',
      target: '.generate-action',
      title: '第二步：生成订阅链接',
      description: '优选完成后点击这里，系统会同步节点信息并生成通用订阅和 Clash 订阅链接。',
      placement: isMobile ? 'top' : 'bottom',
      nextText: '下一步',
      mobilePanel: isMobile
    },
    {
      key: 'copy',
      target: copyTarget,
      title: '第三步：复制到客户端',
      description: subscriptionReady
        ? '链接生成后，可以在这里复制通用订阅或 Clash 订阅，再粘贴到你的客户端中使用。'
        : '生成完成后，订阅链接会出现在这里。复制对应链接后粘贴到客户端即可使用。',
      placement: isMobile ? 'top' : 'right',
      nextText: '下一步',
      mobilePanel: isMobile
    },
    {
      key: 'help',
      target: helpTarget,
      title: '第四步：查看帮助教程',
      description: '遇到客户端配置、订阅导入或连接问题时，可以点击帮助查看更多教程。',
      placement: isMobile ? 'top' : 'right',
      nextText: '完成',
      mobilePanel: isMobile
    }
  ]
}

/**
 * 判断离开首页时是否应标记新手引导完成。
 * 用户在第四步点击帮助会触发路由跳转，此时没有点击完成按钮，也应视为已完成引导。
 *
 * @param {Object} state - 当前引导状态
 * @param {boolean} state.visible - 引导是否正在展示
 * @param {number} state.current - 当前步骤索引
 * @param {Array<Object>} state.steps - 当前步骤列表
 * @returns {boolean} 是否应完成引导
 */
export function shouldCompleteOnboardingOnRouteLeave(state) {
  const currentStep = state.steps[state.current]
  return state.visible === true && currentStep?.key === 'help'
}
