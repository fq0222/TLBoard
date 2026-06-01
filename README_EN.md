# Subscription Manager

English | [简体中文](./README.md)

A subscription management system for multi-3X-UI deployments, covering plan purchase, subscription generation, Cloudflare optimization, resource delivery, email workflows, and cross-server synchronization.

## Overview

- Backend: `server/`, built with Node.js + Express + PostgreSQL
- User panel: `client-user/`, built with Vue 3 + Vite + Element Plus
- Admin panel: `client-admin/`, built with Vue 3 + Vite + Element Plus
- Package layout: three independent packages, no root `package.json`
- Backend entrypoint: `server/app.js`, which starts both the user API on `30000` and the admin API on `30001`

## Current Capabilities

### User Panel

- Browse plans, purchase, renew, and switch plans
- Generate universal subscriptions and Clash subscriptions
- Manage Cloudflare preferred IPs
- Claim downloadable resources and reset delivery links
- Read announcements, browse help center articles, request tutorial emails
- Responsive layout for mobile devices

### Admin Panel

- Manage multiple 3X-UI servers and trigger one-click sync
- Manage plans, orders, users, and announcements
- Distribute resources, expire links, and refresh tokens
- Manage email templates, campaigns, and delivery logs
- View dashboard metrics and configure traffic multiplier
- Back up 3X-UI databases every day

## Node and Subscription Strategies

The system currently supports three inbound handling strategies detected from inbound `remark`:

- `cf`: remark contains `cf`; subscriptions replace address, port, and host, and generate one node per preferred CF IP
- `direct`: default strategy; keeps the original node values and auto-applies `flow: xtls-rprx-vision` when syncing to 3X-UI
- `hy2`: remark contains `hy2`; maps to `protocol=hysteria` in 3X-UI and outputs `hysteria2://` subscriptions

### hy2 Details

- 3X-UI client auth uses `auth`, not `id`
- Client sync payload includes `auth`, `email`, `subId`, `enable`, `expiryTime`, `totalGB`, `limitIp`, and `tgId`
- Universal subscriptions add `security=tls`, `mport=40000-50000`, `insecure=0`, and `allowInsecure=0`
- Clash subscriptions add `ports: 40000-50000`, `tls: true`, and `skip-cert-verify: false`

### Raw Subscription Template Cache

- Raw subscription templates are cached per user, per server, and per inbound in `user_subscription_sources`
- Subscription generation reuses cached templates first and repairs only invalid pairs when needed
- `hysteria` inbounds automatically match `hysteria2://` raw links

## Synchronization and Background Jobs

### 3X-UI User Sync

- Purchase, renewal, enable, and disable actions all trigger 3X-UI synchronization
- Failed sync tasks are written into the `xui_sync_tasks` compensation queue
- The retry worker starts after 30 seconds and then runs every minute
- Retry backoff steps are 1 minute, 5 minutes, 15 minutes, 1 hour, and 4 hours

### Scheduled Jobs

- Traffic sync and auto-disable: first run after 10 minutes, then hourly
- Mark expired orders: every 10 minutes
- Delete expired orders: first run after 5 minutes, then hourly
- Clean zombie users: first run after 2 minutes, then every 30 minutes
- Full 3X-UI user sync: first run after 1 minute, then every 4 hours
- Ticket auto-close check: first run after 3 minutes, then hourly
- Release expired sales slots: daily at 05:00
- Email campaigns: daily at 09:00
- Email log cleanup: daily at 03:00
- 3X-UI database backup: daily at 04:00

## Technical Highlights

- Unified management for multiple 3X-UI servers
- PostgreSQL connection pooling with automatic retry on transient failures
- Rate limiting for user login and registration
- Aggregated traffic accounting, multiplier support, and auto-disable on overuse
- Consistency maintenance based on `sub_id`, `auth`, and `flow`
- Support for downloading and overwriting the latest `x-ui.db` via 3X-UI API Token

## Quick Start

### Requirements

- Node.js 18.x LTS
- PostgreSQL 12+
- OpenResty or Nginx

### Installation

```bash
# Clone repository
git clone https://github.com/fq0222/TLBoard.git
cd TLBoard

# Install backend dependencies
cd server
npm install

# Install user panel dependencies
cd ../client-user
npm install

# Install admin panel dependencies
cd ../client-admin
npm install

# Initialize database
cd ../server
npm run init-db

# Start backend only
npm run dev

# Start backend in production mode
npm run start

# Current dev:all is a compatibility alias for the unified backend entry
npm run dev:all

# Start user panel frontend
cd ../client-user
npm run dev

# Start admin panel frontend
cd ../client-admin
npm run dev
```

### Default Admin Account

| Purpose | Account | Password |
|---------|---------|----------|
| Admin Panel | `admin` | `admin123` |

Change the default password immediately after the first login.

## Configuration

### Core Config Files

- Development config: `server/config.js`
- Production config: `server/ecosystem.config.js`
- Site URL helpers: `server/utils/site-url.js`

### Site URL Settings

Features such as subscription URLs and email links depend on a full site URL:

```javascript
site: {
  protocol: process.env.SITE_PROTOCOL || 'http',
  host: process.env.SITE_HOST || '',
}
```

Recommended production environment variables:

```bash
SITE_PROTOCOL=https
SITE_HOST=yourdomain.com
```

### 3X-UI Server Settings

When adding a 3X-UI server in the admin panel, configure:

