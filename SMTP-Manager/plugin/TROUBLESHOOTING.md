# SMTP Fallback Plugin - Troubleshooting Guide

## Quick Fix Summary

The AJAX actions `smtp_test_connection` and `smtp_send_test_email` have been fixed with the following improvements:

### ✅ **Fixed Issues:**

1. **Missing AJAX Handler**: Added `ajax_test_connection` method
2. **Improved Error Handling**: Added try-catch blocks and detailed error messages
3. **Better Nonce Verification**: Fixed nonce checking
4. **PHPMailer Loading**: Added proper PHPMailer initialization
5. **Enhanced Logging**: Added comprehensive debug logging
6. **Form Data Processing**: Fixed settings array processing for connection tests
7. **Timeout Handling**: Added connection timeouts and better error messages

### ✅ **New Features Added:**

1. **Debug Logging**: Enhanced logging to both WordPress error log and custom file
2. **Database Logging**: Added database table for storing SMTP logs
3. **Quick Test Function**: Added `smtp_fallback_quick_test()` function for debugging
4. **Admin Notices**: Added configuration reminders

## Testing Steps

### Step 1: Activate the Plugin

1. Go to **WordPress Admin → Plugins**
2. Find "SMTP Fallback Plugin - Enhanced"
3. Click **Activate**

### Step 2: Configure SMTP Settings

1. Go to **Settings → SMTP Fallback**
2. Configure your primary SMTP server:
   ```
   SMTP Host: smtp.gmail.com (or your provider)
   SMTP Port: 587
   SMTP Encryption: TLS
   SMTP Username: your-email@gmail.com
   SMTP Password: your-app-password
   ```

### Step 3: Test Connection

1. Click **"Test Primary Connection"** button
2. Look for green checkmark: ✓ Connection successful
3. If failed, check the error message and verify settings

### Step 4: Send Test Email

1. Enter your email address in the test field
2. Click **"Send Test Email"** button
3. Check your email inbox (and spam folder)


## Common Issues & Solutions

### Issue 1: "Connection Failed" Error

**Possible Causes:**

- Incorrect SMTP host or port
- Wrong encryption settings
- Firewall blocking SMTP ports
- Invalid credentials

**Solutions:**

1. **Gmail Users**:

   - Enable 2-factor authentication
   - Create App Password: https://myaccount.google.com/apppasswords
   - Use App Password instead of regular password

2. **Outlook/Hotmail Users**:

   - Use `smtp-mail.outlook.com` as host
   - Port 587 with TLS encryption
   - Use your regular password

3. **Yahoo Users**:

   - Use `smtp.mail.yahoo.com` as host
   - Enable "Less secure app access" or use App Password

4. **Custom Domain/cPanel**:
   - Check with hosting provider for correct SMTP settings
   - Usually: `mail.yourdomain.com` or `smtp.yourdomain.com`

### Issue 2: "Authentication Failed" Error

**Solutions:**

1. Double-check username and password
2. For Gmail: Use App Password, not regular password
3. For Yahoo: Enable "Less secure app access"
4. For custom domains: Verify email account exists

### Issue 3: AJAX Actions Not Working

**Fixed in Latest Version:**

- Added missing `ajax_test_connection` method
- Fixed nonce verification
- Improved error handling
- Added proper form data processing

**To Verify Fix:**

1. Check browser console for JavaScript errors
2. Check WordPress error log for PHP errors

### Issue 4: Emails Not Being Sent

**Debugging Steps:**

1. **Test Connection First**: Ensure SMTP connection works
2. **Check WordPress Email Settings**: Verify from email and name
3. **Enable Debug Mode**: Go to plugin settings and enable debug mode
4. **Check Error Logs**: Look for detailed error messages
5. **Test with Different Email Provider**: Try sending to different email addresses

### Issue 5: Plugin Not Loading

**Solutions:**

1. **Check PHP Version**: Ensure PHP 7.4 or higher
2. **Check WordPress Version**: Ensure WordPress 5.0 or higher
3. **Check for Conflicts**: Deactivate other SMTP plugins
4. **Check File Permissions**: Ensure plugin files are readable

## Debug Information

### Enable Debug Mode

1. Go to **Settings → SMTP Fallback**
2. Check **"SMTP Debug Mode"**
3. Save settings

### Check Debug Logs

1. **WordPress Error Log**: Check your WordPress error log
2. **Custom Log File**: Check `/wp-content/smtp-fallback-debug.log`
3. **Database Log**: Check the plugin admin page for recent activity

## Quick Test Function

You can also test the plugin programmatically:

```php
// Test email sending
$result = smtp_fallback_quick_test('test@example.com');
echo $result; // Will output success or failure message
```

## Verification Checklist

✅ **Plugin Activated**: Check WordPress Admin → Plugins  
✅ **SMTP Configured**: Primary server settings entered  
✅ **Connection Test**: Green checkmark on connection test  
✅ **Test Email**: Email received successfully  
✅ **Debug Mode**: Enabled for troubleshooting  
✅ **Error Logs**: No PHP errors in logs  
✅ **JavaScript Console**: No JavaScript errors

## Support Information

When requesting support, please provide:

1. **WordPress Version**: Found in Dashboard → Updates
2. **PHP Version**: Found in test interface
3. **Plugin Version**: 2.0.0
4. **SMTP Provider**: Gmail, Outlook, Yahoo, etc.
5. **Error Messages**: Exact error messages from logs
6. **Test Results**: Results from connection and email tests
7. **Debug Log**: Recent entries from debug log

## Advanced Debugging

### Check AJAX Requests

1. Open browser Developer Tools (F12)
2. Go to Network tab
3. Click test buttons
4. Check AJAX requests for errors

### Check PHP Error Log

```php
// Add to wp-config.php for debugging
define('WP_DEBUG', true);
define('WP_DEBUG_LOG', true);
define('WP_DEBUG_DISPLAY', false);
```

---

## Summary

The SMTP Fallback Plugin has been completely fixed and enhanced with:

- ✅ Working AJAX handlers for connection testing and email sending
- ✅ Comprehensive error handling and logging
- ✅ Improved user experience with better error messages
- ✅ Enhanced security with proper nonce verification

The plugin is now fully functional and ready for production use!
