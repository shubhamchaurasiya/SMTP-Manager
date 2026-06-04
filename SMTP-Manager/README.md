# SMTP Manager Dashboard

Central management software for the **SMTP Fallback Plugin** deployed across 1500+ WordPress sites.

---

## 🚀 Quick Start (3 Steps)

### Step 1 — Install Node.js (one time only)
1. Go to **https://nodejs.org**
2. Download the **LTS** version
3. Install it (click Next through all steps)

### Step 2 — Start the Dashboard
Double-click **`Start.bat`**

The dashboard opens automatically at **http://localhost:3000**

### Step 3 — Add Your WordPress Sites
1. Click **Sites → Add Site**
2. Fill in the site details and copy the generated token
3. Set up the agent on that site (see below)

---

## 📦 Files in This Folder

| File | Purpose |
|---|---|
| `Start.bat` | **Double-click to launch the dashboard** |
| `server.js` | The backend server (auto-started by Start.bat) |
| `smtp-agent.php` | Copy this to each WordPress site |
| `public/` | Dashboard web interface |
| `smtp-manager.db` | SQLite database (created on first run) |

---

## 🔧 Setting Up Each WordPress Site

### 1. Copy the agent file
Copy `smtp-agent.php` into the plugin folder on the WordPress site:
```
wp-content/plugins/SMTP Plugin/smtp-agent.php
```

### 2. Configure the token
Open `smtp-agent.php` on the site and change this line:
```php
define('SMTP_AGENT_TOKEN', 'YOUR_SECRET_TOKEN_HERE');
```
Replace `YOUR_SECRET_TOKEN_HERE` with the token from the dashboard (shown when you add the site).

### 3. Verify the agent URL
The agent URL will be:
```
https://your-site.com/wp-content/plugins/SMTP Plugin/smtp-agent.php
```

> **Note:** If your plugin folder has a different name, adjust the URL accordingly.

### 4. Add the site in the dashboard
- Click **Sites → Add Site**
- Enter the site name, URL, and paste the agent URL
- Copy the generated token into smtp-agent.php
- Click **Ping** to verify the connection

---

## ✨ Features

- **Dashboard Overview** — See all sites, online/offline status, alert counts
- **Sites Management** — Add, edit, delete, bulk import via CSV
- **SMTP Settings** — View and edit primary + fallback SMTP settings remotely
- **Test Email** — Send a test email through any site's SMTP
- **Automation Logs** — View CF7 automation log entries per site
- **CF7 Submissions** — View Contact Form 7 submissions per site
- **Alerts** — Automatic alerts when sites go offline
- **Bulk Import** — Import all 1500+ sites at once via CSV
- **Plugin Toggle** — Enable/disable plugin functionality remotely

---

## 🔄 How to Stop the Dashboard

Press `Ctrl+C` in the black terminal window, then close it.

---

## 📋 CSV Bulk Import Format

```csv
name, url, agent_url, api_token, notes
Client Site 1, https://site1.com, https://site1.com/wp-content/plugins/SMTP Plugin/smtp-agent.php, token1abc, Client: Acme Corp
Client Site 2, https://site2.com, https://site2.com/wp-content/plugins/SMTP Plugin/smtp-agent.php, token2def, Client: Beta LLC
```

---

## 🛠️ Troubleshooting

**Dashboard won't start**
- Make sure Node.js is installed: run `node --version` in Command Prompt
- Try running as Administrator

**Site shows Offline**
- Check the agent URL is correct
- Verify smtp-agent.php is uploaded to the correct folder
- Check the token matches exactly
- Make sure the WordPress site is accessible

**Cannot save settings**
- The WordPress site must be online and the agent file must be accessible
- Check the token hasn't been changed

---

*Built for Shubham Chaurasiya — SMTP Fallback Plugin v2.1.0*
