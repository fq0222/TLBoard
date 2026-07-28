# Subscription QR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在用户端订阅页添加查看彩色订阅二维码的按钮和弹窗。

**Architecture:** 只修改用户端订阅页和一个小型测试脚本。Vue 页面复用已有 `qrcode` 依赖，把两个订阅 URL 转成不同颜色的二维码 Data URL；移动端通过 Element Plus 弹窗样式避让底部导航。

**Tech Stack:** Vue 3、Element Plus、qrcode、Node assert 测试脚本、Vite build。

---

### Task 1: 二维码颜色配置测试

**Files:**
- Create: `client-user/test/test-subscription-qr-options.js`
- Create: `client-user/src/utils/subscription-qr-options.js`

- [ ] **Step 1: Write the failing test**

```javascript
const assert = require('assert')

async function run() {
  const { SUBSCRIPTION_QR_OPTIONS } = await import('../src/utils/subscription-qr-options.js')

  assert.strictEqual(SUBSCRIPTION_QR_OPTIONS.general.color.dark, '#38bdf8')
  assert.strictEqual(SUBSCRIPTION_QR_OPTIONS.clash.color.dark, '#8b5cf6')
  assert.strictEqual(SUBSCRIPTION_QR_OPTIONS.general.color.light, '#ffffff')
  assert.strictEqual(SUBSCRIPTION_QR_OPTIONS.clash.color.light, '#ffffff')
  assert.strictEqual(SUBSCRIPTION_QR_OPTIONS.general.errorCorrectionLevel, 'M')
  assert.strictEqual(SUBSCRIPTION_QR_OPTIONS.clash.errorCorrectionLevel, 'M')
}

run()
  .then(() => console.log('订阅二维码配置测试通过'))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node client-user/test/test-subscription-qr-options.js`

Expected: FAIL，因为 `subscription-qr-options.js` 尚未创建。

- [ ] **Step 3: Write minimal implementation**

```javascript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node client-user/test/test-subscription-qr-options.js`

Expected: PASS，输出 `订阅二维码配置测试通过`。

### Task 2: 订阅页 UI 实现

**Files:**
- Modify: `client-user/src/views/user/Subscription.vue`

- [ ] **Step 1: Import QRCode and options**

Add imports:

```javascript
import QRCode from 'qrcode'
import { SUBSCRIPTION_QR_OPTIONS } from '@/utils/subscription-qr-options'
```

- [ ] **Step 2: Add state and computed values**

Add refs for dialog visibility and QR Data URLs, plus computed website URL from the subscription URL origin.

- [ ] **Step 3: Add `showQrDialog` function**

Generate both QR images from `subscription.subscription_url` and `subscription.clash_url`; warn if links are unavailable.

- [ ] **Step 4: Add the third action button**

Add a third `.step-action-card.qr-action` button below/next to the existing two step buttons.

- [ ] **Step 5: Add the QR dialog template**

Use an `el-dialog` with官网地址、通用二维码、Clash 二维码和 labels.

- [ ] **Step 6: Add responsive styles**

Add orange button styles, QR layout styles, and mobile dialog styles that reserve bottom space for the fixed tab bar.

### Task 3: Verification

**Files:**
- No new files

- [ ] **Step 1: Run focused test**

Run: `node client-user/test/test-subscription-qr-options.js`

Expected: PASS.

- [ ] **Step 2: Run frontend build**

Run: `npm run build` from `client-user/`

Expected: PASS.
