/**
 * “我的”页钱包卡静态契约：保护保存并发、摘要加载失败和窄屏布局的关键模板约束。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('../src/views/user/My.vue', import.meta.url), 'utf8')

test('保存收款码期间锁定平台与上传，并只清理本次提交文件', () => {
  assert.match(source, /<el-radio-group[\s\S]*?:disabled="savingQr"[\s\S]*?>/)
  assert.match(source, /<el-upload[\s\S]*?:disabled="savingQr"[\s\S]*?>/)
  assert.match(source, /const submittedFile = qrFile\.value/)
  assert.match(source, /if \(qrFile\.value === submittedFile\) \{[\s\S]*?qrFile\.value = null[\s\S]*?revokeQrPreview\(\)[\s\S]*?\}/)
})

test('钱包摘要加载中与失败时不展示伪默认值，并提供明确重试路径', () => {
  assert.match(source, /const walletLoading = ref\(true\)/)
  assert.match(source, /const walletLoadError = ref\(''\)/)
  assert.match(source, /v-if="walletLoading"[\s\S]*?正在加载钱包信息/)
  assert.match(source, /v-else-if="walletLoadError"[\s\S]*?重新加载/)
  assert.match(source, /钱包信息加载失败，暂时无法申请提现/)
  assert.match(source, /walletLoadError\.value = ''/)
  assert.match(source, /walletLoadError\.value = '钱包信息加载失败，请重试'/)
})

test('钱包上传区在平板窄宽度提前堆叠且预览不超过容器', () => {
  assert.match(source, /\.qr-preview img \{[\s\S]*?max-width: 100%/)
  assert.match(source, /@media \(max-width: 860px\) \{[\s\S]*?\.payment-upload-row[\s\S]*?flex-direction: column/)
})
