import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = name => fs.readFileSync(path.resolve(root, `src/views/${name}.vue`), 'utf8')

test('邮件、资源与设置页面局部滚动并使用移动安全弹窗', () => {
  for (const name of ['Email', 'EmailCampaigns', 'EmailSender', 'EmailTemplates', 'Resources', 'Settings']) {
    const page = read(name)
    assert.match(page, /tw-min-w-0/)
    assert.match(page, /@media \(max-width: 767px\)/)
    assert.match(page, /width:\s*calc\(100vw - 24px\)/)
  }

  for (const name of ['Email', 'EmailCampaigns', 'EmailTemplates', 'Resources', 'Settings']) {
    assert.match(read(name), /tw-overflow-x-auto/)
  }
})
