# 用户端首页分享好友 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在首页订阅工作区右上角增加“分享给好友”入口，并让首页与“我的”页面共用可点击复制链接的推广海报组件。

**Architecture:** 新建一个只接收 `referralUrl` 的共享 Vue 组件，通过公开的 `open()` 方法封装二维码生成、弹窗状态、剪贴板兼容处理、Toast 和海报样式。`Profile.vue` 与 `My.vue` 继续负责调用现有推广概览接口，只向组件传入链接并触发打开。

**Tech Stack:** Vue 3 `<script setup>`、Element Plus、qrcode、Node.js 内置测试运行器、Vite。

---

## 文件结构

- 新建 `client-user/src/components/ReferralPosterDialog.vue`：共享推广海报弹窗及全部交互。
- 新建 `client-user/test/referral-poster-views.test.js`：锁定共享组件、两个入口、首页按钮位置和响应式样式。
- 修改 `client-user/src/views/user/My.vue`：删除本地海报实现，改用共享组件。
- 修改 `client-user/src/views/user/Profile.vue`：获取推广链接，并在订阅工作区标题栏接入共享组件。

### Task 1: 添加失败的结构回归测试

**Files:**
- Create: `client-user/test/referral-poster-views.test.js`

- [ ] **Step 1: 编写共享组件与页面接入测试**

创建 UTF-8 测试文件，使用 `node:test`、`node:assert/strict` 和 `readFileSync`。测试必须断言：

```js
assert.match(componentSource, /defineExpose\(\{\s*open\s*\}\)/)
assert.match(componentSource, /QRCode\.toDataURL\(props\.referralUrl/)
assert.match(componentSource, /@click="copyReferralLink"/)
assert.match(componentSource, /ElMessage\.success\('推广链接已复制'\)/)
assert.match(mySource, /<ReferralPosterDialog/)
assert.doesNotMatch(mySource, /QRCode\.toDataURL/)
assert.match(profileSource, /class="panel-head subscription-workspace-head"/)
assert.match(profileSource, />\s*分享给好友\s*</)
assert.match(profileSource, /<ReferralPosterDialog/)
assert.match(profileSource, /api\.user\.getReferralSummary\(\)/)
assert.match(profileSource, /@media \(max-width: 768px\)[\s\S]*\.share-friend-button/)
```

测试辅助函数应添加注释，说明参数为相对 `client-user` 的源码路径，返回 UTF-8 文本。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
node --test client-user/test/referral-poster-views.test.js
```

Expected: FAIL，因为共享组件和首页入口尚不存在。

### Task 2: 实现共享推广海报组件

**Files:**
- Create: `client-user/src/components/ReferralPosterDialog.vue`

- [ ] **Step 1: 实现组件模板和公开接口**

组件接收必填字符串属性 `referralUrl`，通过 `defineExpose({ open })` 向父页面开放打开方法。二维码使用可聚焦按钮承载，点击后复制链接：

```vue
<el-dialog v-model="visible" class="referral-poster-dialog" width="440px" append-to-body>
  <div class="referral-poster">
    <h2 class="poster-title">分享好友，余额奖励轻松拿</h2>
    <button
      type="button"
      class="poster-qr-wrap"
      aria-label="复制推广链接"
      @click="copyReferralLink"
    >
      <img v-if="qrCode" class="poster-qr-code" :src="qrCode" alt="推广注册链接二维码">
      <span class="poster-qr-hint">点击二维码复制链接</span>
    </button>
    <p class="poster-features">AI 畅享 · 流媒体流畅 · 4K 高清体验</p>
  </div>
</el-dialog>
```

脚本保留现有安全上下文与旧浏览器兼容复制逻辑。新增方法必须写职责、参数、返回值和异常分支注释：

```js
async function open() {
  if (!props.referralUrl) {
    ElMessage.error('推广链接暂不可用，请稍后重试')
    return
  }

  try {
    qrCode.value = await QRCode.toDataURL(props.referralUrl, {
      width: 280,
      margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' }
    })
    visible.value = true
  } catch (error) {
    console.error('推广海报二维码生成失败:', error)
    ElMessage.error('海报生成失败，请稍后重试')
  }
}
```

复制成功提示固定为“推广链接已复制”，失败提示“复制失败，请稍后重试”。样式从 `My.vue` 原海报样式迁入组件，按钮补充 `border: 0`、`font: inherit`、`cursor: pointer` 和清晰的 `:focus-visible` 状态；移动端保留弹窗安全边距及二维码自适应宽度。

- [ ] **Step 2: 运行结构测试并确认仍失败**

Run:

```bash
node --test client-user/test/referral-poster-views.test.js
```

Expected: 共享组件相关断言通过，两个页面接入断言仍失败。

### Task 3: 接入“我的”页面和首页

**Files:**
- Modify: `client-user/src/views/user/My.vue`
- Modify: `client-user/src/views/user/Profile.vue`

- [ ] **Step 1: 将“我的”页面改为共享组件**

导入 `ReferralPosterDialog`，创建 `posterDialogRef`，将海报按钮事件改为 `posterDialogRef?.open()`，并在模板末尾挂载：

```vue
<ReferralPosterDialog
  ref="posterDialogRef"
  :referral-url="referralSummary.referral_url || ''"
