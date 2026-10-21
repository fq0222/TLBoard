import { marked } from 'marked'

const NON_RENDERED_TOKEN_TYPES = new Set(['space', 'def'])

/**
 * Markdown 编辑光标与预览区定位器。
 * 负责解析顶层源码块、避免同块重复滚动，并在锚点缺失时退化为全文进度定位。
 */
export class MarkdownCursorSync {
  constructor({ targetRatio = 0.2 } = {}) {
    this.targetRatio = targetRatio
    this.lastCursorOffset = -1
  }

  /** 清除上一次内容块位置，供切换文章或重新打开弹窗时使用。 */
  reset() {
    this.lastCursorOffset = -1
  }

  /** 将源码解析为保留 token 与源码范围的顶层记录。 */
  tokenizeBlocks(source = '') {
    const markdown = String(source || '')
    const tokens = marked.lexer(markdown)
    const records = []
    let searchOffset = 0

    for (const token of tokens) {
      const raw = String(token.raw || '')
      const locatedAt = raw ? markdown.indexOf(raw, searchOffset) : searchOffset
      const start = locatedAt >= 0 ? locatedAt : searchOffset
      const end = Math.max(start + raw.length, start + 1)
      searchOffset = Math.max(searchOffset, start + raw.length)
      if (NON_RENDERED_TOKEN_TYPES.has(token.type)) continue

      const type = token.type === 'paragraph' && /^\s*<(?:img|video)\b/i.test(raw)
        ? 'html'
        : token.type
      records.push({ token, type, raw, start, end, links: tokens.links })
    }

    return records
  }

  /**
   * 将 Markdown 解析为带源码偏移范围的顶层可渲染内容块。
   * @param {string} source - Markdown 原文
   * @returns {Array<{type:string,start:number,end:number}>} 内容块范围
   */
  parseBlocks(source = '') {
    return this.tokenizeBlocks(source).map(({ type, start, end }) => ({ type, start, end }))
  }

