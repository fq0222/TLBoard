/** 博客编辑弹窗布局契约测试：确保弹窗高度随视口伸缩，且不再依赖固定编辑区高度。 */
import { parse as parseVue } from '@vue/compiler-sfc'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

const { default: pageSource } = await import('../src/views/Blogs.vue?raw')

/** 返回指定选择器在非媒体查询样式中的声明集合。 */
function declarationsFor(root, selector) {
  const declarations = new Map()
  root.walkRules(rule => {
    if (rule.parent.type === 'atrule' || rule.selector !== selector) return
    rule.walkDecls(declaration => declarations.set(declaration.prop, declaration.value))
  })
  return declarations
}

describe('博客编辑弹窗布局', () => {
  it('弹窗与编辑区占满可用视口，并保留独立滚动区域', () => {
    const style = parseVue(pageSource).descriptor.styles[0]
    const css = postcss.parse(style.content)
    const dialog = declarationsFor(css, ':deep(.blog-dialog)')
    const body = declarationsFor(css, ':deep(.blog-dialog .el-dialog__body)')
    const form = declarationsFor(css, '.blog-dialog-form')
    const contentItem = declarationsFor(css, '.blog-content-item')
    const content = declarationsFor(css, '.blog-content-item :deep(.el-form-item__content)')
    const shell = declarationsFor(css, '.editor-shell')
    const columns = declarationsFor(css, '.editor-columns')
    const preview = declarationsFor(css, '.preview-panel .markdown-body')

    expect(dialog.get('display')).toBe('flex')
    expect(dialog.get('flex-direction')).toBe('column')
    expect(dialog.get('height')).toBe('92dvh')
    expect(body.get('flex')).toBe('1')
    expect(body.get('min-height')).toBe('0')
    expect(body.get('overflow-y')).toBe('auto')
    expect(form.get('display')).toBe('flex')
    expect(contentItem.get('flex')).toBe('1')
    expect(content.get('align-items')).toBe('stretch')
    expect(shell.get('flex')).toBe('1')
    expect(columns.get('min-height')).toBe('0')
    expect(columns.get('flex')).toBe('1')
    expect(preview.get('max-height')).toBeUndefined()
    expect(preview.get('min-height')).toBe('0')
  })
})
