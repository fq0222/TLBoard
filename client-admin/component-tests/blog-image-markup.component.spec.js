import { describe, expect, it } from 'vitest'
import { buildBlogImageMarkup, stripLastExtension } from '../src/utils/blog-image-markup'

describe('博客图片插入格式', () => {
  it('未启用格式化时保留接口返回的 Markdown', () => {
    expect(buildBlogImageMarkup({
      formatted: false,
      markdown: '![图片说明](https://example.com/image.jpg)',
      url: 'https://example.com/image.jpg',
      originalName: '配置页面.jpg'
    })).toBe('![图片说明](https://example.com/image.jpg)')
  })

  it('启用格式化时生成固定宽度 HTML 并去除最后一个扩展名', () => {
    expect(stripLastExtension('教程.步骤一.png')).toBe('教程.步骤一')
    expect(buildBlogImageMarkup({
      formatted: true,
      markdown: 'unused',
      url: 'https://example.com/image.png',
      originalName: '教程.步骤一.png'
    })).toBe('<img src="https://example.com/image.png" alt="教程.步骤一" style="display:block; width:50%; height:auto; margin:0 auto;" />')
  })

  it('对 URL 与原始文件名中的 HTML 属性字符进行转义', () => {
    expect(buildBlogImageMarkup({
      formatted: true,
      markdown: 'unused',
      url: 'https://example.com/a.jpg?x=1&name="demo"',
      originalName: '配置&"<图>.jpg'
    })).toBe('<img src="https://example.com/a.jpg?x=1&amp;name=&quot;demo&quot;" alt="配置&amp;&quot;&lt;图&gt;" style="display:block; width:50%; height:auto; margin:0 auto;" />')
  })
})
