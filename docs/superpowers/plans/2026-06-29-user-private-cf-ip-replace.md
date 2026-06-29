# User Private CF IP Replace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户端“我的 / 线路优选”页面允许用户逐个手动替换当前使用的 5 个 CF IP，手动 IP 为用户私有；点击“优选极速通道”后保持当前交互，不弹窗，并用网站 IP 池结果覆盖手动 IP。

**Architecture:** 将 `user_cf_ips` 从“用户选择的公共 IP 池关联表”升级为“用户当前使用的 5 个 IP 槽位表”。每个槽位通过 `source` 区分 `pool` 和 `custom` 来源，订阅生成统一读取槽位里的实际 IP。用户手动替换只更新单个槽位；原有应用优选 IP 流程继续整体覆盖全部槽位。

**Tech Stack:** Node.js Express、PostgreSQL、Vue 3、Element Plus、项目现有 `db` 代理与迁移风格。

---

## Files

- Modify: `server/db/schema/tables.js`
  - 扩展 `user_cf_ips` 表结构，新增 `custom_ip`、`source`、`slot_index`、`updated_at`。
- Create: `server/db/migrations/002-user-cf-ip-slots.js`
  - 幂等迁移现有 `user_cf_ips` 数据到槽位模型。
- Modify: `server/repositories/cf-optimize-repository.js`
  - 当前 IP 查询支持 `pool/custom`。
  - 整体应用优选 IP 时写入 `source='pool'` 槽位。
  - 新增单槽位私有 IP 替换方法。
- Modify: `server/services/user/cf-optimize-service.js`
  - 增加 IP 格式校验和槽位替换业务。
  - 保持“应用优选 IP”整体覆盖行为。
- Modify: `server/routes/user/cf-optimize.js`
  - 新增用户单槽位替换接口。
- Modify: `server/repositories/subscription-repository.js`
  - 订阅生成读取用户当前 CF IP 时兼容私有 IP。
- Modify: `server/repositories/user-repository.js`
  - 管理端用户 CF IP 相关读取/覆盖兼容新的槽位表，管理员选择公共池 IP 时仍写入 `pool` 来源。
- Modify: `client-user/src/api/index.js`
  - 新增单槽位替换 API 方法。
- Modify: `client-user/src/views/user/CfOptimize.vue`
  - 当前 IP 卡片增加“替换”按钮与输入弹窗。
  - 优选极速通道按钮不增加确认弹窗，保持当前代码交互。
- Test: `server/test/test-user-private-cf-ips.js`
  - 新增后端脚本验证私有 IP、覆盖、订阅查询。

---

### Task 1: 数据库表结构与迁移

**Files:**
- Modify: `server/db/schema/tables.js`
- Create: `server/db/migrations/002-user-cf-ip-slots.js`

- [ ] **Step 1: 修改建表语句**

在 `server/db/schema/tables.js` 的 `user_cf_ips` 建表 SQL 中，将表调整为槽位模型：

```sql
CREATE TABLE IF NOT EXISTS user_cf_ips (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  ip_pool_id INTEGER,
  custom_ip VARCHAR(45),
  source VARCHAR(20) NOT NULL DEFAULT 'pool',
  slot_index INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
  updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
  CONSTRAINT user_cf_ips_source_check CHECK (source IN ('pool', 'custom')),
  CONSTRAINT user_cf_ips_value_check CHECK (
    (source = 'pool' AND ip_pool_id IS NOT NULL AND custom_ip IS NULL)
    OR
    (source = 'custom' AND ip_pool_id IS NULL AND custom_ip IS NOT NULL)
  ),
  CONSTRAINT user_cf_ips_slot_check CHECK (slot_index BETWEEN 1 AND 5),
  CONSTRAINT user_cf_ips_user_slot_unique UNIQUE (user_id, slot_index)
)
```

- [ ] **Step 2: 新增幂等迁移脚本**

创建 `server/db/migrations/002-user-cf-ip-slots.js`，职责注释说明“升级 user_cf_ips 为 5 槽位模型，并保留现有公共池 IP 选择”。迁移要：

