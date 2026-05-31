/**
 * 用户端新手引导工具测试。
 * 验证移动端使用固定面板引导，避免依赖浮层自动定位。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getOnboardingGuideMode,
  getOnboardingGuideSteps,
  shouldCompleteOnboardingOnRouteLeave
} from '../src/utils/onboarding-guide.js'

test('onboarding guide uses mobile mode at mobile width', () => {
  assert.equal(getOnboardingGuideMode(768), 'mobile')
  assert.equal(getOnboardingGuideMode(769), 'desktop')
})

test('mobile onboarding steps keep stable targets for scroll and highlight', () => {
  const steps = getOnboardingGuideSteps({
    isMobile: true,
    subscriptionReady: true
  })

  assert.equal(steps.length, 4)
  assert.equal(steps[0].target, '.optimize-action')
  assert.equal(steps[1].target, '.generate-action')
  assert.equal(steps[2].target, '.subscription-copy-target')
  assert.equal(steps[3].target, '.onboarding-help-bottom-nav')
  assert.equal(steps.every(step => step.mobilePanel === true), true)
})

test('desktop onboarding keeps tour placements and sidebar help target', () => {
  const steps = getOnboardingGuideSteps({
    isMobile: false,
    subscriptionReady: false
  })

  assert.equal(steps[2].target, '.subscription-workspace')
  assert.equal(steps[3].target, '.onboarding-help-nav')
  assert.equal(steps[0].placement, 'bottom')
  assert.equal(steps[2].placement, 'right')
})

test('route leave completes onboarding when user is on help step', () => {
  const steps = getOnboardingGuideSteps({
    isMobile: true,
    subscriptionReady: true
  })

  assert.equal(shouldCompleteOnboardingOnRouteLeave({
    visible: true,
    current: 3,
    steps
  }), true)

  assert.equal(shouldCompleteOnboardingOnRouteLeave({
    visible: true,
    current: 2,
    steps
  }), false)
})
