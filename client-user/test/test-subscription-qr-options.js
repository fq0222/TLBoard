import assert from 'node:assert'

/**
 * 验证订阅二维码颜色配置保持稳定。
 * 核心分支语义：通用与 Clash 使用不同主色，避免两个二维码在视觉上难以区分。
 *
 * @returns {Promise<void>}
 */
async function run() {
  const { SUBSCRIPTION_QR_OPTIONS } = await import('../src/utils/subscription-qr-options.js')

  assert.strictEqual(SUBSCRIPTION_QR_OPTIONS.general.color.dark, '#38bdf8')
  assert.strictEqual(SUBSCRIPTION_QR_OPTIONS.clash.color.dark, '#8b5cf6')
  assert.strictEqual(SUBSCRIPTION_QR_OPTIONS.general.color.light, '#ffffff')
  assert.strictEqual(SUBSCRIPTION_QR_OPTIONS.clash.color.light, '#ffffff')
  assert.strictEqual(SUBSCRIPTION_QR_OPTIONS.general.errorCorrectionLevel, 'M')
  assert.strictEqual(SUBSCRIPTION_QR_OPTIONS.clash.errorCorrectionLevel, 'M')
  assert.notStrictEqual(
    SUBSCRIPTION_QR_OPTIONS.general.color.dark,
    SUBSCRIPTION_QR_OPTIONS.clash.color.dark
  )
}

run()
  .then(() => console.log('订阅二维码配置测试通过'))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