/>
```

删除 `QRCode` 导入、`posterVisible`、`posterQrCode`、本地 `copyToClipboard()`、本地 `showReferralPoster()`、旧弹窗模板及全部 `.referral-poster*` 样式。保留页面原有“复制”按钮和 `copyReferralLink()`，避免改变现有独立复制入口。

- [ ] **Step 2: 在首页获取推广链接**

导入共享组件，增加：

```js
const referralUrl = ref('')
const referralPosterRef = ref(null)

/**
 * 获取当前用户的好友推广链接，供首页分享海报使用。
 * 接口失败时保留空链接，由共享组件在用户点击时给出明确提示。
 * @returns {Promise<void>}
 */
async function fetchReferralUrl() {
  try {
    const response = await api.user.getReferralSummary()
    if (response.code === 0) {
      referralUrl.value = response.data?.referral_url || ''
    }
  } catch (error) {
    console.error('获取推广链接失败:', error)
  }
}
```

在现有 `onMounted()` 中调用 `fetchReferralUrl()`，不阻塞用户资料和公共设置加载。

- [ ] **Step 3: 在订阅工作区标题栏接入按钮和弹窗**

给订阅工作区标题栏添加独立类名，并把按钮作为 `.panel-head` 的第二个直接子元素：

```vue
<div class="panel-head subscription-workspace-head">
  <div>
    <h2 class="panel-title">订阅工作区</h2>
    <p class="panel-subtitle">请按顺序完成优选和订阅生成，避免节点不可用。</p>
  </div>
  <el-button class="guide-button share-friend-button" @click="referralPosterRef?.open()">
    分享给好友
  </el-button>
</div>
```

在页面根容器末尾挂载：

```vue
<ReferralPosterDialog ref="referralPosterRef" :referral-url="referralUrl" />
```

- [ ] **Step 4: 添加桌面端和移动端按钮定位样式**

桌面端通过复用 `guide-button` 获取视觉样式，仅补充标题栏内的收缩规则：

```css
.share-friend-button {
  flex: 0 0 auto;
}
```

在现有 `@media (max-width: 768px)` 内覆盖欢迎卡片新手引导按钮的绝对定位影响，保留移动端胶囊视觉：

```css
.subscription-workspace-head {
  flex-direction: row;
  align-items: flex-start;
}

.share-friend-button {
  position: static;
  flex: 0 0 auto !important;
  width: fit-content !important;
  min-width: 0 !important;
  padding: 4px 10px !important;
  border-radius: 999px;
  font-size: 12px;
}
```

- [ ] **Step 5: 运行回归测试**

Run:

```bash
node --test client-user/test/referral-poster-views.test.js
```

Expected: PASS，全部结构与交互契约断言通过。

### Task 4: 完整验证并提交

**Files:**
- Verify: `client-user/src/components/ReferralPosterDialog.vue`
- Verify: `client-user/src/views/user/My.vue`
- Verify: `client-user/src/views/user/Profile.vue`
- Verify: `client-user/test/referral-poster-views.test.js`

- [ ] **Step 1: 运行用户端全部 Node 测试**

Run:

```bash
node --test client-user/test/*.test.js
```

Expected: 全部测试通过，无 FAIL。

- [ ] **Step 2: 运行用户端生产构建**

Run:

```bash
npm run build
```

Working directory: `client-user`

Expected: Vite 构建成功，命令退出码为 0。

- [ ] **Step 3: 检查变更范围**

Run:

```bash
git diff --check
git status --short
```

Expected: 无空白错误；仅出现计划内的组件、两个页面和测试文件。

- [ ] **Step 4: 提交功能与测试**

```bash
git add client-user/src/components/ReferralPosterDialog.vue client-user/src/views/user/My.vue client-user/src/views/user/Profile.vue client-user/test/referral-poster-views.test.js
git commit -m "功能：增加首页分享好友海报入口"
```

