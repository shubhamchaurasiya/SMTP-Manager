<?php
/**
 * SMTP Manager Agent
 * 
 * Place this file in the same plugin folder as smtp.php on each WordPress site.
 * Example path: wp-content/plugins/SMTP Plugin/smtp-agent.php
 *
 * Version: 1.1.0
 *
 * IMPORTANT: Change the token below to the token shown in the SMTP Manager Dashboard.
 */

// ─── CONFIGURATION ────────────────────────────────────────────
define('SMTP_AGENT_VERSION', '1.1.0');
// Fallback token used only when the WordPress DB has no token stored.
// The dashboard's /api/agent-file download fills this in automatically.
define('SMTP_AGENT_TOKEN', 'YOUR_SECRET_TOKEN_HERE');
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

// ─── Brute-force protection: lock out an IP after repeated bad tokens ───
$client_ip   = isset($_SERVER['REMOTE_ADDR']) ? preg_replace('/[^0-9a-fA-F:.]/', '', $_SERVER['REMOTE_ADDR']) : 'unknown';
$lockout_key = 'smtpfb_agent_lock_' . md5($client_ip);
$fail_count  = (int) get_transient($lockout_key);
if ($fail_count >= 10) {
    http_response_code(429);
    die(json_encode(['error' => 'Too many failed attempts. Try again later.']));
}

// ─── Token Verification (header only — never accept tokens in the URL,
//     they leak into access logs, proxies and browser history) ───
$token = !empty($_SERVER['HTTP_X_AGENT_TOKEN']) ? $_SERVER['HTTP_X_AGENT_TOKEN'] : '';

$db_token = get_option('smtp_fallback_agent_token');
if (empty($db_token)) {
    $db_token = defined('SMTP_AGENT_TOKEN') ? SMTP_AGENT_TOKEN : '';
}

if (empty($db_token) || !is_string($token) || !hash_equals($db_token, $token)) {
    set_transient($lockout_key, $fail_count + 1, 10 * MINUTE_IN_SECONDS);
    http_response_code(401);
    die(json_encode(['error' => 'Unauthorized', 'hint' => 'Check your API token']));
}
// Valid token — clear any accumulated failures for this IP
delete_transient($lockout_key);

// ─── Route Action ─────────────────────────────────────────────
$action = isset($_GET['action']) ? sanitize_text_field($_GET['action']) : 'ping';
$method = $_SERVER['REQUEST_METHOD'];
$raw    = file_get_contents('php://input');
$body   = !empty($raw) ? (json_decode($raw, true) ?: []) : [];

// State-changing actions must come over POST (defence against CSRF/link-based abuse)
$post_only = ['save_settings', 'test_email', 'toggle_plugin', 'push_update'];
if (in_array($action, $post_only, true) && $method !== 'POST') {
    http_response_code(405);
    agent_respond(['error' => 'This action requires POST']);
}

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

/**
 * Scan PHP source for common webshell / backdoor signatures.
 * Signatures are assembled from concatenated parts so this scanner
 * never flags its own source when it is itself pushed as an update.
 * Returns the matched signature name, or false when clean.
 */
