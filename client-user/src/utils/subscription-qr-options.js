/**
 * 订阅二维码生成配置。
 * 核心分支语义：通用和 Clash 使用不同主色，浅色保持白底以保证扫码识别率。
 */
export const SUBSCRIPTION_QR_OPTIONS = {
  general: {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 260,
    color: {
      dark: '#38bdf8',
      light: '#ffffff'
    }
  },
  clash: {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 260,
    color: {
      dark: '#8b5cf6',
      light: '#ffffff'
    }
  }
}
