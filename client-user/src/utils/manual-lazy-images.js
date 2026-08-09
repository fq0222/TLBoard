/**
 * 准备文章图片手动懒加载：先移除 src，避免浏览器一次性调度所有图片请求。
 *
 * @param {ParentNode} root - 包含文章 HTML 的 DOM 根节点。
 * @returns {number} 已处理的图片数量。
 */
export function prepareManualLazyImages(root) {
  if (!root?.querySelectorAll) return 0;

  let preparedCount = 0;
  root.querySelectorAll('img').forEach((image) => {
    const src = image.getAttribute('src');
    if (!src || image.getAttribute('data-src')) return;

    image.setAttribute('data-src', src);
    image.removeAttribute('src');
    image.setAttribute('loading', 'lazy');
    image.setAttribute('decoding', 'async');
    image.setAttribute('fetchpriority', 'low');
    image.classList.add('manual-lazy-image');
    preparedCount += 1;
  });

  return preparedCount;
}

/**
 * 加载一张已准备的懒加载图片。
 *
 * @param {HTMLImageElement} image - 带 data-src 的图片节点。
 * @returns {boolean} 是否执行了 src 恢复。
 */
export function loadManualLazyImage(image) {
  const src = image?.getAttribute?.('data-src');
  if (!src) return false;

  image.setAttribute('src', src);
  image.removeAttribute('data-src');
  image.classList.add('manual-lazy-image-loaded');
  return true;
}
