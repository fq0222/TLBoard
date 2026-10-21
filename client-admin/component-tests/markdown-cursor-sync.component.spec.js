import { describe, expect, it, vi } from 'vitest'
import { MarkdownCursorSync } from '../src/utils/markdown-cursor-sync'

describe('Markdown 光标预览同步', () => {
  it('按顶层 Markdown 内容块记录源码范围', () => {
    const source = [
      '# 标题',
      '',
      '普通段落',
      '',
      '- 列表一',
      '- 列表二',
      '',
      '```js',
      'const answer = 42',
      '```',
      '',
      '![图片](/api/user/help/images/demo.png)',
      '',
      '<video src="/api/user/help/videos/demo.mp4"></video>'
    ].join('\n')

    const sync = new MarkdownCursorSync()
    const blocks = sync.parseBlocks(source)

    expect(blocks.map(block => block.type)).toEqual([
      'heading', 'paragraph', 'list', 'code', 'paragraph', 'html'
    ])
    expect(blocks[3].start).toBe(source.indexOf('```js'))
    expect(blocks[4].start).toBe(source.indexOf('![图片]'))
    expect(blocks[5].start).toBe(source.indexOf('<video'))
  })

  it('把目标内容块定位到预览区高度的 20% 且相同光标不重复滚动', () => {
    const sync = new MarkdownCursorSync()
    const source = '# 标题\n\n第一段\n\n第二段'
    const elements = [
      { getBoundingClientRect: () => ({ top: 120 }) },
      { getBoundingClientRect: () => ({ top: 420 }) },
      { getBoundingClientRect: () => ({ top: 820 }) }
    ]
    const container = {
      clientHeight: 500,
      scrollHeight: 1400,
      scrollTop: 80,
      getBoundingClientRect: () => ({ top: 120 }),
      querySelector: selector => {
        const match = selector.match(/"(\d+)"/)
        return match ? elements[Number(match[1])] : null
      },
      scrollTo: vi.fn(({ top }) => { container.scrollTop = top })
    }

    expect(sync.sync(source, source.indexOf('第一段'), container)).toBe(true)
    expect(container.scrollTo).toHaveBeenLastCalledWith({ top: 280, behavior: 'auto' })

    container.scrollTo.mockClear()
    expect(sync.sync(source, source.indexOf('第一段'), container)).toBe(false)
    expect(container.scrollTo).not.toHaveBeenCalled()
  })

  it('DOM 锚点不足时按全文进度比例降级', () => {
    const sync = new MarkdownCursorSync()
    const source = '# 标题\n\n第一段\n\n第二段'
    const container = {
      clientHeight: 200,
      scrollHeight: 1000,
      scrollTop: 0,
      querySelector: () => null,
      scrollTo: vi.fn()
    }

    sync.sync(source, source.length / 2, container)

    expect(container.scrollTo).toHaveBeenCalledWith({ top: 400, behavior: 'auto' })
  })

  it('为连续 HTML 根元素建立单一块锚点，后续段落仍有稳定映射', () => {
    const sync = new MarkdownCursorSync()
    const source = [
      '<img src="/first.png"><video src="/first.mp4"></video>',
      '',
      '后续段落'
    ].join('\n')

    const html = sync.renderWithAnchors(source, value => value)

    expect(html.match(/data-markdown-block-index="0"/g)).toHaveLength(1)
    expect(html.match(/data-markdown-block-index="1"/g)).toHaveLength(1)
    expect(html.indexOf('后续段落')).toBeGreaterThan(html.indexOf('data-markdown-block-index="1"'))
  })

  it('通过管理端尾部空间把末尾内容块定位到预览区 20% 位置', () => {
    const sync = new MarkdownCursorSync()
    const source = '# 标题\n\n末尾段落'
    const tailSpacer = { style: { height: '0px' } }
    const target = { getBoundingClientRect: () => ({ top: 1000 }) }
    const container = {
      clientHeight: 500,
      scrollTop: 0,
      get scrollHeight() {
        return 900 + parseFloat(tailSpacer.style.height || '0')
      },
      getBoundingClientRect: () => ({ top: 100 }),
      querySelector: selector => selector.includes('tail-spacer') ? tailSpacer : target,
      scrollTo: vi.fn(({ top }) => { container.scrollTop = top })
    }

    const html = sync.renderWithAnchors(source, value => value)
    expect(html).toContain('data-markdown-tail-spacer')

    sync.sync(source, source.indexOf('末尾段落'), container)

    expect(tailSpacer.style.height).toBe('400px')
    expect(container.scrollTo).toHaveBeenCalledWith({ top: 800, behavior: 'auto' })
  })

  it('同一大段落内的多张图片按各自源码偏移定位，全文末尾使用末端锚点', () => {
    const sync = new MarkdownCursorSync()
    const source = [
      '第一段文字',
      '![第一张](/first.png)',
      '中间一大段文字用于拉开距离',
      '![第二张](/second.png)',
      '最后一段文字'
    ].join('\n')
    const html = sync.renderWithAnchors(source, value => value)
    const secondImageStart = source.indexOf('![第二张]')

    expect(html).toContain(`data-markdown-source-start="${secondImageStart}"`)
    expect(html).toContain(`data-markdown-source-end="${secondImageStart + '![第二张](/second.png)'.length}"`)
    expect(html).toContain(`data-markdown-anchor-offset="${source.length}"`)
    expect(html).toContain('data-markdown-document-end')

    const tailSpacer = { style: { height: '0px' } }
    let container
    const blockStart = {
      dataset: { markdownAnchorOffset: '0' },
      getBoundingClientRect: () => ({ top: 100 - container.scrollTop, bottom: 100 - container.scrollTop })
    }
    const secondImage = {
      dataset: {
        markdownSourceStart: String(secondImageStart),
        markdownSourceEnd: String(secondImageStart + '![第二张](/second.png)'.length)
      },
      getBoundingClientRect: () => ({ top: 600 - container.scrollTop, bottom: 800 - container.scrollTop })
    }
    const documentEnd = {
      dataset: { markdownAnchorOffset: String(source.length) },
      getBoundingClientRect: () => ({ top: 1000 - container.scrollTop, bottom: 1000 - container.scrollTop })
    }
    container = {
      clientHeight: 500,
      scrollTop: 0,
      scrollHeight: 1800,
      getBoundingClientRect: () => ({ top: 100 }),
      querySelector: selector => selector.includes('tail-spacer') ? tailSpacer : blockStart,
      querySelectorAll: () => [blockStart, secondImage, documentEnd],
      scrollTo: vi.fn(({ top }) => { container.scrollTop = top })
    }

    sync.reset()
    sync.sync(source, secondImageStart + 5, container)
    expect(container.scrollTo).toHaveBeenLastCalledWith({ top: 400, behavior: 'auto' })

    sync.sync(source, source.length, container)
    expect(container.scrollTo).toHaveBeenLastCalledWith({ top: 800, behavior: 'auto' })
  })
})