```javascript
/**
 * 将 user_cf_ips 升级为用户当前 CF IP 槽位表。
 * - 旧数据只有 ip_pool_id，本迁移补齐 source、slot_index、updated_at。
 * - slot_index 按用户维度的 created_at/id 顺序生成，最多保留 5 个。
 * - 所有 ALTER/UPDATE 均幂等，支持重复执行。
 */
async function migrateUserCfIpSlots(db) {
  await db.exec(`ALTER TABLE user_cf_ips ADD COLUMN IF NOT EXISTS custom_ip VARCHAR(45)`)
  await db.exec(`ALTER TABLE user_cf_ips ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'pool'`)
  await db.exec(`ALTER TABLE user_cf_ips ADD COLUMN IF NOT EXISTS slot_index INTEGER`)
  await db.exec(`ALTER TABLE user_cf_ips ADD COLUMN IF NOT EXISTS updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())`)

  await db.exec(`
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at ASC, id ASC) AS rn
      FROM user_cf_ips
    )
    UPDATE user_cf_ips u
    SET slot_index = ranked.rn,
        source = COALESCE(u.source, 'pool'),
        updated_at = COALESCE(u.updated_at, EXTRACT(EPOCH FROM NOW()))
    FROM ranked
    WHERE u.id = ranked.id
  `)

  await db.exec(`DELETE FROM user_cf_ips WHERE slot_index > 5`)
  await db.exec(`ALTER TABLE user_cf_ips ALTER COLUMN source SET NOT NULL`)
  await db.exec(`ALTER TABLE user_cf_ips ALTER COLUMN slot_index SET NOT NULL`)
  await db.exec(`ALTER TABLE user_cf_ips ALTER COLUMN slot_index SET DEFAULT 1`)

  await db.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'user_cf_ips_source_check'
      ) THEN
        ALTER TABLE user_cf_ips
        ADD CONSTRAINT user_cf_ips_source_check CHECK (source IN ('pool', 'custom'));
      END IF;
    END $$;
  `)

  await db.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'user_cf_ips_value_check'
      ) THEN
        ALTER TABLE user_cf_ips
        ADD CONSTRAINT user_cf_ips_value_check CHECK (
          (source = 'pool' AND ip_pool_id IS NOT NULL AND custom_ip IS NULL)
          OR
          (source = 'custom' AND ip_pool_id IS NULL AND custom_ip IS NOT NULL)
        );
      END IF;
    END $$;
  `)

  await db.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'user_cf_ips_slot_check'
      ) THEN
        ALTER TABLE user_cf_ips
        ADD CONSTRAINT user_cf_ips_slot_check CHECK (slot_index BETWEEN 1 AND 5);
      END IF;
    END $$;
  `)

  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_cf_ips_user_slot
    ON user_cf_ips(user_id, slot_index)
  `)
}

module.exports = migrateUserCfIpSlots
```

- [ ] **Step 3: 接入迁移加载机制**

检查 `server/db/migrations/` 当前加载方式。如已有统一 migration runner，将 `002-user-cf-ip-slots.js` 接入；如当前项目只通过 `server/db/schema/tables.js` 初始化，则至少保证新库初始化可直接创建新结构，老库可手动运行该迁移脚本。

- [ ] **Step 4: 验证建表 SQL 语法**

Run:

```bash
node -c server/db/schema/tables.js
node -c server/db/migrations/002-user-cf-ip-slots.js
```

Expected: 无语法错误。

---

### Task 2: 后端仓库层支持 pool/custom 槽位

**Files:**
- Modify: `server/repositories/cf-optimize-repository.js`
- Modify: `server/repositories/subscription-repository.js`
- Modify: `server/repositories/user-repository.js`

- [ ] **Step 1: 当前 CF IP 查询改为 LEFT JOIN**

在 `server/repositories/cf-optimize-repository.js` 中，`listCurrentUserCfIps` 改为：

```sql
SELECT
  uci.id,
  uci.user_id,
  uci.ip_pool_id,
  uci.custom_ip,
  uci.source,
  uci.slot_index,
  COALESCE(cp.ip, uci.custom_ip) AS ip,
  cp.port,
  cp.tls,
  cp.server_name,
  cp.enabled,
  uci.created_at,
  uci.updated_at
FROM user_cf_ips uci
LEFT JOIN cf_ip_pool cp ON uci.ip_pool_id = cp.id
WHERE uci.user_id = ?
ORDER BY uci.slot_index ASC, uci.id ASC
```

