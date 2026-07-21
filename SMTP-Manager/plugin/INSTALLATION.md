# SMTP Fallback Plugin - Installation Guide

## Quick Installation

### Step 1: Upload Plugin Files

1. Copy the entire "SMTP Plugin" folder to your WordPress plugins directory:
   ```
   wp-content/plugins/SMTP Plugin/
   ```

### Step 2: Activate Plugin

1. Go to WordPress Admin → Plugins
2. Find "SMTP Fallback Plugin - Enhanced"
3. Click "Activate"

### Step 3: Configure SMTP Settings

1. Go to **Settings → SMTP Fallback**
2. Configure your primary SMTP server
3. Configure your fallback SMTP server (optional but recommended)
4. Test connections
5. Save settings

## Detailed Configuration

### Primary SMTP Server Configuration

1. **SMTP Host**: Enter your primary SMTP server hostname

   - Example: `smtp.gmail.com`, `smtp.outlook.com`, `mail.yourdomain.com`

2. **SMTP Port**: Choose the appropriate port

   - `587` for TLS (recommended)
   - `465` for SSL
   - `25` for unencrypted (not recommended)

3. **SMTP Encryption**: Select encryption method

   - **TLS** (recommended for port 587)
   - **SSL** (for port 465)
   - **None** (not recommended)

4. **SMTP Username**: Your email account username

   - Usually your full email address

5. **SMTP Password**: Your email account password
   - For Gmail: Use App Password, not your regular password
   - For other providers: Use your regular password or app-specific password

### Fallback SMTP Server Configuration

Configure a second SMTP server from a different provider for redundancy:

1. Use a different email service provider than your primary
2. Follow the same configuration steps as primary server
3. Test the connection to ensure it works

### Failover Settings

1. **Retry Interval**: Time to wait between retry attempts (default: 5 minutes)
2. **Maximum Retries**: Number of retry attempts before switching to fallback (default: 3)

### Advanced Options

1. **Use Fallback for All Email Types**: Enable to use fallback system for all WordPress emails
2. **SMTP Debug Mode**: Enable for troubleshooting (disable in production)

## Popular Email Providers Setup

### Gmail Configuration

```
Host: smtp.gmail.com
Port: 587
Encryption: TLS
Username: your-email@gmail.com
Password: your-app-password
```

**Important**: Enable 2-factor authentication and create an App Password for Gmail.

### Outlook/Hotmail Configuration

```
Host: smtp-mail.outlook.com
Port: 587
Encryption: TLS
Username: your-email@outlook.com
Password: your-password
```

### Yahoo Mail Configuration

```
Host: smtp.mail.yahoo.com
Port: 587
Encryption: TLS
Username: your-email@yahoo.com
Password: your-app-password
```

### Custom Domain/cPanel Configuration

```
Host: mail.yourdomain.com (or smtp.yourdomain.com)
Port: 587 (or 465 for SSL)
Encryption: TLS (or SSL)
Username: your-email@yourdomain.com
Password: your-email-password
```

## Testing Your Configuration

### Test SMTP Connections

1. After configuring each server, click "Test Primary Connection" or "Test Fallback Connection"
2. Look for green checkmark indicating successful connection
3. If connection fails, verify your settings and try again

### Send Test Email

1. Enter a test email address
2. Click "Send Test Email"
3. Check if the email is received
4. Verify which server was used (primary or fallback)

## Contact Form 7 Integration

### Prerequisites

- Contact Form 7 plugin must be installed and activated
- At least one contact form must be created

### Setup Automation

1. Go to **Contact Form 7 → SMTP Automation**
2. Select a form to automate
3. Create automation rules based on your needs
4. Test the automation with form submissions

### Available Automation Actions

- Send automated emails
- Save data to custom database tables
- Send webhooks to external APIs
- Create WordPress users
- Add to mailing lists
- Send SMS notifications
- Create WordPress posts

## Troubleshooting

### Common Issues

#### "Connection Failed" Error

1. **Check credentials**: Verify username and password are correct
2. **Check host and port**: Ensure they match your email provider's settings
3. **Check encryption**: Make sure TLS/SSL settings are correct
4. **Firewall issues**: Contact your hosting provider about SMTP port access

#### "Authentication Failed" Error

1. **Gmail**: Enable 2-factor authentication and use App Password
2. **Yahoo**: Enable "Less secure app access" or use App Password
3. **Outlook**: Use your regular password or app-specific password
4. **Custom domains**: Verify email account exists and password is correct

#### Emails Not Being Sent

1. **Test connections first**: Ensure both primary and fallback connections work
2. **Check WordPress email settings**: Verify from email and name are set
3. **Check spam folders**: Test emails might be marked as spam
4. **Enable debug mode**: Check logs for detailed error messages

#### Plugin Conflicts

1. **Deactivate other SMTP plugins**: Only use one SMTP plugin at a time
2. **Check for conflicts**: Temporarily deactivate other plugins to test
3. **Theme conflicts**: Switch to default theme temporarily to test

### Debug Mode

Enable debug mode for detailed troubleshooting:

1. Go to **Settings → SMTP Fallback**
2. Check "SMTP Debug Mode"
3. Save settings
4. Attempt to send email
5. Check WordPress error logs for detailed SMTP communication

### Getting Support

When requesting support, please provide:

1. **WordPress version**
2. **Plugin version**
3. **Email provider details** (without passwords)
4. **Error messages** from debug logs
5. **Steps to reproduce** the issue

## Security Considerations

### Password Security

- Never share your SMTP passwords
- Use app-specific passwords when available
- Regularly rotate passwords
- Use strong, unique passwords

### Access Control

- Only administrators can access plugin settings
- All settings are stored securely in WordPress database
- Passwords are sanitized before storage

### Logging

- Debug logs may contain sensitive information
- Disable debug mode in production
- Regularly clean up old logs

## Performance Optimization

### Database Maintenance

- Old form submissions are automatically cleaned up
- Logs are rotated to prevent database bloat
- Failed attempts are tracked to prevent spam

### Caching

- SMTP connection results are cached
- Automation rules are cached for performance
- Settings are cached to reduce database queries

## Backup and Migration

### Export Settings

1. Go to plugin settings page
2. Click "Export Settings"
3. Save the JSON file securely

### Import Settings

1. Go to plugin settings page
2. Click "Import Settings"
3. Select your exported JSON file

### Database Backup

The plugin creates these database tables:

- `wp_cf7_smtp_submissions`
- `wp_cf7_smtp_mailing_list`
- `wp_cf7_automation_log`

Include these tables in your regular WordPress backups.

## Uninstallation

### Clean Uninstall

1. Export your settings (optional)
2. Deactivate the plugin
3. Delete plugin files
4. Database tables will be preserved unless manually removed

### Remove Database Tables (Optional)

If you want to completely remove all plugin data:

```sql
DROP TABLE IF EXISTS wp_cf7_smtp_submissions;
DROP TABLE IF EXISTS wp_cf7_smtp_mailing_list;
DROP TABLE IF EXISTS wp_cf7_automation_log;
DROP TABLE IF EXISTS wp_smtp_fallback_log;
```

**Warning**: This will permanently delete all form submissions and logs.

## Next Steps

After successful installation:

1. **Test thoroughly**: Send test emails and verify delivery
2. **Set up monitoring**: Check logs regularly for issues
3. **Configure automation**: Set up Contact Form 7 automation rules
4. **Create backups**: Export settings and backup database
5. **Monitor performance**: Check email delivery rates and response times

For advanced configuration and automation examples, see the main README.md file.
