import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 读取用户首页源码，验证两个卡片区域共享响应式网格约束。
 * 核心语义：桌面与平板由内容容器决定列数，移动端再明确收敛为单列。
 */
function readProfileSource() {
  return readFileSync(resolve(process.cwd(), 'src/views/user/Profile.vue'), 'utf8')
}

/** 读取用户端外层布局，验证内容区允许随视口正常收缩。 */
function readLayoutSource() {
  return readFileSync(resolve(process.cwd(), 'src/views/user/Layout.vue'), 'utf8')
}

describe('Profile 响应式卡片网格', () => {
  it('宽屏保持原四列，在内容区不足时按原卡片最小宽度逐级换列', () => {
    const source = readProfileSource()
    const dashboardGridRule = source.match(/\.dashboard-card-grid\s*\{([^}]*)\}/)?.[1] || ''
    const planGridRule = source.match(/\.current-plan-list\s*\{([^}]*)\}/)?.[1] || ''

    expect(dashboardGridRule).toMatch(/grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/)
    expect(planGridRule).toMatch(/grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/)
    expect(source).toMatch(/@container\s*profile-content\s*\(max-width:\s*1599px\)[\s\S]*?repeat\(3,\s*minmax\(0,\s*1fr\)\)/)
    expect(source).toMatch(/@container\s*profile-content\s*\(max-width:\s*1203px\)[\s\S]*?repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
    expect(source).toMatch(/@container\s*profile-content\s*\(max-width:\s*791px\)[\s\S]*?grid-template-columns:\s*1fr/)
  })

  it('桌面概览卡片以原始 260px 高度为下限且移动端恢复自然高度', () => {
    const source = readProfileSource()
    const dashboardCardRules = [...source.matchAll(/\.dashboard-card\s*\{([^}]*)\}/g)]
      .map(match => match[1])

    expect(dashboardCardRules[0]).toMatch(/min-height:\s*260px/)
    expect(source).not.toMatch(/\.announcement-card\s*\{[^}]*min-height:\s*100%/)
    expect(source).toMatch(/@media\s*\(max-width:\s*768px\)[\s\S]*?\.dashboard-card\s*\{[\s\S]*?min-height:\s*0/)
  })

  it('外层主内容允许收缩而不会把页面撑出横向滚动条', () => {
    const source = readLayoutSource()
    const mainContentRule = source.match(/\.main-content\s*\{([^}]*)\}/)?.[1] || ''

    expect(mainContentRule).toMatch(/min-width:\s*0/)
  })
})