公共池 IP 使用 `cp.ip`，私有 IP 使用 `custom_ip`。

- [ ] **Step 2: 整体覆盖方法写入槽位**

将 `replaceUserCfIps(db, userId, ipPoolIds)` 保持原函数名，但内部事务改为：

```javascript
await client.query('DELETE FROM user_cf_ips WHERE user_id = $1', [userId])
for (let index = 0; index < ipPoolIds.length; index++) {
  await client.query(
    `INSERT INTO user_cf_ips (user_id, ip_pool_id, custom_ip, source, slot_index, created_at, updated_at)
     VALUES ($1, $2, NULL, 'pool', $3, EXTRACT(EPOCH FROM NOW()), EXTRACT(EPOCH FROM NOW()))`,
    [userId, ipPoolIds[index], index + 1]
  )
}
```

这个函数就是“点击优选极速通道后，用网站 IP 池结果覆盖用户手动 IP”的核心。

- [ ] **Step 3: 新增单槽位私有 IP 替换方法**

在 `server/repositories/cf-optimize-repository.js` 新增并导出：

```javascript
/**
 * 将用户某个 CF IP 槽位替换为私有 IP。
 * @param {object} db 数据库代理对象
 * @param {number} userId 当前登录用户 ID
 * @param {number} slotIndex 1~5 的槽位序号
 * @param {string} ip 用户手动输入的 IPv4/IPv6 地址
 * @returns {Promise<object>} 替换后的槽位记录
 */
async function replaceUserCfIpSlotWithCustomIp(db, userId, slotIndex, ip) {
  const result = await db.prepare(`
    INSERT INTO user_cf_ips (
      user_id, ip_pool_id, custom_ip, source, slot_index, created_at, updated_at
    )
    VALUES (?, NULL, ?, 'custom', ?, EXTRACT(EPOCH FROM NOW()), EXTRACT(EPOCH FROM NOW()))
    ON CONFLICT (user_id, slot_index)
    DO UPDATE SET
      ip_pool_id = NULL,
      custom_ip = EXCLUDED.custom_ip,
      source = 'custom',
      updated_at = EXTRACT(EPOCH FROM NOW())
    RETURNING id, user_id, ip_pool_id, custom_ip, source, slot_index, custom_ip AS ip, created_at, updated_at
  `).get(userId, ip, slotIndex)

  return result
}
```

- [ ] **Step 4: 订阅查询兼容私有 IP**

在 `server/repositories/subscription-repository.js` 的用户 CF IP 查询中，将 `JOIN cf_ip_pool` 改为 `LEFT JOIN`，返回 `COALESCE(cp.ip, uci.custom_ip) AS ip`，并按 `slot_index` 排序。确保 `custom` 来源即使没有 `cf_ip_pool` 记录也能进入订阅生成。

- [ ] **Step 5: 管理端用户 CF IP 查询兼容**

在 `server/repositories/user-repository.js` 中搜索 `user_cf_ips`，把查询改为兼容 `source/custom_ip/slot_index`。管理员通过公共池选择用户 CF IP 的保存逻辑仍调用整体覆盖方法或等价写法，写入 `source='pool'`。

- [ ] **Step 6: 语法验证**

Run:

```bash
node -c server/repositories/cf-optimize-repository.js
node -c server/repositories/subscription-repository.js
node -c server/repositories/user-repository.js
```

Expected: 无语法错误。

---

### Task 3: 后端服务与路由

**Files:**
- Modify: `server/services/user/cf-optimize-service.js`
- Modify: `server/routes/user/cf-optimize.js`

- [ ] **Step 1: 新增 IP 校验工具函数**

在 `server/services/user/cf-optimize-service.js` 内新增：

```javascript
/**
 * 判断字符串是否为合法 IPv4 或 IPv6 地址。
 * @param {string} ip 用户输入 IP
 * @returns {boolean} 合法返回 true
 */
function isValidIpAddress(ip) {
  if (typeof ip !== 'string') return false
  const value = ip.trim()
  const ipv4 =
    /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/
  const ipv6 =
    /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::1|::|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4})$/
  return ipv4.test(value) || ipv6.test(value)
}
```