- Name: display name of the server
- API URL: 3X-UI panel URL
- API Token: API token generated by 3X-UI
- Host / Port: used by `cf` strategy output
- Subscription URL: original 3X-UI subscription URL

## Key Directories

```text
server/
  app.js
  routes/
  controllers/
  repositories/
  services/
    admin/
    user/
    shared/
  integrations/
    xui/
    vmq/
    email/
  jobs/
  db/
client-user/
  src/
client-admin/
  src/
docs/
```

Important service files:

- `server/services/shared/order-service.js`: purchase, renewal, and 3X-UI sync flow
- `server/integrations/xui/xui-service.js`: 3X-UI API integration
- `server/services/shared/subscription-strategy.js`: strategy detection and link rewriting
- `server/services/shared/subscription-service.js`: raw subscription template cache and repair
- `server/integrations/xui/xui-sync-task-service.js`: 3X-UI compensation queue
- `server/services/shared/traffic-manager.js`: traffic aggregation and auto-disable logic
- `server/integrations/vmq/vmq-service.js`: VMQ payment integration
- `server/integrations/email/email-service.js`: Brevo email integration

## Documentation

- [Requirements](./docs/requirements.md)
- [API Reference](./docs/api.md)
- [Deployment Guide](./docs/deploy-subscription-manager.md)

## Changelog

### V1.7.1 (2026-05-30)

- Completed the backend directory refactor around `routes / controllers / repositories / services / integrations`
- Added `services/user`, `services/admin`, and `services/shared` to separate endpoint orchestration from shared domain logic
- Added `integrations/xui`, `integrations/vmq`, and `integrations/email` for external adapters
- Unified backend startup under `server/app.js` and removed the legacy `app-user.js` and `app-admin.js` entries
- Updated the README, requirements doc, and API reference to match the current implementation

### V1.7.0 (2026-05-29)

- Added the `hy2` strategy with `hysteria2://` support for both universal and Clash subscriptions
- Finished 3X-UI interoperability for hy2 and standardized client authentication on `auth`
- Added raw subscription template caching and incremental repair, including `hysteria` to `hysteria2` matching
- Added the `xui_sync_tasks` compensation queue for failed purchase, renewal, enable, and disable syncs
- Brought README and project docs in line with the current help center, resource delivery, and traffic multiplier behavior

### V1.6.0 (2026-05-22)

- Adapted 3X-UI authentication to the newer API Token flow
- Added configurable traffic usage multiplier in the admin panel
- Back up every server's `x-ui.db` daily at 04:00
- Reuse one resource delivery record per user
- Allow the user panel to create, reset, or reuse download links automatically

### V1.5.0 (2026-05-15)

- Added admin-side management for user Cloudflare preferred IPs
- Added admin-side subscription link generation for users
- Fixed expired sales slot release so it only affects paid users whose traffic has been exhausted for over 3 days without renewal
- Moved the expired slot release task to 05:00 daily

### V1.4.0 (2026-05-13)

- Added mobile support for the user panel
- Added getting-started guidance and tutorial emails
- Added site protocol configuration for HTTPS deployments
- Added loading state to server sync and extended related timeouts to 60 seconds

### V1.3.0 (2026-05-12)

- Integrated Brevo-based email delivery
- Added email templates, campaigns, logs, and quota controls

### V1.2.0 (2026-05-11)

- Introduced `cf` and `direct` subscription strategies
- Added independent UUID and `sub_id` per user per node
- Auto-applied `xtls-rprx-vision` to direct nodes

### V1.1.0 (2026-05-09)

- Added cross-server traffic aggregation and automatic disable
- Re-enable users automatically after renewal

### V1.0.0 (2026-05-09)

- First official release
- Included multi-3X-UI support, online payment, announcements, and core subscription management

## License

MIT License

## Support and Feedback

- Submit an [Issue](https://github.com/fq0222/TLBoard/issues)
- Visit the [Wiki](https://github.com/fq0222/TLBoard/wiki)

## Referral System Addendum (2026-06-01)

### User-Facing Capabilities

- Added a referral entry to the user "My" page, with overview and referral detail screens
- Users can copy their dedicated referral link
- Referral detail pages show click count, rewarded order count, rewarded traffic total, and per-order reward records
- The user homepage now displays traffic as "used / total (plan + referral)"

### Reward Rules

- A referral click is recorded when a new visitor opens a referral link
- Reward traffic is granted only when the referred user completes the first successful payment
- Each referred user can trigger the reward only once; later renewals do not create more rewards
- Reward traffic is configured from the admin system settings

### Traffic Entitlement Semantics

- Total traffic = plan traffic `traffic_limit` + referral traffic `referral_traffic_limit`
- Traffic accounting, over-limit checks, and 3X-UI sync all use the combined total
- Granting a referral reward does not immediately trigger a dedicated 3X-UI sync for the referrer; the new total is propagated by later sync flows or scheduled reconciliation jobs

### Admin Capabilities

- Added a dedicated "Referral Management" page
- Admins can inspect each user's referral link, clicks, rewarded orders, and rewarded traffic
- Admins can open per-user referral reward details
- Admins can enable or disable referral functionality
- Admins can reset a user's referral link

### Configuration and Migration

- Referral reward traffic is stored in the `referral_reward_traffic` system setting
- Referral link generation depends on `USER_APP_URL` or the development `userAppUrl` fallback
- New environments create referral tables during database initialization
- Existing environments must run `node server/db/migrations/011-referral-system.js`