function agent_scan_for_malware($content) {
    $sigs = [
        'eval+base64'      => 'eval(' . 'base64_decode(',
        'eval+gzinflate'   => 'eval(' . 'gzinflate(',
        'eval+gzuncompress'=> 'eval(' . 'gzuncompress(',
        'eval+str_rot13'   => 'eval(' . 'str_rot13(',
        'eval+request'     => 'eval(' . '$_',
        'assert+request'   => 'assert(' . '$_',
        'system+request'   => 'system(' . '$_',
        'exec+request'     => 'exec(' . '$_',
        'shell_exec+req'   => 'shell_exec(' . '$_',
        'passthru+request' => 'passthru(' . '$_',
        'create_function+req' => 'create_function(' . '$_',
        'b64+POST'         => 'base64_decode(' . '$_POST',
        'b64+GET'          => 'base64_decode(' . '$_GET',
        'b64+REQUEST'      => 'base64_decode(' . '$_REQUEST',
        'b64+COOKIE'       => 'base64_decode(' . '$_COOKIE',
    ];
    $normalized = preg_replace('/\s+/', '', $content);
    foreach ($sigs as $name => $sig) {
        if (stripos($normalized, $sig) !== false) {
            return $name;
        }
    }
    return false;
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
    if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table_sub)) === $table_sub) {
        $sub_count = (int) $wpdb->get_var("SELECT COUNT(*) FROM $table_sub");
    }

    // Count logs
    $log_count = 0;
    $table_log = $wpdb->prefix . 'cf7_automation_log';
    if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table_log)) === $table_log) {
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
    if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table)) === $table) {
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
    if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table)) === $table) {
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
    // Kill switch: define('SMTP_FALLBACK_DISABLE_PUSH', true) in wp-config.php
    // to fully disable remote file updates on this site.
    if (defined('SMTP_FALLBACK_DISABLE_PUSH') && SMTP_FALLBACK_DISABLE_PUSH) {
        http_response_code(403);
        agent_respond(['success' => false, 'error' => 'Push updates are disabled on this site']);
    }

    if (empty($body['files']) || !is_array($body['files'])) {
        agent_respond(['success' => false, 'error' => 'No files provided']);
    }

    // Relative paths inside the plugin folder that may be updated remotely —
    // must match PLUGIN_PUSH_FILES in the dashboard's server.js
    $allowed    = [
        'smtp.php',
        'smtp-agent.php',
        'index.php',
        'includes/cf7-integration.php',
        'includes/index.php',
        'assets/admin.css',
        'assets/admin.js',
        'assets/cf7-timing.js',
        'assets/index.php',
    ];
    $plugin_dir = dirname(__FILE__);
    $max_size   = 2 * 1024 * 1024; // 2 MB cap per file
    $updated    = [];
    $errors     = [];

    foreach ($body['files'] as $filename => $content) {
        // Normalise separators, then require an exact whitelist match
        // (defence-in-depth vs path traversal)
        $filename = str_replace('\\', '/', (string) $filename);
        if (strpos($filename, '..') !== false || !in_array($filename, $allowed, true)) {
            $errors[] = "Filename not allowed: $filename";
            continue;
        }
        if (!is_string($content) || $content === '') {
            $errors[] = "Empty content for: $filename";
            continue;
        }
        $is_php = substr($filename, -4) === '.php';
        if ($is_php && strpos($content, '<?php') === false) {
            $errors[] = "Invalid PHP content for: $filename";
            continue;
        }
        if (!$is_php && strpos($content, '<?php') !== false) {
            $errors[] = "PHP code not allowed in asset file: $filename";
            continue;
        }
        if (strlen($content) > $max_size) {
            $errors[] = "File too large for: $filename";
            continue;
        }
        // Reject content carrying common webshell/backdoor signatures
        $malware_hit = agent_scan_for_malware($content);
        if ($malware_hit !== false) {
            $errors[] = "Blocked $filename — suspicious code pattern ($malware_hit)";
            continue;
        }

        $target     = $plugin_dir . '/' . $filename;
        $target_dir = dirname($target);
        if (!is_dir($target_dir) && !wp_mkdir_p($target_dir)) {
            $errors[] = "Cannot create folder for $filename";
            continue;
        }

        if (file_exists($target)) {
            @copy($target, $target . '.bak');
        }

        // Atomic write: temp file + rename, so a partial write can never
        // leave a half-baked PHP file being executed
        $tmp = $target . '.tmp.' . wp_generate_password(8, false);
        if (file_put_contents($tmp, $content, LOCK_EX) !== false && @rename($tmp, $target)) {
            $updated[] = $filename;
        } else {
            @unlink($tmp);
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
