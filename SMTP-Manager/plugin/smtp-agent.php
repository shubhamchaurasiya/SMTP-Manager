<?php
/**
 * SMTP Manager Agent
 * 
 * Place this file in the same plugin folder as smtp.php on each WordPress site.
 * Example path: wp-content/plugins/SMTP Plugin/smtp-agent.php
 *
 * IMPORTANT: Change the token below to the token shown in the SMTP Manager Dashboard.
 */

// ─── CONFIGURATION ────────────────────────────────────────────
define('SMTP_AGENT_VERSION', '1.0.0');
// ──────────────────────────────────────────────────────────────

// Security: no direct HTML output, JSON only
if (ob_get_level()) ob_end_clean();
header('Content-Type: application/json; charset=utf-8');
header('X-Robots-Tag: noindex, nofollow');

// ─── Bootstrap WordPress ──────────────────────────────────────
$wp_load = null;
$search_dirs = [
    // Standard: plugin is in wp-content/plugins/plugin-name/
    dirname(dirname(dirname(dirname(__FILE__)))) . '/wp-load.php',
    // One level higher (some setups)
    dirname(dirname(dirname(dirname(dirname(__FILE__))))) . '/wp-load.php',
];
foreach ($search_dirs as $path) {
    if (file_exists($path)) { $wp_load = $path; break; }
}

if (!$wp_load) {
    http_response_code(500);
    die(json_encode(['error' => 'Cannot locate wp-load.php. Check plugin folder structure.']));
}

// Suppress all output from WordPress bootstrap
define('DOING_CRON', true); // Prevents some output/redirects
ob_start();
require_once $wp_load;
ob_end_clean();

// ─── Token Verification (Using secure option from WordPress DB with static fallback) ───
$token = '';
if (!empty($_SERVER['HTTP_X_AGENT_TOKEN'])) {
    $token = $_SERVER['HTTP_X_AGENT_TOKEN'];
} elseif (!empty($_GET['_token'])) {
    $token = $_GET['_token']; // fallback for testing
}

$db_token = get_option('smtp_fallback_agent_token');
if (empty($db_token)) {
    $db_token = defined('SMTP_AGENT_TOKEN') ? SMTP_AGENT_TOKEN : '';
}

if (empty($db_token) || !hash_equals($db_token, $token)) {
    http_response_code(401);
    die(json_encode(['error' => 'Unauthorized', 'hint' => 'Check your API token']));
}

// ─── Route Action ─────────────────────────────────────────────
$action = isset($_GET['action']) ? sanitize_text_field($_GET['action']) : 'ping';
$method = $_SERVER['REQUEST_METHOD'];
$raw    = file_get_contents('php://input');
$body   = !empty($raw) ? (json_decode($raw, true) ?: []) : [];

switch ($action) {
    case 'ping':           agent_ping();           break;
    case 'status':         agent_status();         break;
    case 'get_settings':   agent_get_settings();   break;
    case 'save_settings':  agent_save_settings($body); break;
    case 'get_logs':       agent_get_logs();       break;
    case 'get_submissions':agent_get_submissions(); break;
    case 'test_email':     agent_test_email($body); break;
    case 'toggle_plugin':  agent_toggle($body);    break;
    case 'push_update':    agent_push_update($body); break;
    default:
        http_response_code(400);
        agent_respond(['error' => 'Unknown action: ' . $action]);
}