- [ ] **Step 2: 新增槽位替换 service**

在 `server/services/user/cf-optimize-service.js` 新增并导出：

```javascript
/**
 * 将当前用户指定槽位替换为用户私有 IP。
 * @param {object} db 数据库代理对象
 * @param {object} user 当前登录用户
 * @param {number|string} slotIndex 1~5 的槽位序号
 * @param {string} ip 用户手动输入 IP
 * @returns {Promise<object>} 替换后的槽位记录
 */
async function replaceCfIpSlotByAddress(db, user, slotIndex, ip) {
  const normalizedSlot = Number(slotIndex)
  const normalizedIp = typeof ip === 'string' ? ip.trim() : ''

  if (!Number.isInteger(normalizedSlot) || normalizedSlot < 1 || normalizedSlot > 5) {
    const error = new Error('槽位序号必须在 1 到 5 之间')
    error.statusCode = 400
    throw error
  }

  if (!isValidIpAddress(normalizedIp)) {
    const error = new Error('请输入合法的 IPv4 或 IPv6 地址')
    error.statusCode = 400
    throw error
  }

  return replaceUserCfIpSlotWithCustomIp(db, user.id, normalizedSlot, normalizedIp)
}
```

- [ ] **Step 3: 新增路由**

在 `server/routes/user/cf-optimize.js` 新增：

```javascript
router.patch('/cf-ips/slots/:slotIndex', authMiddleware, async (req, res) => {
  try {
    const slot = await cfOptimizeService.replaceCfIpSlotByAddress(
      db,
      req.user,
      req.params.slotIndex,
      req.body.ip
    )

    res.json({
      success: true,
      message: 'IP 替换成功',
      data: slot
    })
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'IP 替换失败'
    })
  }
})
```

实际代码中的 `authMiddleware`、`db`、service 命名以现有文件为准。

- [ ] **Step 4: 保持优选按钮接口语义**

确认现有 `POST /api/user/cf-ips/apply` 不新增确认逻辑、不改变前端交互，只让后端整体覆盖 `user_cf_ips`，从而自动覆盖用户私有 IP。

- [ ] **Step 5: 语法验证**

Run:

```bash
node -c server/services/user/cf-optimize-service.js
node -c server/routes/user/cf-optimize.js
```

Expected: 无语法错误。

---

### Task 4: 用户端 API 与界面

**Files:**
- Modify: `client-user/src/api/index.js`
- Modify: `client-user/src/views/user/CfOptimize.vue`

- [ ] **Step 1: 新增 API 方法**

在 `client-user/src/api/index.js` 的 `user` API 中新增：

```javascript
replaceCfIpSlot(slotIndex, ip) {
  return api.patch(`/user/cf-ips/slots/${slotIndex}`, { ip })
}
```

- [ ] **Step 2: 当前 IP 卡片增加替换按钮**

在 `client-user/src/views/user/CfOptimize.vue` 当前使用 IP 卡片区域，为每个真实 `currentIps` 项增加按钮：

```vue
<el-button
  type="primary"
  link
  size="small"
  @click="openReplaceDialog(index + 1, ip)"
>
  替换
</el-button>
```

如果当前只是默认占位 IP（例如 `source === 'default'`），不显示替换按钮，避免把占位状态误认为真实槽位。

- [ ] **Step 3: 新增替换弹窗**

在模板底部新增：

```vue
<el-dialog
  v-model="replaceDialogVisible"
  title="替换当前 IP"
  width="420px"
>
  <el-form label-position="top">
    <el-form-item label="IP 地址">
      <el-input
        v-model="replaceForm.ip"
        placeholder="请输入 IPv4 或 IPv6 地址"
        clearable
      />
    </el-form-item>
  </el-form>
  <template #footer>
    <el-button @click="replaceDialogVisible = false">取消</el-button>
    <el-button type="primary" :loading="replaceLoading" @click="submitReplaceIp">
      确定替换
    </el-button>
  </template>
</el-dialog>
```

- [ ] **Step 4: 新增前端状态与方法**

在 `<script setup>` 中新增：

