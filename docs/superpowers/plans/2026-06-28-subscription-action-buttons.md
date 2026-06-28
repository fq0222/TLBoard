# 订阅操作按钮优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将首页和订阅页的两组订阅操作卡片改成用户确认的紧凑现代扁平按钮。

**Architecture:** 直接收敛两个现有 Vue 单文件组件中的重复模板和局部样式，不改变业务方法、状态或 API。先用静态断言验证旧结构仍存在，再删除说明和图标，最后统一按钮的响应式及交互状态。

**Tech Stack:** Vue 3、Vite、Element Plus、Scoped CSS

---

### Task 1: 清理两处按钮模板

**Files:**
- Modify: `client-user/src/views/user/Profile.vue:119-148`
- Modify: `client-user/src/views/user/Subscription.vue:4-35`

- [ ] **Step 1: 运行旧结构断言并确认失败目标**

Run:

```powershell
$files = @(
  'client-user/src/views/user/Profile.vue',
  'client-user/src/views/user/Subscription.vue'
)
$content = ($files | ForEach-Object { Get-Content -Raw -Encoding UTF8 $_ }) -join "`n"
if ($content -notmatch 'step-action-desc') { throw '预期旧说明结构仍存在' }
if ($content -notmatch 'step-action-icon') { throw '预期旧图标结构仍存在' }
```

Expected: 命令成功，证明需要删除的旧结构仍存在。

- [ ] **Step 2: 删除说明和右侧图标**

将两个按钮的内容收敛为：

```vue
<span class="step-action-index">1</span>
<span class="step-action-name">{{ cfOptimized ? '重新优选 CF IP' : '一键优选 CF IP' }}</span>
```

以及：

```vue
<span class="step-action-index">2</span>
<span class="step-action-name">{{ generatingSubscription ? '生成中...' : '生成订阅链接' }}</span>
```

`Subscription.vue` 的第一个按钮保留当前固定文案“一键优选 CF IP”。

- [ ] **Step 3: 删除不再使用的图标导入**

从两个组件的 `@element-plus/icons-vue` 导入中删除 `MagicStick`。仅当 `Link` 没有被组件其他区域使用时才删除 `Link`。

- [ ] **Step 4: 运行新结构断言**

Run:

```powershell
$files = @(
  'client-user/src/views/user/Profile.vue',
  'client-user/src/views/user/Subscription.vue'
)
$content = ($files | ForEach-Object { Get-Content -Raw -Encoding UTF8 $_ }) -join "`n"
if ($content -match 'class="step-action-desc"') { throw '说明文字仍存在' }
if ($content -match 'class="step-action-icon"') { throw '右侧图标仍存在' }
if (($content | Select-String -Pattern 'class="step-action-index"' -AllMatches).Matches.Count -ne 4) {
  throw '两页应共保留四个顺序标号'
}
```

Expected: 命令成功，无输出。

### Task 2: 实现现代扁平按钮样式

**Files:**
- Modify: `client-user/src/views/user/Profile.vue:1542-1680`
- Modify: `client-user/src/views/user/Profile.vue:2349-2369`
- Modify: `client-user/src/views/user/Subscription.vue:517-655`
- Modify: `client-user/src/views/user/Subscription.vue:900-920`

- [ ] **Step 1: 将按钮主体改为紧凑布局**

两处组件统一使用：

```css
.step-action-card {
  position: relative;
  width: 100%;
  min-height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 52px;
  border: 1px solid;
  border-radius: 14px;
  appearance: none;
  overflow: hidden;
  cursor: pointer;
  transition: background-color 0.2s ease, border-color 0.2s ease,
    box-shadow 0.2s ease, transform 0.2s ease;
}
```

- [ ] **Step 2: 实现蓝绿语义配色和底部强调线**

```css
.optimize-action {
  color: #155bd7;
  border-color: #8bbcff;
  border-bottom: 3px solid #2563eb;
  background: linear-gradient(180deg, #f3f7ff 0%, #e8f1ff 100%);
}

.generate-action {
  color: #07833f;
  border-color: #81dda4;
  border-bottom: 3px solid #16a34a;
  background: linear-gradient(180deg, #f2fff7 0%, #e7f9ee 100%);
}
```

- [ ] **Step 3: 实现序号、分隔线和居中文字**

```css
.step-action-index {
  position: absolute;
  left: 18px;
  top: 50%;
  min-width: 24px;
  padding-right: 14px;
  border-right: 1px solid currentColor;
  transform: translateY(-50%);
  font-size: 17px;
  font-weight: 800;
  line-height: 24px;
}

.step-action-name {
  color: currentColor;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.25;
  text-align: center;
}
```

- [ ] **Step 4: 实现交互和可访问状态**

```css
.step-action-card:hover:not(:disabled) {
  transform: translateY(-1px);
}

.step-action-card:active:not(:disabled) {
  transform: scale(0.985);
}

.step-action-card:focus-visible {
  outline: 3px solid rgba(37, 99, 235, 0.24);
  outline-offset: 2px;
}

.step-action-card:disabled {
  opacity: 0.56;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

@media (prefers-reduced-motion: reduce) {
  .step-action-card {
    transition: none;
  }
}
```

- [ ] **Step 5: 保持响应式排列**

PC 保留：

```css
.step-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
```

移动端保留：

```css
@media (max-width: 768px) {
  .step-actions {
    grid-template-columns: 1fr;
  }
}
```

并删除旧的移动端卡片圆角、说明字号覆盖。

### Task 3: 验证

**Files:**
- Verify: `client-user/src/views/user/Profile.vue`
- Verify: `client-user/src/views/user/Subscription.vue`

- [ ] **Step 1: 检查差异和格式**

Run:

```powershell
git diff --check
git diff -- client-user/src/views/user/Profile.vue client-user/src/views/user/Subscription.vue
```

Expected: `git diff --check` 无输出；差异只包含按钮模板、图标导入和局部样式。

- [ ] **Step 2: 执行用户端生产构建**

Run:

```powershell
npm run build
```

Working directory: `client-user/`

Expected: Vite 构建成功且无编译错误。若缺少 terser，则改用：

```powershell
npx vite build --minify esbuild
```

- [ ] **Step 3: 展示验证日志**

向用户展示静态断言、`git diff --check` 和 Vite 构建的关键日志；提醒本次仅修改前端，无需重启后端。
