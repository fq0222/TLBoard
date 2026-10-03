/**
 * 将文本写入系统剪贴板。
 * 优先使用安全上下文 Clipboard API；不可用时退回隐藏 textarea 复制。
 *
 * @param {string} text - 需要复制的完整代码文本。
 * @returns {Promise<void>} 复制成功时完成，所有复制方式失败时抛出异常。
 */
export async function copyTextToClipboard(text) {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.className = 'markdown-copy-fallback'
  textarea.value = text
  textarea.setAttribute('readonly', 'readonly')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)

  try {
    textarea.select()
    textarea.setSelectionRange(0, textarea.value.length)
    if (!document.execCommand?.('copy')) {
      throw new Error('浏览器拒绝执行复制命令')
    }
  } finally {
    textarea.remove()
  }
}

/**
 * 为 Markdown 渲染区域中的代码块提供复制按钮和状态反馈。
 * 控制器通过根节点事件委托工作，可在文章重新渲染后调用 refresh() 再次增强。
 */
export class MarkdownCodeCopyController {
  /**
   * @param {HTMLElement} root - Markdown 渲染区域根节点。
   * @param {object} [options] - 复制实现、失败回调和状态恢复时间。
   */
  constructor(root, options = {}) {
    this.root = root
    this.copyText = options.copyText || copyTextToClipboard
    this.onError = options.onError || (() => {})
    this.resetDelay = options.resetDelay || 1500
    this.resetTimers = new Map()
    this.codeByButton = new WeakMap()
    this.handleClick = this.handleClick.bind(this)
  }

  /** 挂载事件委托并增强当前代码块。 */
  mount() {
    this.root.addEventListener('click', this.handleClick)
    this.refresh()
  }

  /** 为尚未处理的 pre > code 增加容器与复制按钮。 */
  refresh() {
    this.root.querySelectorAll('details').forEach((details) => {
      if (details.parentElement?.classList.contains('markdown-details-code-block')) return

      const code = details.querySelector('pre > code')
      if (!code) return

      const wrapper = document.createElement('div')
      wrapper.className = 'markdown-details-code-block'

      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'markdown-code-copy-button'
      button.setAttribute('aria-label', '复制代码')
      button.textContent = '复制'

      details.parentNode.insertBefore(wrapper, details)
      wrapper.append(details, button)
      this.codeByButton.set(button, code)
    })

    this.root.querySelectorAll('pre > code').forEach((code) => {
      if (code.closest('details')) return

      const pre = code.parentElement
      if (!pre || pre.parentElement?.classList.contains('markdown-code-block')) return

      const wrapper = document.createElement('div')
      wrapper.className = 'markdown-code-block'

      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'markdown-code-copy-button'
      button.setAttribute('aria-label', '复制代码')
      button.textContent = '复制'

      pre.parentNode.insertBefore(wrapper, pre)
      wrapper.append(pre, button)
      this.codeByButton.set(button, code)
    })
  }

  /**
   * 处理根节点中的复制按钮点击，复制对应 code 的 textContent。
   *
   * @param {MouseEvent} event - 根节点冒泡得到的点击事件。
   */
  async handleClick(event) {
    const button = event.target.closest?.('.markdown-code-copy-button')
    if (!button || !this.root.contains(button) || button.disabled) return

    const code = this.codeByButton.get(button)
    if (!code) return

    button.disabled = true

    try {
      await this.copyText(code.textContent || '')
      this.setButtonState(button, '已复制', 'is-copied')
    } catch (error) {
      this.setButtonState(button, '复制失败', 'is-error')
      this.onError(error)
    } finally {
      button.disabled = false
    }
  }

  /**
   * 更新按钮反馈，并在指定时间后恢复为默认状态。
   *
   * @param {HTMLButtonElement} button - 当前代码块复制按钮。
   * @param {string} text - 临时反馈文字。
   * @param {string} stateClass - 临时状态类名。
   */
  setButtonState(button, text, stateClass) {
    const previousTimer = this.resetTimers.get(button)
    if (previousTimer) window.clearTimeout(previousTimer)

    button.classList.remove('is-copied', 'is-error')
    button.classList.add(stateClass)
    button.textContent = text

    const timer = window.setTimeout(() => {
      button.classList.remove('is-copied', 'is-error')
      button.textContent = '复制'
      this.resetTimers.delete(button)
    }, this.resetDelay)

    this.resetTimers.set(button, timer)
  }

  /** 移除事件监听和尚未完成的反馈计时器。 */
  destroy() {
    this.root.removeEventListener('click', this.handleClick)
    this.resetTimers.forEach((timer) => window.clearTimeout(timer))
    this.resetTimers.clear()
  }
}
