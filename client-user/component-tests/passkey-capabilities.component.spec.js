/** 能力探测回归：保留真实 SimpleWebAuthn，仅替换浏览器原生能力，覆盖旧浏览器和外置认证器。 */
import * as browser from '@simplewebauthn/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PasskeyClient } from '../src/utils/passkey-client.js'

beforeEach(() => {
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('PublicKeyCredential', class PublicKeyCredential {})
  vi.stubGlobal('navigator', { credentials: { create: vi.fn(), get: vi.fn() } })
})

afterEach(() => { vi.unstubAllGlobals() })

describe('Passkey 基本 WebAuthn 能力门槛', () => {
  it('旧浏览器没有 getClientCapabilities，真实高级探测为 false 仍允许发起认证', async () => {
    expect(await browser.browserSupportsPasskeys()).toBe(false)
    expect(await new PasskeyClient().isSupported()).toBe(true)
  })

  it('只有外置安全密钥时，高级同步/平台/混合能力为 false 仍可使用 WebAuthn', async () => {
    PublicKeyCredential.getClientCapabilities = async () => ({
      conditionalCreate: false, conditionalGet: false, hybridTransport: false,
      passkeyPlatformAuthenticator: false, userVerifyingPlatformAuthenticator: false
    })
    expect(await browser.browserSupportsPasskeys()).toBe(false)
    expect(await new PasskeyClient().isSupported()).toBe(true)
  })

  it('高级探测拒绝或不可用不会否决浏览器的基本认证能力', async () => {
    PublicKeyCredential.getClientCapabilities = async () => { throw new Error('capability probe unavailable') }
    expect(await new PasskeyClient().isSupported()).toBe(true)
  })

  it.each(['insecure', 'no-public-key', 'no-credentials', 'no-get', 'no-create'])(
    '%s 缺少基本条件时禁用入口', async state => {
      if (state === 'insecure') vi.stubGlobal('isSecureContext', false)
      if (state === 'no-public-key') vi.stubGlobal('PublicKeyCredential', undefined)
      if (state === 'no-credentials') vi.stubGlobal('navigator', {})
      if (state === 'no-get') navigator.credentials.get = undefined
      if (state === 'no-create') navigator.credentials.create = undefined
      expect(await new PasskeyClient().isSupported()).toBe(false)
    }
  )
})
