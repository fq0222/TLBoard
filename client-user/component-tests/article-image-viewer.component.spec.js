import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import ArticleImageViewer from '../src/components/ArticleImageViewer.vue'

const wrappers = []

/** 挂载真实单图预览器，并统一回收它修改的页面状态。 */
function mountViewer() {
  const wrapper = mount(ArticleImageViewer, {
    props: {
      src: 'https://example.com/original.png',
      alt: '原图'
    }
  })
  wrappers.push(wrapper)
  return wrapper
}

/** 构造带触点标识和坐标的 PointerEvent，供 jsdom 验证双指手势。 */
function dispatchPointer(element, type, { pointerId, clientX, clientY = 0 }) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: 'touch' },
    clientX: { value: clientX },
    clientY: { value: clientY },
    button: { value: 0 }
  })
  element.dispatchEvent(event)
}

afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  document.body.style.overflow = ''
})

describe('ArticleImageViewer 图片缩放', () => {
  it('图片指针事件被画布捕获后不会误触发遮罩关闭', async () => {
    const wrapper = mountViewer()
    const canvas = wrapper.get('.article-image-viewer__canvas')
    const image = wrapper.get('.article-image-viewer__image')

    dispatchPointer(image.element, 'pointerdown', { pointerId: 1, clientX: 100 })
    dispatchPointer(canvas.element, 'pointerup', { pointerId: 1, clientX: 100 })
    await canvas.trigger('click')

    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('使用“复原”按钮恢复初始适配状态', () => {
    const wrapper = mountViewer()
    expect(wrapper.get('.article-image-viewer__reset').text()).toBe('复原')
  })

  it('通过按钮和鼠标滚轮按比例缩放，并可恢复初始适配状态', async () => {
    const wrapper = mountViewer()
    const image = wrapper.get('.article-image-viewer__image')

    expect(wrapper.get('.article-image-viewer__scale').text()).toBe('100%')
    expect(image.attributes('style')).toContain('scale(1)')

    await wrapper.get('.article-image-viewer__zoom-in').trigger('click')
    expect(wrapper.get('.article-image-viewer__scale').text()).toBe('120%')
    expect(image.attributes('style')).toContain('scale(1.2)')

    await wrapper.get('.article-image-viewer__canvas').trigger('wheel', { deltaY: -100 })
    expect(wrapper.get('.article-image-viewer__scale').text()).toBe('144%')

    await wrapper.get('.article-image-viewer__reset').trigger('click')
    expect(wrapper.get('.article-image-viewer__scale').text()).toBe('100%')
    expect(image.attributes('style')).toContain('scale(1)')
  })

  it('移动端双指距离变化时连续缩放当前图片', async () => {
    const wrapper = mountViewer()
    const canvas = wrapper.get('.article-image-viewer__canvas')

    dispatchPointer(canvas.element, 'pointerdown', { pointerId: 1, clientX: 0 })
    dispatchPointer(canvas.element, 'pointerdown', { pointerId: 2, clientX: 100 })
    dispatchPointer(canvas.element, 'pointermove', { pointerId: 2, clientX: 150 })
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.article-image-viewer__scale').text()).toBe('150%')
    expect(wrapper.get('.article-image-viewer__image').attributes('style')).toContain('scale(1.5)')
  })
})
