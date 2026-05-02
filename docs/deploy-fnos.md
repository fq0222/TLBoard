# 飞牛NAS 部署 V免签 + Vmq-App + 网站 全套方案

> 网站、码支付服务端、安卓监控端全部跑在一台飞牛NAS上，本地通信，安全高效。
> 通过 Cloudflare Tunnel 将网站和支付回调暴露到公网。

---

## 目录

- [整体架构](#整体架构)
- [环境要求](#环境要求)
- [第一步：部署 V免签 Java 服务端](#第一步部署-v免签-java-服务端)
- [第二步：部署 Redroid 安卓容器](#第二步部署-redroid-安卓容器)
- [第三步：安装 Vmq-App 监控端](#第三步安装-vmq-app-监控端)
- [第四步：配置 Cloudflare Tunnel](#第四步配置-cloudflare-tunnel)
- [第五步：对接你的网站](#第五步对接你的网站)
- [安全优势](#安全优势)
- [运维与监控](#运维与监控)
- [常见问题](#常见问题)

---

## 整体架构

```
                        Cloudflare Tunnel
                              │
                    ┌─────────┴─────────┐
                    │   飞牛NAS (FnOS)   │
                    │                   │
                    │  ┌──────────────┐ │
                    │  │  你的网站     │ │ ← 公网用户访问
                    │  │  (Node/PHP)  │ │
                    │  └──────┬───────┘ │
                    │         │         │
                    │    localhost       │ ← 本地通信（不出本机）
                    │         │         │
                    │  ┌──────┴───────┐ │
                    │  │ V免签服务端   │ │
                    │  │  (Java:8080) │ │
                    │  └──────┬───────┘ │
                    │         │         │
                    │    localhost       │ ← 本地通信
                    │         │         │
                    │  ┌──────┴───────┐ │
                    │  │ Redroid 容器  │ │
                    │  │  安卓 12     │ │
                    │  │  ┌─────────┐ │ │
                    │  │  │Vmq-App  │ │ │ ← 监听支付宝/微信通知
                    │  │  └─────────┘ │ │
                    │  └──────────────┘ │
                    │                   │
                    └───────────────────┘

数据流：
1. 用户访问网站 → 下单 → 网站调 V免签 API（localhost:8080）
2. V免签生成收款二维码 → 返回给网站 → 展示给用户
3. 用户扫码付款 → 钱到你个人支付宝/微信
4. 手机收到到账通知 → Redroid 中的 Vmq-App 捕获通知
5. Vmq-App 上报 V免签服务端（localhost:8080）→ 匹配订单
6. V免签回调网站（localhost:3000）→ 完成发货
```

### 通信路径分析

| 通信链路 | 走向 | 是否经过公网 |
|----------|------|:------------:|
| 用户 → 网站 | Cloudflare Tunnel → NAS | ✅ 加密穿透 |
| 网站 → V免签 API | localhost:8080 | ❌ 纯本地 |
| Vmq-App → V免签 | localhost:8080 | ❌ 纯本地 |
| V免签 → 网站回调 | localhost:3000 | ❌ 纯本地 |
| 用户付款 → 支付宝 | 支付宝 APP | ✅ 支付宝通道 |

**核心优势：** 除了用户访问网站和用户付款这两步走公网，其余所有内部通信都在 NAS 本地完成。

---

## 环境要求

| 项目 | 要求 |
|------|------|
| 飞牛NAS | FnOS（基于 Debian，支持 Docker） |
| CPU | x86_64 架构（Redroid 需要） |
| 内存 | 建议 8GB+ |
| JDK | 1.8（V免签要求） |
| Docker | 已安装（飞牛自带） |
| 域名 | 已配置 Cloudflare Tunnel |
| 支付宝/微信 | 个人实名认证账号 |

---

## 第一步：部署 V免签 Java 服务端

### 1.1 创建目录

```bash
mkdir -p /vol1/docker/vmq
cd /vol1/docker/vmq
```

### 1.2 下载 V免签

```bash
# 下载 war 包（从 GitHub Releases）
wget https://github.com/szvone/Vmq/releases/download/v1.6.1/v.war -O vmq.war

# 如果 GitHub 下载慢，可以用镜像或手动上传
```

### 1.3 Docker 方式运行（推荐）

创建 `docker-compose.vmq.yml`：

```yaml
services:
  vmq:
    image: eclipse-temurin:8-jre
    container_name: vmq-server
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - ./vmq.war:/app/vmq.war
      - ./data:/root
    command: ["java", "-jar", "/app/vmq.war", "--server.port=8080"]
```

启动：

```bash
docker compose -f docker-compose.vmq.yml up -d
```

### 1.4 验证服务

```bash
# 检查容器运行状态
docker ps | grep vmq

# 测试访问
curl http://localhost:8080
# 应该返回 HTML 页面
```

浏览器访问 `http://你的NAS-IP:8080`，看到登录页面即成功。

### 1.5 初始配置

| 项目 | 默认值 |
|------|--------|
| 管理账号 | `admin` |
| 通讯密钥 | `admin` |

登录后进入「系统设置」：

1. **修改密码和通讯密钥**（务必修改！）
2. **上传支付宝收款码图片**
3. **上传微信收款码图片**（如需）
4. **设置订单超时时间**（建议 5-10 分钟）

---

## 第二步：部署 Redroid 安卓容器

Redroid 是 Docker 化的安卓系统，可以跑在 NAS 上，不需要单独的手机或模拟器。

### 2.1 加载内核驱动

飞牛NAS 需要先加载 `binder_linux` 驱动（Redroid 依赖它）。

```bash
# 检查驱动是否已加载
lsmod | grep binder

# 如果没有输出，需要手动加载
# 注意：飞牛NAS 内核版本不同，路径可能不同，请先确认
uname -r  # 查看内核版本

# 方法一：如果系统已有 binder 模块
sudo modprobe binder_linux devices="binder,hwbinder,vndbinder"

# 方法二：如果没有，需要编译安装（参考飞牛论坛教程）
# https://club.fnnas.com/forum.php?mod=viewthread&tid=36386
```

验证：

```bash
ls /dev/binder /dev/hwbinder /dev/vndbinder
# 三个设备文件都存在即可
```

### 2.2 创建 Redroid 容器

创建 `docker-compose.redroid.yml`：

```yaml
services:
  redroid:
    image: erstt/redroid:12.0.0_houdini_WSA
    container_name: redroid-android
    restart: unless-stopped
    privileged: true
    devices:
      - /dev/dri
      - /dev/binder
      - /dev/hwbinder
      - /dev/vndbinder
    ports:
      - "5555:5555"       # ADB 连接端口
      - "5556:5556"       # scrcpy 端口（可选）
    volumes:
      - ./redroid-data:/data
    command:
      - androidboot.redroid_gpu_mode=guest
      - androidboot.use_memfd=1
      - ro.enable.native.bridge.exec64=1
      - ro.dalvik.vm.native.bridge=libhoudini.so
```

启动：

```bash
docker compose -f docker-compose.redroid.yml up -d
```

### 2.3 连接安卓容器

安装 ADB 工具：

```bash
# Debian/Ubuntu
sudo apt install android-tools-adb

# 或者下载 platform-tools
# https://developer.android.com/studio/releases/platform-tools
```

连接：

```bash
adb connect NAS-IP:5555
# 例如：adb connect 192.168.1.100:5555

# 验证连接
adb devices
# 应该显示 192.168.1.100:5555 device
```

### 2.4 远程画面（可选）

使用 scrcpy 查看和操作安卓画面：

```bash
# 安装 scrcpy
sudo apt install scrcpy

# 连接
scrcpy --tcpip=NAS-IP:5555 --no-audio --max-size 720
```

---

## 第三步：安装 Vmq-App 监控端

### 3.1 下载 APK

从 GitHub Releases 下载：

```bash
wget https://github.com/shinian-a/Vmq-App/releases/latest/download/app-release.apk -O vmq-app.apk
```

### 3.2 安装到 Redroid

```bash
adb install vmq-app.apk
```

### 3.3 配置 Vmq-App

通过 scrcpy 打开 Vmq-App，或使用 adb 启动：

```bash
adb shell am start -n com.vmq.app/.MainActivity
```

在 APP 中配置：

| 配置项 | 值 |
|--------|-----|
| 服务端地址 | `http://10.0.2.2:8080`（容器访问宿主机） |
| 通讯密钥 | 你在 V免签后台设置的密钥 |

> ⚠️ **重要：** Redroid 容器内访问宿主机不能用 `localhost`，需要用 `10.0.2.2`（Docker 默认网关地址）。
> 如果你的 Docker 网络不是默认的，用 `docker inspect` 查看网关 IP。

如果 `10.0.2.2` 不通，也可以用宿主机的内网 IP（如 `192.168.1.100`）。

### 3.4 开启监听权限

在 Vmq-App 中：
1. 点击「开启服务」
2. 点击「检测监听权限」
3. 显示「监听权限正常」即配置成功

### 3.5 安装支付宝（可选）

如果需要在 Redroid 中直接运行支付宝：

```bash
# 下载支付宝 APK
wget https://alipay.com/appdownload -O alipay.apk

# 安装
adb install alipay.apk
```

登录你的支付宝账号，开启收款通知。

> **注意：** Redroid 中的支付宝是独立环境，相当于一个新手机。你需要在支付宝中开启通知权限。

---

## 第四步：配置 Cloudflare Tunnel

你的网站需要公网访问，但 V免签服务端**不需要**暴露到公网。

### 4.1 安装 cloudflared

```bash
# Debian/Ubuntu
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
```

### 4.2 登录

```bash
cloudflared tunnel login
# 浏览器授权你的域名
```

### 4.3 创建 Tunnel

```bash
# 创建 tunnel
cloudflared tunnel create my-nas-tunnel

# 记录 Tunnel ID
```

### 4.4 配置路由

创建 `~/.cloudflared/config.yml`：

```yaml
tunnel: YOUR_TUNNEL_ID
credentials-file: /root/.cloudflared/YOUR_TUNNEL_ID.json

ingress:
  # 你的网站 - 暴露到公网
  - hostname: your-domain.com
    service: http://localhost:3000

  # V免签管理后台（可选，建议不暴露）
  # - hostname: vmq.your-domain.com
  #   service: http://localhost:8080

  # 兜底规则
  - service: http_status:404
```

> ⚠️ **安全建议：** 不要把 V免签管理后台暴露到公网。如果需要远程管理，用 Cloudflare Access 或 WireGuard。

### 4.5 启动 Tunnel

```bash
# 前台运行测试
cloudflared tunnel run my-nas-tunnel

# 生产环境用 systemd
sudo cloudflared service install
sudo systemctl start cloudflared
sudo systemctl enable cloudflared
```

### 4.6 DNS 配置

```bash
cloudflared tunnel route dns my-nas-tunnel your-domain.com
```

现在 `your-domain.com` 就指向你的 NAS 上的网站了。

---

## 第五步：对接你的网站

### 5.1 关键配置

由于网站和 V免签在同一台 NAS 上，回调地址走本地：

```javascript
const VMQ_HOST = 'http://localhost:8080';        // 本地通信！
const NOTIFY_URL = 'http://localhost:3000/notify'; // 本地回调！
const SITE_URL = 'https://your-domain.com';       // 用户看到的地址
```

### 5.2 完整对接代码

```javascript
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ==================== 配置 ====================
const VMQ_HOST = 'http://localhost:8080';           // V免签服务端（本地）
const SECRET_KEY = 'your_secret_key';               // V免签通讯密钥
const SITE_URL = 'https://your-domain.com';         // 公网地址
// ==============================================

// 生成签名
function sign(payId, price, type, tradeNo) {
  return crypto.createHash('md5')
    .update(payId + price + type + tradeNo + SECRET_KEY)
    .digest('hex');
}

// 下单页面
app.get('/pay', async (req, res) => {
  const { item = '商品', amount = '0.01' } = req.query;
  const payId = 'ORD' + Date.now();

  try {
    // 调用 V免签 API（走本地 localhost）
    const { data } = await axios.post(`${VMQ_HOST}/create_order`, new URLSearchParams({
      pay_id: payId,
      price: amount,
      type: 'alipay',
      notify_url: `${VMQ_HOST}/notify`,  // 回调也走本地！但这里应该填你网站的回调地址
      return_url: `${SITE_URL}/success`,
    }));

    if (data.code === 1) {
      res.send(`
        <!DOCTYPE html>
        <html lang="zh">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>支付 - ${item}</title>
          <style>
            body { font-family: -apple-system, sans-serif; display: flex; justify-content: center;
                   align-items: center; min-height: 100vh; background: #f5f5f5; margin: 0; }
            .card { background: #fff; border-radius: 12px; padding: 40px; text-align: center;
                    box-shadow: 0 2px 20px rgba(0,0,0,0.08); max-width: 400px; }
            .amount { font-size: 28px; color: #1677ff; margin: 12px 0; }
            img { margin: 20px 0; border-radius: 8px; }
            .info { font-size: 13px; color: #999; margin-top: 16px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>${item}</h2>
            <div class="amount">¥${amount}</div>
            <p style="color:#666;font-size:14px;">请使用支付宝扫码支付</p>
            <img src="${data.data.qrcode}" width="250" height="250" alt="支付二维码">
            <p class="info">订单号: ${payId}</p>
            <p class="info">付款金额必须精确匹配</p>
          </div>
        </body>
        </html>
      `);
    } else {
      res.status(400).send('创建订单失败: ' + data.msg);
    }
  } catch (err) {
    res.status(500).send('服务异常: ' + err.message);
  }
});

// 支付回调（V免签服务端调用，走本地）
app.post('/notify', (req, res) => {
  const { pay_id, price, type, trade_no, sign: receivedSign } = req.body;

  // 验签
  const expected = sign(pay_id, price, type, trade_no);
  if (receivedSign !== expected) {
    console.warn('签名校验失败');
    return res.send('fail');
  }

  console.log(`✅ 支付成功: 订单${pay_id}, ¥${price}`);

  // TODO: 更新订单状态、发货等业务逻辑

  res.send('success');
});

// 成功页
app.get('/success', (req, res) => {
  res.send('<h1 style="text-align:center;margin-top:100px;">✅ 支付成功！</h1>');
});

app.listen(3000, () => console.log('网站已启动: http://localhost:3000'));
```

### 5.3 回调地址的关键点

V免签创建订单时传的 `notify_url` 应该填你**网站的回调地址**，而不是 V免签的地址：

```
用户付款 → Vmq-App 上报 → V免签服务端 → 回调你的网站
                                      ↓
                              notify_url: http://localhost:3000/notify
```

因为网站和 V免签在同一台 NAS 上，这个回调走 `localhost`，不出本机。

---

## 安全优势

### 传统方案（分散部署）

```
用户 → 公网 → 网站服务器
                ↓ HTTPS/API Key
              公网 → 码支付服务器
                        ↓ 公网回调
                      公网 → 网站服务器
```

- API Key 在公网传输，可能被截获
- 回调地址暴露在公网，可能被伪造
- 通信链路长，攻击面大

### 你的方案（NAS 本地部署）

```
用户 → Cloudflare Tunnel → NAS 网站
                              ↓ localhost（不出本机）
                            NAS V免签
                              ↓ localhost（不出本机）
                            NAS Redroid/Vmq-App
```

| 安全维度 | 提升 |
|----------|------|
| API 通信 | 全程 localhost，无法被外部监听 |
| 通讯密钥 | 只在本机内部传递，不经过任何网络 |
| 回调验证 | 回调来源是 localhost，几乎无法伪造 |
| 管理后台 | 不暴露公网，仅 NAS 内网可访问 |
| 攻击面 | 只有 Cloudflare Tunnel 一个入口 |

---

## 运维与监控

### 进程管理（systemd）

确保所有服务开机自启：

```bash
# Docker 容器已设置 restart: unless-stopped，开机自动启动

# Cloudflare Tunnel
sudo systemctl enable cloudflared
```

### 日志查看

```bash
# V免签日志
docker logs -f vmq-server

# Redroid 日志
docker logs -f redroid-android

# Cloudflare Tunnel 日志
journalctl -u cloudflared -f
```

### Redroid 保活

Redroid 容器内的 Vmq-App 需要保持运行。确保：

1. Vmq-App 已加入电池白名单
2. Redroid 容器设置了 `restart: unless-stopped`
3. 定期检查监听状态

```bash
# 检查 Redroid 容器状态
docker exec redroid-android dumpsys activity processes | grep vmq
```

### 备份

```bash
# 备份 V免签数据（H2 数据库）
cp /vol1/docker/vmq/data/mq.mv.db /vol1/backup/vmq-$(date +%Y%m%d).db

# 备份 Redroid 数据
cp -r /vol1/docker/vmq/redroid-data /vol1/backup/redroid-$(date +%Y%m%d)
```

---

## 常见问题

### Q: Redroid 中 Vmq-App 连不上 V免签服务端？

确认容器内访问宿主机的地址：
- Docker 默认网络：`10.0.2.2:8080`
- 自定义网络：用 `docker inspect <容器名>` 查看 Gateway IP
- 或直接用 NAS 的内网 IP：`192.168.x.x:8080`

### Q: binder_linux 驱动加载失败？

```bash
# 检查内核版本
uname -r

# 检查是否有 binder 模块
find /lib/modules/ -name "binder*"

# 如果没有，需要编译（参考飞牛论坛）
# https://club.fnnas.com/forum.php?mod=viewthread&tid=36386
```

### Q: 支付宝在 Redroid 中无法正常运行？

- 部分支付宝版本对模拟器/容器环境有限制
- 尝试使用较旧版本的支付宝 APK
- 或改用「店员模式」：在 Redroid 中登录小号，绑定为大号的店员

### Q: Cloudflare Tunnel 断了怎么办？

```bash
# 检查状态
systemctl status cloudflared

# 重启
systemctl restart cloudflared

# 查看日志
journalctl -u cloudflared --since "1 hour ago"
```

### Q: 如何不暴露 V免签管理后台但又能远程管理？

方案一：通过 Cloudflare Access 认证后暴露
方案二：通过 WireGuard/ZeroTier VPN 连入 NAS 内网后访问
方案三：通过 SSH 端口转发

```bash
# SSH 端口转发示例
ssh -L 8080:localhost:8080 user@your-nas-ip
# 然后本地浏览器访问 localhost:8080
```

---

## 参考链接

| 资源 | 地址 |
|------|------|
| V免签服务端 | https://github.com/szvone/Vmq |
| Vmq-App 监控端 | https://github.com/shinian-a/Vmq-App |
| Redroid 文档 | https://github.com/remote-android/redroid-doc |
| Redroid 飞牛教程 | https://club.fnnas.com/forum.php?mod=viewthread&tid=36386 |
| Cloudflare Tunnel | https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/ |
| scrcpy 远程控制 | https://github.com/Genymobile/scrcpy |
