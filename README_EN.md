# Subscription Manager

English | [简体中文](./README.md)

A subscription management system for multi-server 3X-UI deployments. The current codebase includes a user panel, an admin panel, and a unified Node.js backend for plan purchase, renewal, subscription generation, Cloudflare IP optimization, tickets, help articles, resource downloads, email workflows, referral balance rewards, Telegram internal APIs, and 3X-UI sync compensation.

## Project Layout

There is no root `package.json`. Install dependencies separately in each package:

| Directory | Purpose | Stack |
| --- | --- | --- |
| `server/` | Unified backend that starts both user and admin APIs | Node.js, Express, PostgreSQL |
| `client-user/` | User-facing SPA | Vue 3, Vite, Element Plus, Pinia |
| `client-admin/` | Admin SPA | Vue 3, Vite, Element Plus, Pinia |

Main directory responsibilities:

```text
subscription-manager-v1.0.0/
  server/
    app.js                         # Unified backend entry; starts both user and admin APIs
    config.js                      # Local development config for DB, JWT, site, and payment settings
    ecosystem.config.js            # PM2 production template; do not write real secrets here
    bootstrap/                     # Express app creation, route registration, shutdown cleanup
    routes/
      user/                        # User API routes mounted under /api/user
      admin/                       # Admin API routes mounted under /api/admin
      internal/                    # Internal APIs such as Telegram
    controllers/
      user/                        # User request handling and legacy response compatibility
      admin/                       # Admin request handling and legacy response compatibility
    services/
      user/                        # User-side business orchestration
      admin/                       # Admin-side business orchestration
      shared/                      # Shared domain logic for orders, subscriptions, traffic, tickets
    repositories/                  # PostgreSQL queries and data access wrappers
    integrations/
      xui/                         # 3X-UI API clients and sync task handling
      vmq/                         # VMQ payment adapter
      email/                       # Brevo email adapter
    db/
      schema/                      # Current tables, indexes, and default data
      migrations/                  # Upgrade scripts for existing deployments
    jobs/                          # Scheduled job registry and handlers
    websocket/                     # Admin long-running task progress channels
    uploads/                       # Runtime uploads for resources and blog images
    backupDB/                      # Runtime 3X-UI database backup output
    test/                          # Backend verification scripts
  client-user/
    src/
      api/                         # User API wrapper
      stores/                      # Pinia user state
      views/                       # Login, home, profile, tickets, help center, and user pages
      components/                  # Shared user-panel components
      utils/                       # Onboarding and user-side helpers
  client-admin/
    src/
      api/                         # Admin API wrapper
      stores/                      # Pinia admin state
      views/                       # Dashboard, users, plans, servers, resources, email, and admin pages
  docs/                            # Requirements, API, deployment, and design documents
```

Default ports:

- User API: `30000`
- Admin API: `30001`
- User frontend dev server: Vite default
- Admin frontend dev server: Vite default

## Features

### User Panel

- Home page plans, announcements, and public online support link.
- Register-and-pay flow, login, forgot password, and reset password.
- Profile page with plan, traffic, balance, account status, Telegram channel link, and onboarding state.
- Plan renewal with VMQ payment or balance payment.
- Cloudflare preferred IP selection by pool ID or direct IP address.
- Universal, Clash, and V2Ray Base64 subscription output.
- Help center articles, categories, detail pages, and images.
- Download resource list and per-user download links.
- Tickets with create, reply, close, and unread count.
- Tutorial emails and preset action emails.
- Referral links, click tracking, and first-payment balance rewards.
- Responsive mobile layout.

### Admin Panel

- Admin login, password change, and super-admin account management.
- 3X-UI server management, node sync, user update/delete, and database backups.
- Plan management with `lifetime` / `timed` types, sales limits, and home visibility.
- User management, user CF IP configuration, single-user and batch subscription generation.
- Orders, announcements, CF IP pool, and ticket management.
- Blog/help article management and image uploads.
- Brevo email configuration, templates, single send, campaigns, and logs.
- Resource upload, category, user-facing download visibility, distribution, token refresh, and expiration.
- System settings for traffic multiplier, referral reward coefficient, email, resources, subscription headers, Clash update interval, Telegram channel, and online support URL.
- Referral management for codes, clicks, reward balances, enable/disable, and reset.
- Telegram admin binding and internal monitoring API support.