// ─── Helper ───────────────────────────────────────────────────
function agent_respond($data) {
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// ─── Handlers ─────────────────────────────────────────────────

function agent_ping() {
    agent_respond([
        'status'         => 'ok',
        'agent_version'  => SMTP_AGENT_VERSION,
        'plugin_version' => defined('SMTP_FALLBACK_VERSION') ? SMTP_FALLBACK_VERSION : 'unknown',
        'plugin_active'  => class_exists('SMTP_Fallback_Plugin'),
        'site_name'      => get_option('blogname'),
        'site_url'       => get_option('siteurl'),
        'wp_version'     => get_bloginfo('version'),
        'php_version'    => PHP_VERSION,
        'timestamp'      => current_time('mysql'),
    ]);
}

function agent_status() {
    global $wpdb;
    $opts = get_option('smtp_fallback_options', []);

    // Count submissions
    $sub_count = 0;
    $table_sub = $wpdb->prefix . 'cf7_smtp_submissions';
    if ($wpdb->get_var("SHOW TABLES LIKE '$table_sub'") === $table_sub) {
        $sub_count = (int) $wpdb->get_var("SELECT COUNT(*) FROM $table_sub");
    }

    // Count logs
    $log_count = 0;
    $table_log = $wpdb->prefix . 'cf7_automation_log';
    if ($wpdb->get_var("SHOW TABLES LIKE '$table_log'") === $table_log) {
        $log_count = (int) $wpdb->get_var("SELECT COUNT(*) FROM $table_log");
    }

    agent_respond([
        'status'         => 'ok',
        'site_name'      => get_option('blogname'),
        'site_url'       => get_option('siteurl'),
        'admin_email'    => get_option('admin_email'),
        'wp_version'     => get_bloginfo('version'),
        'php_version'    => PHP_VERSION,
        'plugin_version' => defined('SMTP_FALLBACK_VERSION') ? SMTP_FALLBACK_VERSION : 'unknown',
        'plugin_active'  => class_exists('SMTP_Fallback_Plugin'),
        'primary_smtp'   => [
            'host'       => $opts['primary_host']       ?? 'Not configured',
            'port'       => $opts['primary_port']       ?? '587',
            'username'   => $opts['primary_username']   ?? 'Not configured',
            'encryption' => $opts['primary_encryption'] ?? 'tls',
        ],
        'fallback_smtp'  => [
            'host'       => $opts['fallback_host']       ?? 'Not configured',
            'port'       => $opts['fallback_port']       ?? '587',
            'username'   => $opts['fallback_username']   ?? 'Not configured',
            'encryption' => $opts['fallback_encryption'] ?? 'tls',
        ],
        'smtp_enabled'      => !isset($opts['plugin_enabled']) || !empty($opts['plugin_enabled']),
        'debug_mode'        => !empty($opts['debug_mode']),
        'max_retries'       => $opts['max_retries']    ?? 3,
        'retry_interval'    => $opts['retry_interval'] ?? 5,
        'submission_count'  => $sub_count,
        'log_count'         => $log_count,
        'timestamp'         => current_time('mysql'),
    ]);
}

function agent_get_settings() {
    $opts = get_option('smtp_fallback_options', []);
    // Return full settings (passwords included — token auth is already enforced)
    agent_respond(['success' => true, 'settings' => $opts]);
}

function agent_save_settings($body) {
    $new = isset($body['settings']) ? $body['settings'] : $body;

    $allowed = [
        'primary_host', 'primary_port', 'primary_username', 'primary_password', 'primary_encryption',
        'fallback_host', 'fallback_port', 'fallback_username', 'fallback_password', 'fallback_encryption',
        'from_email', 'from_name', 'max_retries', 'retry_interval',
        'debug_mode', 'use_fallback_for_all',
    ];

    $current = get_option('smtp_fallback_options', []);

    foreach ($allowed as $key) {
        if (!array_key_exists($key, $new)) continue;
        if (in_array($key, ['debug_mode', 'use_fallback_for_all'], true)) {
            $current[$key] = filter_var($new[$key], FILTER_VALIDATE_BOOLEAN);
        } elseif ($key === 'from_email') {
            $current[$key] = sanitize_email($new[$key]);
        } elseif (in_array($key, ['primary_port', 'fallback_port', 'max_retries', 'retry_interval'], true)) {
            $current[$key] = absint($new[$key]);
        } else {
            $current[$key] = sanitize_text_field($new[$key]);
        }
    }

    $result = update_option('smtp_fallback_options', $current);

    agent_respond([
        'success' => true,
        'message' => 'Settings saved successfully',
        'changed' => $result,
    ]);
}

function agent_get_logs() {
    global $wpdb;
    $logs  = [];
    $table = $wpdb->prefix . 'cf7_automation_log';
    if ($wpdb->get_var("SHOW TABLES LIKE '$table'") === $table) {
        $logs = $wpdb->get_results(
            "SELECT * FROM $table ORDER BY timestamp DESC LIMIT 100",
            ARRAY_A
        );
    }
    agent_respond(['success' => true, 'logs' => $logs ?: [], 'count' => count($logs)]);
}

function agent_get_submissions() {
    global $wpdb;
    $rows  = [];
    $table = $wpdb->prefix . 'cf7_smtp_submissions';
    if ($wpdb->get_var("SHOW TABLES LIKE '$table'") === $table) {
        $rows = $wpdb->get_results(
            "SELECT id, form_id, form_title, status, ip_address, submission_time FROM $table ORDER BY submission_time DESC LIMIT 50",
            ARRAY_A
        );
    }
    agent_respond(['success' => true, 'submissions' => $rows ?: [], 'count' => count($rows)]);
}

function agent_test_email($body) {
    $to      = sanitize_email($body['email'] ?? get_option('admin_email'));
    $subject = 'Test from SMTP Manager — ' . get_option('blogname');
    $message = "This is a test email sent from the SMTP Manager Dashboard.\n\nSite: " . get_option('siteurl') . "\nTime: " . current_time('mysql');
    $result  = wp_mail($to, $subject, $message);
    agent_respond([
        'success' => (bool) $result,
        'message' => $result ? "Test email sent to {$to}" : "Failed to send. Check SMTP settings and debug logs.",
        'to'      => $to,
    ]);
}

function agent_toggle($body) {
    $enabled = !empty($body['enabled']) ? 1 : 0;
    $opts    = get_option('smtp_fallback_options', []);
    $opts['plugin_enabled'] = $enabled;
    update_option('smtp_fallback_options', $opts);
    agent_respond([
        'success' => true,
        'enabled' => (bool)$enabled,
        'message' => $enabled ? 'Plugin enabled' : 'Plugin disabled',
    ]);
}

function agent_push_update($body) {
    if (empty($body['files']) || !is_array($body['files'])) {
        agent_respond(['success' => false, 'error' => 'No files provided']);
    }

    $allowed    = ['smtp.php', 'smtp-agent.php'];
    $plugin_dir = dirname(__FILE__);
    $updated    = [];
    $errors     = [];

    foreach ($body['files'] as $filename => $content) {
        if (!in_array($filename, $allowed, true)) {
            $errors[] = "Filename not allowed: $filename";
            continue;
        }
        if (empty($content) || strpos($content, '<?php') === false) {
            $errors[] = "Invalid PHP content for: $filename";
            continue;
        }

        $target = $plugin_dir . DIRECTORY_SEPARATOR . $filename;

        if (file_exists($target)) {
            @copy($target, $target . '.bak');
        }

        if (file_put_contents($target, $content) !== false) {
            $updated[] = $filename;
        } else {
            $errors[] = "Write failed for $filename — check folder permissions";
        }
    }

    agent_respond([
        'success' => count($errors) === 0 && count($updated) > 0,
        'updated' => $updated,
        'errors'  => $errors,
        'message' => count($updated) > 0
            ? implode(', ', $updated) . ' updated successfully'
            : 'No files were updated',
    ]);
}
