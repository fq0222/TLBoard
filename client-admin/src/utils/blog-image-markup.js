/** 转义 HTML 属性值中的特殊字符，避免文件名或 URL 破坏标签结构。 */
function escapeHtmlAttribute(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** 去除文件名最后一个扩展名，保留名称中更早出现的点号。 */
export function stripLastExtension(filename) {
  const name = String(filename || '')
  const lastDot = name.lastIndexOf('.')
  return lastDot > 0 ? name.slice(0, lastDot) : name
}

/** 根据格式化开关生成要插入博客编辑器的图片标记。 */
export function buildBlogImageMarkup({ formatted, markdown, url, originalName }) {
  if (!formatted) return markdown

  const safeUrl = escapeHtmlAttribute(url)
  const safeAlt = escapeHtmlAttribute(stripLastExtension(originalName))
  return `<img src="${safeUrl}" alt="${safeAlt}" style="display:block; width:50%; height:auto; margin:0 auto;" />`
}
