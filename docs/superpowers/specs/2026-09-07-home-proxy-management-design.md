# 家宽 IP 管理设计规格

## 背景

管理端需要维护家宽静态 IP 供应商提供的 SOCKS 服务，并将这些 SOCKS 服务写入所有已配置且在线的 3X-UI 服务器 Xray `outbounds` 配置。3X-UI 当前没有专门的 outbound CRUD API，因此服务端通过读取完整 Xray 配置、修改 `outbounds`、再回写完整配置的方式完成同步。

## 目标

- 在管理端新增“家宽 IP 管理”页面，入口放在“服务器管理”下面。
- 管理员可以新增、编辑、删除家宽 SOCKS 配置。
- 管理员点击“同步”后才向 3X-UI 服务器写入 outbound，新增和编辑保存时不自动同步。
- 同步目标为所有已配置的 3X-UI 服务器中的在线服务器。
- 同步操作使用现有并发组件，最大并发数限制为 10。
- 同步失败的服务器 ID 需要持久化记录，UI 展示失败服务器名称。
- 再次点击同步时，如果存在失败服务器，则只重试失败服务器。
- 全部同步成功后，UI 显示全部成功；再次点击同步会重新同步所有在线服务器。
- 删除远端 outbound 全部成功后才删除本地记录，部分失败时保留本地记录并展示失败服务器名称。

## 非目标

- 不实现 outbound 的高级参数配置。
- 不实现 routing 规则管理。
- 不自动把家宽 outbound 绑定到某个 routing rule。
- 不在新增或编辑保存后自动同步远端服务器。

## 数据字段

每条家宽 IP 配置包含：

- `tag`：本地全局唯一，必填，不预填默认值。
- `address`：SOCKS 服务器地址，必填。
- `port`：SOCKS 端口，必填，范围 1 到 65535。
- `user`：SOCKS 用户名，必填。
- `pass`：SOCKS 密码，必填。

同步相关字段：

- `sync_status`：同步状态。
- `failed_server_ids`：失败服务器 ID 数组。
- `last_sync_at`：最后同步时间。
- `last_sync_success_count`：最后一次同步成功数量。
- `last_sync_failed_count`：最后一次同步失败数量。
- `last_sync_message`：最后一次同步摘要。
- `created_at`：创建时间。
- `updated_at`：更新时间。

## 同步状态

- `pending`：本地已保存，等待同步。
- `success`：全部目标服务器同步成功。
- `partial_failed`：部分目标服务器同步失败。
- `failed`：全部目标服务器同步失败。
- `delete_failed`：删除远端 outbound 时部分或全部服务器失败。

## Outbound 生成规则

服务端根据本地记录生成 SOCKS outbound：

```json
{
  "protocol": "socks",
  "settings": {
    "servers": [
      {
        "address": "104.206.10.19",
        "port": 6716,
        "users": [
          {
            "user": "88tg5oNo6glP",
            "pass": "a1jVpSsW8eqz"
          }
        ]
      }
    ]
  },
  "tag": "local-ip-lax"
}
```

同步时以 `tag` 为幂等键：

- 如果目标服务器 `outbounds` 中不存在相同 `tag`，追加 outbound。
- 如果已存在相同 `tag`，用当前本地配置替换该 outbound。
- 不产生重复 `tag` outbound。

## 同步目标选择

点击“同步”时：

1. 如果当前记录没有失败服务器，或状态为 `pending` / `success`：
   - 同步所有在线 3X-UI 服务器。
2. 如果状态为 `partial_failed` / `failed`，且存在 `failed_server_ids`：
   - 只同步这些失败服务器。
3. 如果失败服务器当前离线：
   - 本次不重试该服务器。
   - 该服务器继续保留在失败列表。
   - UI 展示该服务器名称，并提示当前离线或未重试。
4. 如果本次目标全部成功，且没有遗留离线失败服务器：
   - 清空 `failed_server_ids`。
   - 状态更新为 `success`。
5. 如果仍有失败或未重试服务器：
   - 保存剩余失败服务器 ID。
   - 按失败比例更新为 `partial_failed` 或 `failed`。

编辑保存后必须把状态重置为 `pending`，并清空 `failed_server_ids`。下一次同步面向所有在线服务器，确保此前成功过的服务器也能获得最新配置。

## 删除规则

点击“删除”时：

1. 如果记录未同步过且没有失败服务器：
   - 直接删除本地记录。
2. 如果记录已同步成功、部分失败或删除失败：
   - 并发删除目标服务器中相同 `tag` 的 outbound，最大并发 10。
   - 如果当前状态为 `delete_failed` 且有失败服务器 ID，只重试这些失败服务器。
   - 否则面向所有在线 3X-UI 服务器执行删除。
3. 全部删除成功：
   - 删除本地记录。
4. 部分或全部删除失败：
   - 不删除本地记录。
   - 保存失败服务器 ID。
   - 状态设为 `delete_failed`。
   - UI 展示失败服务器名称。

删除失败后的重试通过再次点击“删除”触发；“同步”按钮仍负责新增或更新 outbound。

## 后端接口

新增管理端接口：

```text
GET    /api/admin/home-proxies
POST   /api/admin/home-proxies
PUT    /api/admin/home-proxies/:id
DELETE /api/admin/home-proxies/:id
POST   /api/admin/home-proxies/:id/sync
```

接口行为：

- `GET`：返回配置列表、同步状态、失败服务器名称。
- `POST`：新增本地记录，校验 `tag` 全局唯一，状态为 `pending`。
- `PUT`：编辑本地记录，校验 `tag` 全局唯一，状态重置为 `pending`。
- `DELETE`：先删除远端 outbound，成功后删除本地，失败时保留本地。
- `POST /sync`：按目标选择规则并发同步 outbound。

接口响应沿用当前管理端接口风格，使用 `legacySuccess` / `legacyFail` / `legacyValidationError`。

## 3X-UI 集成

服务端需要扩展现有 3X-UI API client：

- 读取 `/panel/api/xray/`。
- 回写 `/panel/api/xray/update`。

注意：3X-UI 的 update 接口使用表单字段 `xraySetting`，不能按普通 JSON body 直接提交。新增方法需要支持 form-urlencoded 或等价表单提交。

单台同步流程：

1. 创建对应服务器的 `XuiService`。
2. 获取 Xray 配置。
3. 解析 `xraySetting`。
4. 修改 `outbounds`。
5. 回写完整 `xraySetting`。

## 前端页面

新增 `HomeProxies.vue`：

- 顶部有“添加家宽 IP”按钮。
- 列表使用卡片布局，风格参考服务器管理卡片。
- 卡片展示 `tag`、`address`、`port`、用户名、同步状态、最后同步时间。
- 密码默认脱敏展示。
- 卡片按钮：同步、编辑、删除。
- 同步失败时展示失败服务器名称列表。
- 同步中和删除中禁用对应按钮，避免重复提交。

新增或编辑弹窗字段：

- `tag`
- `address`
- `port`
- `user`
- `pass`

前端保存只调用本地保存接口，不触发同步。

## 并发与失败记录

同步和删除均使用：

```javascript
runWithConcurrency(targetServers, 10, worker)
```

每台服务器失败时只记录该服务器失败，不影响其他服务器继续处理。最终聚合成功和失败结果后更新本地记录。

## 验证要求

后端：

- 新增服务层测试脚本，覆盖新增、编辑、同步、失败重试、删除成功和删除失败。
- 执行 `node server/test/test-home-proxies-service.js`。

前端：

- 执行 `cd client-admin && npx vite build --minify esbuild`。

服务端文件修改完成后提醒管理员重启后端服务。