```javascript
const replaceDialogVisible = ref(false)
const replaceLoading = ref(false)
const replaceForm = reactive({
  slotIndex: 1,
  ip: ''
})

function openReplaceDialog(slotIndex, currentIp) {
  replaceForm.slotIndex = slotIndex
  replaceForm.ip = currentIp?.ip || ''
  replaceDialogVisible.value = true
}

function isValidIpAddress(ip) {
  const value = String(ip || '').trim()
  const ipv4 =
    /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/
  const ipv6 =
    /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::1|::|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4})$/
  return ipv4.test(value) || ipv6.test(value)
}

async function submitReplaceIp() {
  const ip = replaceForm.ip.trim()
  if (!isValidIpAddress(ip)) {
    ElMessage.warning('请输入合法的 IPv4 或 IPv6 地址')
    return
  }

  replaceLoading.value = true
  try {
    await api.user.replaceCfIpSlot(replaceForm.slotIndex, ip)
    ElMessage.success('IP 替换成功')
    replaceDialogVisible.value = false
    await fetchCfIps()
  } catch (error) {
    ElMessage.error(error.response?.data?.message || 'IP 替换失败')
  } finally {
    replaceLoading.value = false
  }
}
```

- [ ] **Step 5: 不修改优选极速通道按钮确认行为**

不要在 `applyIps()` 或“优选极速通道”按钮点击处新增 `ElMessageBox.confirm`。用户确认要求保持当前代码原状。

- [ ] **Step 6: 前端构建验证**

Run:

```bash
cd client-user
npx vite build --minify esbuild
```

Expected: build 成功，无 Vue 编译错误。

---

### Task 5: 后端测试脚本

**Files:**
- Create: `server/test/test-user-private-cf-ips.js`

- [ ] **Step 1: 新增测试脚本**

创建测试脚本，覆盖：

```javascript
/**
 * 验证用户私有 CF IP 槽位替换：
 * 1. 公共池 IP 可整体写入 5 个槽位。
 * 2. 用户可将任意单槽位替换为 custom IP。
 * 3. 再次应用公共池 IP 后，custom IP 被覆盖。
 * 4. 订阅查询能读取 custom IP。
 */
async function run() {
  // 使用项目现有 db 初始化方式。
  // 准备测试用户和至少 5 条 enabled cf_ip_pool。
  // 调用 repository/service 方法断言 pool/custom/slot_index。
}
```

脚本应使用现有测试文件中的数据库初始化风格，不依赖真实线上数据；如果项目测试惯例直接连本地开发库，测试前后要清理自己插入的数据。

- [ ] **Step 2: 运行后端验证**

Run:

```bash
node server/test/test-user-private-cf-ips.js
```

Expected:

```text
✅ 公共池 IP 整体写入成功
✅ 单槽位私有 IP 替换成功
✅ 优选极速通道覆盖私有 IP 成功
✅ 订阅查询兼容私有 IP 成功
```

- [ ] **Step 3: 后端语法验证**

Run:

```bash
node -c server/db/schema/tables.js
node -c server/db/migrations/002-user-cf-ip-slots.js
node -c server/repositories/cf-optimize-repository.js
node -c server/repositories/subscription-repository.js
node -c server/repositories/user-repository.js
node -c server/services/user/cf-optimize-service.js
node -c server/routes/user/cf-optimize.js
node -c server/test/test-user-private-cf-ips.js
```

Expected: 全部无语法错误。

---

## Self-Review

- 需求覆盖：
  - 用户可手动输入任意 IP：Task 3、Task 4。
  - 用户私有，不进入公共池：Task 1、Task 2。
  - 逐个替换：Task 2、Task 3、Task 4。
  - 最多 5 个：Task 1 槽位约束、Task 3 槽位校验。
  - 点击优选极速通道覆盖手动 IP：Task 2 整体覆盖、Task 4 不增加确认弹窗。
  - `user_cf_ips` 是否调整：Task 1 明确调整为槽位表。
- Placeholder scan：无 `TBD`、`TODO`、`implement later`。
- Type consistency：
  - 后端统一使用 `slotIndex` 参数，数据库字段为 `slot_index`。
  - 来源统一为 `pool/custom`。
  - 前端 API 方法名为 `replaceCfIpSlot(slotIndex, ip)`，后端路由为 `/cf-ips/slots/:slotIndex`。