## Subscription URLs

The current backend generates these subscription URLs:

```text
/api/user/subscription/sub/:subId
/api/user/subscription/sub/:subId?clash=1
/api/user/subscription/sub/:subId?v2ray=1
```

The backend does not currently register `/api/user/sub/:token`.

## Node Strategies

Subscription generation detects strategy from each 3X-UI inbound `remark`:

| Strategy | Detection | Behavior |
| --- | --- | --- |
| `cf` | Remark contains `cf` | Rewrites address with the user's preferred CF IPs, and uses server `client_port` plus `host` |
| `direct` | Default | Keeps the original node link where possible; sync writes `flow: xtls-rprx-vision` to 3X-UI |
| `hy2` | Remark contains `hy2` | Usually maps to `protocol=hysteria` in 3X-UI and outputs `hysteria2://` using `auth` |

Each user gets independent `uuid/auth/sub_id` per server inbound. Raw subscription templates are cached in `user_subscription_sources`, and later generations repair only invalid nodes.

## Quick Start

### Requirements

- Node.js 18+
- PostgreSQL 12+
- Nginx or OpenResty for production reverse proxying

### Install Dependencies

```bash
cd server
npm install

cd ../client-user
npm install

cd ../client-admin
npm install
```

### Initialize Database

```bash
cd server
npm run init-db
```

### Start Backend

```bash
cd server
npm run dev
```

`npm run dev:all` is currently a compatibility alias for the unified backend entry.

### Start Frontends

```bash
cd client-user
npm run dev

cd ../client-admin
npm run dev
```

### Build Frontends

```bash
cd client-user
npm run build

cd ../client-admin
npm run build
```

If terser is unavailable, use:

```bash
npx vite build --minify esbuild
```

## Configuration

Development config lives in `server/config.js`; the PM2 production template lives in `server/ecosystem.config.js`.

Recommended production environment variables:

```bash
USER_PORT=30000
ADMIN_PORT=30001
SITE_PROTOCOL=https
SITE_HOST=yourdomain.com
USER_APP_URL=https://yourdomain.com

DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=subscription_manager
DB_PASSWORD=change-me
DB_NAME=subscription_manager

USER_JWT_SECRET=change-me
ADMIN_JWT_SECRET=change-me

VMQ_API_URL=https://pay.example.com
VMQ_KEY=change-me
PAY_NOTIFY_URL=https://yourdomain.com/api/user/payment/notify
PAY_RETURN_URL=https://yourdomain.com/api/user/payment/return
```

Notes:

- VMQ callback URLs must be reachable by the VMQ service. Do not use a backend-local `127.0.0.1` address unless VMQ runs on the same host and network namespace.
- `server/config.js` may contain local real values during development, but should not be committed to a public remote.
- Do not write real secrets into `server/ecosystem.config.js`.

## Default Account

Database initialization creates the default admin account:

| Purpose | Account | Password |
| --- | --- | --- |
| Admin Panel | `admin` | `admin123` |

Change the password immediately after the first login.

## Background Jobs

The backend registers jobs for order expiration, zombie user cleanup, 3X-UI sync, sync retry queue, traffic sync, ticket auto-close, sales slot release, email campaigns, email log cleanup, 3X-UI database backups, batch subscription recovery, and Telegram health checks.

See [Requirements](./docs/requirements.md) and `server/jobs/index.js` for the exact schedule.

## Documentation

- [Requirements](./docs/requirements.md)
- [API Reference](./docs/api.md)
- [Deployment Guide](./docs/deploy-subscription-manager.md)
- [VMQ Server API](./docs/vmq-server-api.md)
- [3X-UI API Reference](./docs/3x-ui-api-3.2.5.md)

## License

MIT License
