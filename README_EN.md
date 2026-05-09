# Subscription Manager

English | [简体中文](./README.md)

A complete subscription management system for proxy panels, supporting multiple 3X-UI servers, online payments, Cloudflare IP optimization, and more.

## Features

### User Panel

- **Registration & Payment**: Integrated registration and payment flow, supporting Alipay/WeChat
- **Subscription Management**: Universal subscription (V2Ray/Clash) and Clash subscription
- **IP Optimization**: One-click Cloudflare node latency testing, automatic optimal IP selection
- **Plan Renewal**: Traffic accumulation mechanism, supporting plan switching
- **Ticket System**: Users can submit issues, admins respond promptly

### Admin Panel

- **Plan Management**: Flexible configuration of plan pricing, traffic, and duration with sales limit support
- **Order Management**: View all orders with status filtering
- **User Management**: Adjust user plans, traffic, and expiration dates
- **Announcement Management**: Markdown syntax support, pinning feature
- **Server Management**: Multiple 3X-UI server management with one-click sync
- **Ticket Management**: Handle user tickets with auto-close support

### Technical Features

- **Multi-Server Support**: Manage multiple 3X-UI servers simultaneously
- **Auto Sync**: Scheduled synchronization of user and traffic data
- **Security**: Login/registration rate limiting, payment signature verification
- **High Performance**: Connection pool optimization, automatic retry mechanism

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js + Express |
| Frontend | Vue 3 + Vite + Element Plus |
| Database | PostgreSQL |
| Payment | VMQ |
| 3X-UI Integration | 3xui-api-client |
| Deployment | PM2 + OpenResty + Cloudflare Tunnel |

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
npm install --production

# Install frontend dependencies and build
cd ../client-user
npm install
npm run build

cd ../client-admin
npm install
npm run build

# Initialize database
cd ../server
node init-db.js

# Start service
npm run dev
```

### Default Account

| Purpose | Account | Password |
|---------|---------|----------|
| Admin Panel | admin | admin123 |

> ⚠️ Please change the default password immediately after first login

## Project Structure

```
subscription-manager/
├── server/                 # Backend service
│   ├── routes/            # Routes
│   │   ├── user/          # User API
│   │   └── admin/         # Admin API
│   ├── services/          # Business logic
│   ├── middleware/         # Middleware
│   ├── jobs/              # Scheduled tasks
│   ├── db/                # Database initialization
│   └── app.js             # Entry file
├── client-user/           # User frontend
│   └── src/
│       ├── views/         # Page components
│       ├── api/           # API interfaces
│       └── stores/        # State management
├── client-admin/          # Admin frontend
│   └── src/
│       ├── views/         # Page components
│       ├── api/           # API interfaces
│       └── stores/        # State management
└── docs/                  # Documentation
```

## Configuration

### Server Configuration

Edit `server/config.js`:

```javascript
module.exports = {
  // Database configuration
  database: {
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'your_password',
    database: 'subscription_manager'
  },
  
  // JWT secrets (must be changed)
  user: {
    jwtSecret: 'your_user_jwt_secret'
  },
  admin: {
    jwtSecret: 'your_admin_jwt_secret'
  }
};
```

### 3X-UI Server Configuration

Add 3X-UI servers in the admin panel:

- **Name**: Server identifier
- **API URL**: 3X-UI panel address
- **Username/Password**: API authentication
- **Host**: CF port forwarding hostname
- **Port**: Client connection port

## Deployment Guide

For detailed deployment instructions, see [Deployment Guide](./docs/deploy-subscription-manager.md)

### Production Start

```bash
# Start with PM2
cd server
pm2 start ecosystem.config.js

# Save and enable auto-start
pm2 save
pm2 startup
```

## API Documentation

For complete API documentation, see [API.md](./docs/api.md)

## Changelog

### V1.0.0 (2026-05-09)

- 🎉 First official release
- ✨ Multiple 3X-UI server support
- ✨ Online payment (VMQ)
- ✨ Cloudflare IP optimization
- ✨ Subscription management (V2Ray/Clash)
- ✨ Plan renewal
- ✨ Ticket system
- ✨ Announcement management

## License

MIT License

## Support & Feedback

- Submit [Issue](https://github.com/fq0222/TLBoard/issues)
- View [Wiki](https://github.com/fq0222/TLBoard/wiki)
