# 用户端推广海报实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在用户端“我的推广”卡片中增加响应式海报按钮，并在弹窗中展示推广链接二维码海报。

**Architecture:** 只修改现有 `My.vue`，复用已安装的 `qrcode` 生成二维码 Data URL，并使用 Element Plus `el-dialog` 展示。状态、生成逻辑、模板和响应式样式均局部保留在页面内，不新增组件、接口或依赖。

**Tech Stack:** Vue 3 Composition API、Element Plus、qrcode、CSS 媒体查询、Vite

## Global Constraints

- PC 端“海报”按钮位于“复制”按钮左侧。
- 移动端“海报”和“复制”按钮同排，各占约一半宽度。
- PC 端和移动端均不显示弹窗顶部的“推广海报”标题。
- 海报卖点固定为“AI 畅享 · 流媒体流畅 · 4K 高清体验”。
- 海报仅展示，不提供下载、保存或系统分享功能。
- 移动端弹窗不得横向溢出屏幕。
- 不新增后端接口、路由、组件文件或依赖。

---

### Task 1: 推广二维码海报弹窗

**Files:**
- Modify: `client-user/src/views/user/My.vue`
- Test: `client-user/src/views/user/My.vue`（构建和浏览器响应式检查）

**Interfaces:**
- Consumes: `referralSummary.value.referral_url: string`、`QRCode.toDataURL(text, options): Promise<string>`
- Produces: `showReferralPoster(): Promise<void>`、`posterVisible: Ref<boolean>`、`posterQrCode: Ref<string>`

- [ ] **Step 1: 建立修改前验证基线**

Run:

```bash
cd client-user
npm run build
```

Expected: Vite 生产构建成功，无 Vue 模板或样式错误。

- [ ] **Step 2: 增加二维码生成状态和方法**

在 `My.vue` 的 `<script setup>` 中导入二维码依赖：

```js
import QRCode from 'qrcode'
```

在现有推广概览状态附近增加：

```js
const posterVisible = ref(false)
const posterQrCode = ref('')
```

增加带职责和错误分支说明的生成方法：

```js
/**
 * 根据当前推广链接生成海报二维码并打开弹窗。
 *
 * 推广链接为空时直接返回；生成失败时保留弹窗关闭并提示用户。
 *
 * @returns {Promise<void>}
 */
async function showReferralPoster() {
  const referralUrl = referralSummary.value.referral_url
  if (!referralUrl) {
    return
  }

  try {
    posterQrCode.value = await QRCode.toDataURL(referralUrl, {
      width: 280,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    })
    posterVisible.value = true
  } catch (error) {
    console.error('生成推广海报二维码失败:', error)
    ElMessage.error('海报生成失败，请稍后重试')
  }
}
```

- [ ] **Step 3: 增加按钮和海报弹窗模板**

将按钮放进新的操作容器，确保 DOM 顺序为“海报、复制”：

```vue
<div class="referral-actions">
  <el-button
    class="poster-button"
    size="small"
    :disabled="!referralSummary.referral_url"
    @click="showReferralPoster"
  >
    海报
  </el-button>
  <el-button
    class="copy-button"
    size="small"
    :disabled="!referralSummary.referral_url"
    @click="copyReferralLink"
  >
    复制
  </el-button>
</div>
```

在页面容器末尾增加弹窗：

```vue
<el-dialog
  v-model="posterVisible"
  class="referral-poster-dialog"
  width="440px"
  title="推广海报"
  append-to-body
>
  <div class="referral-poster">
    <div class="poster-heading">
      <span class="poster-eyebrow">邀请好友一起体验</span>
      <h3>分享好友，余额奖励轻松拿</h3>
    </div>
    <div class="poster-qr-wrap">
      <img :src="posterQrCode" alt="推广链接二维码" class="poster-qr-code">
      <span>扫码注册</span>
    </div>
    <p class="poster-features">AI 畅享 · 流媒体流畅 · 4K 高清体验</p>
  </div>
</el-dialog>
```

- [ ] **Step 4: 增加桌面和移动端样式**

复用现有蓝绿渐变按钮，增加操作容器和次级海报按钮样式。海报使用蓝绿渐变背景、白色二维码承载区和居中文字。

移动端媒体查询必须包含：

```css
:global(.referral-poster-dialog .el-dialog__title) {
  display: none;
}

.referral-actions {
  display: flex;
  flex-shrink: 0;
  gap: 10px;
}

@media (max-width: 768px) {
  .referral-actions {
    width: 100%;
  }

  .poster-button,
  .copy-button {
    flex: 1;
    width: 0;
    margin-left: 0;
  }

  :global(.referral-poster-dialog) {
    width: calc(100vw - 32px) !important;
    max-width: 440px;
    margin: 8vh auto 0;
  }

  .referral-poster {
    padding: 24px 16px;
  }

  .poster-qr-code {
    width: min(100%, 240px);
    height: auto;
  }
}
```

- [ ] **Step 5: 执行生产构建**

Run:

```bash
cd client-user
npm run build
```

Expected: Vite 输出 `built in ...`，进程退出码为 0。

- [ ] **Step 6: 浏览器检查桌面和移动端**

桌面宽度检查：

- “海报”在“复制”左侧。
- 点击后显示二维码、标题、“扫码注册”和指定卖点。
- 关闭按钮和遮罩关闭正常。

移动端宽度（375px）检查：

- “海报”和“复制”同排，各占约一半宽度。
- 弹窗顶部不显示“推广海报”标题。
- 弹窗左右各至少保留约 16px 间距。
- 二维码与文案不超出弹窗，页面无横向滚动。

- [ ] **Step 7: 整理实现提交**

经用户确认需要提交时执行：

```bash
git add client-user/src/views/user/My.vue
git commit -m "功能：新增推广二维码海报"
```