  /** 提取一个源码块内所有 Markdown 图片与 HTML 图片/视频的源码范围。 */
  extractMediaRanges(raw, blockStart) {
    const ranges = []
    const patterns = [
      /!\[[^\]]*]\([^\n)]*\)/g,
      /<(?:img|video)\b[^>]*>/gi
    ]
    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(raw))) {
        ranges.push({ start: blockStart + match.index, end: blockStart + match.index + match[0].length })
      }
    }
    return ranges.sort((left, right) => left.start - right.start)
  }

  /** 按渲染顺序把媒体源码范围写入管理端预览元素。 */
  attachMediaRanges(html, ranges) {
    if (!ranges.length || typeof document === 'undefined') return html
    const template = document.createElement('template')
    template.innerHTML = html
    const media = template.content.querySelectorAll('img, video')
    ranges.forEach((range, index) => {
      const element = media[index]
      if (!element) return
      element.dataset.markdownSourceStart = String(range.start)
      element.dataset.markdownSourceEnd = String(range.end)
    })
    return template.innerHTML
  }

  /**
   * 为编辑预览生成稳定的顶层块锚点；包装仅存在于管理端预览 HTML。
   * @param {string} source - Markdown 原文
   * @param {(html:string) => string} transformHtml - 可选的 HTML 清理函数
   * @returns {string} 带内部块锚点的预览 HTML
   */
  renderWithAnchors(source = '', transformHtml = value => value) {
    const blocks = this.tokenizeBlocks(source)
    const content = blocks.map((block, index) => {
      const tokenList = [block.token]
      tokenList.links = block.links
      const sanitizedHtml = transformHtml(marked.parser(tokenList))
      const html = this.attachMediaRanges(sanitizedHtml, this.extractMediaRanges(block.raw, block.start))
      return [
        `<div class="markdown-preview-block" data-markdown-block-index="${index}">`,
        `<span class="markdown-source-anchor" data-markdown-anchor-offset="${block.start}" aria-hidden="true"></span>`,
        html,
        `<span class="markdown-source-anchor" data-markdown-anchor-offset="${block.end}" aria-hidden="true"></span>`,
        '</div>'
      ].join('')
    }).join('')

    const documentEnd = String(source || '').length
    return [
      content,
      `<span class="markdown-source-anchor" data-markdown-anchor-offset="${documentEnd}" data-markdown-document-end aria-hidden="true"></span>`,
      '<div data-markdown-tail-spacer aria-hidden="true"></div>'
    ].join('')
  }

  /** 查找光标所属内容块；位于空白分隔行时优先使用后一个相邻块。 */
  findBlockIndex(blocks, cursorOffset) {
    if (!blocks.length) return -1
    const cursor = Math.max(0, Number(cursorOffset) || 0)
    const containing = blocks.findIndex(block => cursor >= block.start && cursor < block.end)
    if (containing >= 0) return containing

    const next = blocks.findIndex(block => cursor < block.start)
    return next >= 0 ? next : blocks.length - 1
  }

  /**
   * 将光标内容块定位到预览区高度的指定比例。
   * @returns {boolean} 是否执行了滚动
   */
  sync(source, cursorOffset, container, { force = false } = {}) {
    if (!container) return false

    const markdown = String(source || '')
    const tailSpacer = container.querySelector?.('[data-markdown-tail-spacer]')
    const tailHeight = container.clientHeight * (1 - this.targetRatio)
    if (tailSpacer?.style) {
      tailSpacer.style.height = `${tailHeight}px`
    }

    const blocks = this.parseBlocks(markdown)
    const blockIndex = this.findBlockIndex(blocks, cursorOffset)
    const cursor = Math.max(0, Math.min(markdown.length, Number(cursorOffset) || 0))
    if (!force && cursor === this.lastCursorOffset) return false
    this.lastCursorOffset = cursor

    const containerRect = container.getBoundingClientRect?.()
    const fineAnchors = Array.from(container.querySelectorAll?.(
      '[data-markdown-anchor-offset], [data-markdown-source-start]'
    ) || [])
    const points = []
    let exactMediaTop = null

    fineAnchors.forEach((element) => {
      if (!element.getBoundingClientRect || !containerRect) return
      const rect = element.getBoundingClientRect()
      const contentTop = container.scrollTop + rect.top - containerRect.top
      const anchorOffset = Number(element.dataset?.markdownAnchorOffset)
      const mediaStart = Number(element.dataset?.markdownSourceStart)
      const mediaEnd = Number(element.dataset?.markdownSourceEnd)

      if (Number.isFinite(anchorOffset)) points.push({ offset: anchorOffset, top: contentTop })
      if (Number.isFinite(mediaStart) && Number.isFinite(mediaEnd)) {
        points.push({ offset: mediaStart, top: contentTop })
        points.push({
          offset: mediaEnd,
          top: container.scrollTop + rect.bottom - containerRect.top
        })
        if (cursor >= mediaStart && cursor <= mediaEnd) exactMediaTop = contentTop
      }
    })

    points.sort((left, right) => left.offset - right.offset)
    let top

    if (exactMediaTop !== null) {
      top = exactMediaTop - container.clientHeight * this.targetRatio
    } else if (points.length) {
      const previous = [...points].reverse().find(point => point.offset <= cursor) || points[0]
      const next = points.find(point => point.offset >= cursor) || points[points.length - 1]
      const distance = next.offset - previous.offset
      const progress = distance > 0 ? (cursor - previous.offset) / distance : 0
      top = previous.top + (next.top - previous.top) * progress - container.clientHeight * this.targetRatio
    } else {
      const target = blockIndex >= 0
        ? container.querySelector?.(`[data-markdown-block-index="${blockIndex}"]`)
        : null
      if (target?.getBoundingClientRect && containerRect) {
        top = container.scrollTop + target.getBoundingClientRect().top - containerRect.top
          - container.clientHeight * this.targetRatio
      } else {
        const progress = markdown.length ? cursor / markdown.length : 0
        const contentScrollHeight = container.scrollHeight - (tailSpacer ? tailHeight : 0)
        top = progress * Math.max(0, contentScrollHeight - container.clientHeight)
      }
    }

    const maxTop = Math.max(0, container.scrollHeight - container.clientHeight)
    container.scrollTo({ top: Math.max(0, Math.min(maxTop, top)), behavior: 'auto' })
    return true
  }
}
