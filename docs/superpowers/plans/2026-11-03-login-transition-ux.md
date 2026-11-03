# 登录跳转体验优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让认证成功后的等待过程具备持续、准确的视觉反馈，并提前加载首次用户中心页面资源。

**Architecture:** 登录页继续负责认证交互，将成功提示移动到路由完成之后，并沿用按钮既有 loading 状态覆盖认证与导航阶段。新增无业务状态的预加载工具，在空闲回调或短延迟后触发两个动态 import，任何加载失败都静默降级。

**Tech Stack:** Vue 3、Vue Router 4、Element Plus、Vitest、Vite

**Spec:** `docs/superpowers/specs/2026-11-03-login-transition-ux-design.md`

## Global Constraints

- 使用简体中文界面文案与注释。
- 不创建或切换分支，不创建 Git worktree。
- 新增方法必须补充职责、关键参数和核心分支语义注释。
- 预加载失败不得阻塞或改变登录流程。
- 前端修改完成后必须运行组件测试和生产构建，并展示日志。

## Review Focus

- 密码认证成功但路由尚未完成：保持 loading 和原按钮文案，不提前显示成功 Toast。
- Passkey 认证成功但路由尚未完成：保持入口锁定，不提前显示成功 Toast。
- 路由导航失败：不显示成功 Toast，恢复按钮状态。
- 浏览器不支持 `requestIdleCallback`：使用短延迟调度预加载。
- 任一动态 import 失败：拒绝被吸收，不影响另一项加载及登录页运行。

---

### Task 1: 登录导航状态与用户中心预加载

**Files:**
- Create: `client-user/src/utils/user-center-preloader.js`
- Modify: `client-user/src/views/Login.vue`
- Modify: `client-user/component-tests/passkey-login.component.spec.js`

**Interfaces:**
- Consumes: Vue Router 的 `router.replace(location)` Promise；现有 `getSafeRedirect()`。
- Produces: `scheduleUserCenterPreload(options?)`，调度 `Layout.vue` 与 `Profile.vue` 动态加载并静默处理失败。

- [x] **Step 1: 写失败的组件与工具测试**

覆盖密码与 Passkey 登录在延迟路由期间的文案、锁定和 Toast 顺序；覆盖导航拒绝；覆盖空闲调度、定时器回退与单个加载失败。

- [x] **Step 2: 运行目标测试确认 RED**

Run: `npm run test:component -- passkey-login.component.spec.js`

Expected: FAIL，原因是导航期间按钮提前恢复/Toast 提前出现，且预加载接口不存在。

- [x] **Step 3: 实现最小改动**

密码和 Passkey 登录均保持既有按钮文案与 loading 状态，`await router.replace(...)` 后再提示成功；在 `onMounted` 调用 `scheduleUserCenterPreload()`。工具优先使用 `requestIdleCallback`，缺失时使用 300ms 定时器，并隔离各加载任务的失败。

- [x] **Step 4: 运行组件测试确认 GREEN**

Run: `npm run test:component`

Expected: 所有组件测试通过且无未处理 Promise rejection。

- [x] **Step 5: 运行生产构建**

Run: `npm run build`

Expected: Vite 构建成功，无编译错误。

- [x] **Step 6: 检查差异，不提交或暂存**

Run: `git diff --check && git status --short`

Expected: 无空白错误；只出现本任务文件，保持未暂存以便用户测试和确认。
