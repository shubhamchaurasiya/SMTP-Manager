# SMTP Fallback — WordPress Plugin

> **Advanced SMTP failover** for WordPress with automatic primary → fallback switching, Contact Form 7 integration, security notifications, and a central multi-site dashboard.

[![WordPress](https://img.shields.io/badge/WordPress-5.0%2B-blue?logo=wordpress)](https://wordpress.org)
[![PHP](https://img.shields.io/badge/PHP-7.4%2B-purple?logo=php)](https://php.net)
[![License](https://img.shields.io/badge/License-GPLv2-green)](https://www.gnu.org/licenses/gpl-2.0.html)
[![Version](https://img.shields.io/badge/Version-2.1.0-orange)](https://github.com/shubham-chaurasiya/smtp-fallback-plugin/releases)

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔄 **Primary + Fallback SMTP** | Automatic failover to a second SMTP server if the primary fails |
| ♻️ **Retry mechanism** | Configurable retry interval and max attempts before switching |
| 📋 **Contact Form 7 support** | Synchronous sending with ultra-fast (5 s) retry — forms complete before the email is sent |
| 🔐 **Security notifications** | Email alerts on login, password reset, and profile update events |
| 📂 **File change detection** | Hourly scans of wp-admin, wp-includes, and uploads for modified/added/removed files |
| 🖥️ **Central dashboard agent** | Every site auto-registers with the SMTP Manager Dashboard on activation |
| 🐛 **Debug mode** | Detailed per-server SMTP logging to a custom debug log file |

---

## 📦 Installation

### Manual (recommended for development)

1. Download or clone this repository.
2. Copy the plugin folder into your WordPress site's `wp-content/plugins/` directory and rename it to `smtp-fallback`.
3. Log in to **WordPress Admin → Plugins** and activate **SMTP Fallback**.
4. The plugin will automatically register this site with the SMTP Manager Dashboard (if it is running at `http://localhost:3000`).

### Requirements

- WordPress **5.0+**
- PHP **7.4+** (PHP 8.x recommended)
- A valid SMTP account (Gmail, Brevo, SendGrid, AWS SES, etc.)

---

## ⚙️ Configuration

Navigate to **Settings → SMTP Fallback** after activating the plugin.

### General Settings

#### Email Identity
| Field | Description |
|---|---|
| From Email | The address emails are sent from |
| From Name | The display name shown to recipients |

#### Primary SMTP Server
| Field | Example |
|---|---|
| SMTP Host | `smtp.gmail.com` / `smtp-relay.brevo.com` |
| SMTP Port | `587` (TLS) or `465` (SSL) |
| Encryption | TLS (port 587) · SSL (port 465) · None |
| Username | Your SMTP login (usually your email) |
| Password | Your SMTP password or app-specific password |

#### Fallback SMTP Server *(optional but recommended)*
Same fields as primary. Used automatically when the primary fails.

#### Failover Settings
| Field | Default | Description |
|---|---|---|
| Retry Interval | 5 min | Wait time between retry attempts |
| Max Retries | 3 | Number of attempts before switching to fallback |

---

## 🖥️ Dashboard Integration

When the plugin is activated, it **automatically registers this site** with the SMTP Manager dashboard:

- **Site Name**, **Site URL**, **Agent Endpoint URL**, and a **unique security token** are sent to `http://localhost:3000/api/sites`.
- A green **"Registered"** badge appears in **Settings → SMTP Fallback → Dashboard Integration**.
- If auto-registration fails (e.g. dashboard server is offline), click **Register with Dashboard** to retry manually.

To run the SMTP Manager dashboard locally:

```bash
cd SMTP-Manager
npm install
node server.js
# → Open http://localhost:3000
```

---

## 📁 File Structure

```
smtp-fallback/
├── smtp.php                  # Main plugin file
├── smtp-agent.php            # Agent endpoint (dashboard ↔ site communication)
├── assets/
│   ├── admin.css             # Admin page styles
│   ├── admin.js              # Admin page scripts
│   ├── cf7-timing.js         # CF7 form timing helper
│   └── index.php             # Directory protection
├── includes/
│   ├── cf7-integration.php   # Contact Form 7 integration
│   └── index.php             # Directory protection
├── .gitignore
├── README.md
├── INSTALLATION.md
└── TROUBLESHOOTING.md
```

---

## 🔒 Security

- **Token-based agent authentication** — every request to `smtp-agent.php` must carry the `X-Agent-Token` header matching the token stored in the WordPress database.
- **Password fields** are sanitized via `sanitize_text_field()` and never exposed in source.
- **Nonce verification** on every AJAX request.
- Tokens are generated with `wp_generate_password(64, false)` (cryptographically random, 64 chars).

---

## 🐛 Debug Mode

Enable **SMTP Debug Mode** in Advanced Options. Detailed logs are written to:

```
wp-content/smtp-fallback-debug.log
```

> ⚠️ Disable debug mode in production — logs may contain SMTP credentials.

---

## 📝 Changelog

### v2.1.0
- Auto-registration with SMTP Manager Dashboard on plugin activation
- Admin notice showing registration success/failure with full details
- Manual "Register with Dashboard" button with live status feedback
- Dashboard Integration section redesigned: site name, URL, token, agent endpoint all clearly listed

### v2.0.0
- Dual-server fallback with configurable retry
- Contact Form 7 synchronous sending
- Security notifications (login, password change)
- File change detection (hourly cron)

---

## 👨‍💻 Author

**Shubham Chaurasiya** — [rankmybusiness.com.au](https://www.rankmybusiness.com.au/)

---

## 📄 License

GPL v2 or later — see [GNU General Public License](https://www.gnu.org/licenses/gpl-2.0.html).
