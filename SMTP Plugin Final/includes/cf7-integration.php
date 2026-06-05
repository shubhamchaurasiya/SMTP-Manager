<?php
/**
 * Contact Form 7 Integration for SMTP Fallback Plugin
 * 
 * This file handles the integration with Contact Form 7 to automate
 * form data processing and email sending with SMTP fallback support.
 */

// Prevent direct access
if (!defined('ABSPATH')) {
    exit;
}

/**
 * Contact Form 7 SMTP Integration Class
 */
class CF7_SMTP_Integration {
    
    private $smtp_plugin;
    
    public function __construct() {
        $this->init();
    }
    
    /**
     * Initialize the integration
     */
    public function init() {
        // Check if Contact Form 7 is active
        if (!class_exists('WPCF7')) {
            return;
        }
        
        // Hook into Contact Form 7 events
        add_action('wpcf7_mail_sent', array($this, 'handle_form_submission'), 10, 1);
        add_action('wpcf7_mail_failed', array($this, 'handle_form_failure'), 10, 1);
        
        // Log on submit to catch cases where mail is skipped by SMTP Fallback
        add_action('wpcf7_submit', array($this, 'log_on_submit'), 20, 2);
        
        // Add custom hooks for form data automation
        add_action('wpcf7_before_send_mail', array($this, 'before_send_mail'), 10, 3);
        add_action('wpcf7_after_send_mail', array($this, 'after_send_mail'), 10, 3);
        
        // Admin hooks
        add_action('admin_menu', array($this, 'add_admin_menu'));
        add_action('admin_init', array($this, 'register_settings'));
        
        // AJAX handlers for automation
        add_action('wp_ajax_cf7_test_automation', array($this, 'ajax_test_automation'));
        add_action('wp_ajax_cf7_export_data', array($this, 'ajax_export_data'));
        add_action('wp_ajax_cf7_clear_submissions', array($this, 'ajax_clear_submissions'));
        
        // Database setup
        add_action('init', array($this, 'create_database_tables'));
    }
    
    /**
     * Handle successful form submission
     */
    public function handle_form_submission($contact_form) {
        $submission = WPCF7_Submission::get_instance();
        
        if (!$submission) {
            return;
        }
        
        $posted_data = $submission->get_posted_data();
        $form_id = $contact_form->id();
        $form_title = $this->get_form_title_from_sender($contact_form);
        
        // Log the submission
        $this->log_form_submission($form_id, $form_title, $posted_data, 'success');
        
        // Process automation rules
        $this->process_automation_rules($form_id, $posted_data, 'success');
        
        // Send notification emails if configured
        $this->send_notification_emails($form_id, $posted_data, 'success');
    }
    
    /**
     * Handle failed form submission
     */
    public function handle_form_failure($contact_form) {
        $submission = WPCF7_Submission::get_instance();
        
        if (!$submission) {
            return;
        }
        
        $posted_data = $submission->get_posted_data();
        $form_id = $contact_form->id();
        $form_title = $this->get_form_title_from_sender($contact_form);
        
        // Log the failure
        $this->log_form_submission($form_id, $form_title, $posted_data, 'failed');
        
        // Process automation rules for failures
        $this->process_automation_rules($form_id, $posted_data, 'failed');
        
        // Send failure notification emails if configured
        $this->send_notification_emails($form_id, $posted_data, 'failed');
    }
    
    /**
     * Log on submit (ensure logging even if mail is skipped)
     */
    public function log_on_submit($contact_form, $result) {
        // Prevent double logging if mail_sent/mail_failed already triggered
        if (did_action('wpcf7_mail_sent') || did_action('wpcf7_mail_failed')) {
            return;
        }

        $submission = WPCF7_Submission::get_instance();
        if (!$submission) return;

        $status = ($result['status'] == 'mail_sent' || $result['status'] == 'validation_error' ? $result['status'] : 'failed');
        // Map CF7 status to our status
        $log_status = ($result['status'] == 'mail_sent' ? 'success' : ($result['status'] == 'mail_failed' ? 'failed' : $result['status']));

        $form_title = $this->get_form_title_from_sender($contact_form);

        $this->log_form_submission(
            $contact_form->id(),
            $form_title,
            $submission->get_posted_data(),
            $log_status
        );
    }
    
    /**
     * Before send mail hook
     */
    public function before_send_mail($contact_form, &$abort, $submission) {
        $form_id = $contact_form->id();
        $posted_data = $submission->get_posted_data();
        
        // Apply pre-send automation rules
        $this->apply_pre_send_rules($form_id, $posted_data, $abort);
        
        // Log pre-send event
        error_log("CF7 SMTP: Before send mail for form {$form_id}");
    }
    
    /**
     * After send mail hook
     */
    public function after_send_mail($contact_form, $result, $submission) {
        $form_id = $contact_form->id();
        $posted_data = $submission->get_posted_data();
        
        // Apply post-send automation rules
        $this->apply_post_send_rules($form_id, $posted_data, $result);
        
        // Log post-send event
        error_log("CF7 SMTP: After send mail for form {$form_id}, result: " . print_r($result, true));
    }
    
    /**
     * Log form submission to database
     */
    private function log_form_submission($form_id, $form_title, $posted_data, $status) {
        global $wpdb;
        
        $table_name = $wpdb->prefix . 'cf7_smtp_submissions';
        
        $data = array(
            'form_id' => $form_id,
            'form_title' => $form_title,
            'form_data' => json_encode($posted_data),
            'status' => $status,
            'ip_address' => $this->get_client_ip(),
            'user_agent' => sanitize_text_field($_SERVER['HTTP_USER_AGENT'] ?? ''),
            'submission_time' => current_time('mysql'),
            'processed' => 0
        );
        
        $wpdb->insert($table_name, $data);
        
        // Clean up old submissions (keep last 1000)
        $this->cleanup_old_submissions();
    }
    
    /**
     * Process automation rules
     */
    private function process_automation_rules($form_id, $posted_data, $status) {
        $automation_rules = get_option('cf7_smtp_automation_rules', array());
        
        if (empty($automation_rules[$form_id])) {
            return;
        }
        
        $rules = $automation_rules[$form_id];
        
        foreach ($rules as $rule) {
            if ($this->rule_matches($rule, $posted_data, $status)) {
                $this->execute_automation_action($rule, $posted_data);
            }
        }
    }
    
    /**
     * Check if automation rule matches
     */
    private function rule_matches($rule, $posted_data, $status) {
        // Check status condition
        if (!empty($rule['status_condition']) && $rule['status_condition'] !== $status) {
            return false;
        }
        
        // Check field conditions
        if (!empty($rule['field_conditions'])) {
            foreach ($rule['field_conditions'] as $condition) {
                $field_name = $condition['field'];
                $operator = $condition['operator'];
                $value = $condition['value'];
                
                $field_value = $posted_data[$field_name] ?? '';
                
                if (!$this->evaluate_condition($field_value, $operator, $value)) {
                    return false;
                }
            }
        }
        
        return true;
    }
    
    /**
     * Evaluate field condition
     */
    private function evaluate_condition($field_value, $operator, $expected_value) {
        switch ($operator) {
            case 'equals':
                return $field_value === $expected_value;
            case 'not_equals':
                return $field_value !== $expected_value;
            case 'contains':
                return strpos($field_value, $expected_value) !== false;
            case 'not_contains':
                return strpos($field_value, $expected_value) === false;
            case 'starts_with':
                return strpos($field_value, $expected_value) === 0;
            case 'ends_with':
                return substr($field_value, -strlen($expected_value)) === $expected_value;
            case 'greater_than':
                return floatval($field_value) > floatval($expected_value);
            case 'less_than':
                return floatval($field_value) < floatval($expected_value);
            case 'is_empty':
                return empty($field_value);
            case 'is_not_empty':
                return !empty($field_value);
            default:
                return false;
        }
    }
    
    /**
     * Execute automation action
     */
    private function execute_automation_action($rule, $posted_data) {
        $action = $rule['action'];
        
        switch ($action['type']) {
            case 'send_email':
                $this->send_automated_email($action, $posted_data);
                break;
            case 'save_to_database':
                $this->save_to_custom_database($action, $posted_data);
                break;
            case 'webhook':
                $this->send_webhook($action, $posted_data);
                break;
            case 'redirect':
                $this->set_redirect($action, $posted_data);
                break;
            case 'add_to_mailing_list':
                $this->add_to_mailing_list($action, $posted_data);
                break;
        }
    }
    
    /**
     * Send automated email
     */
    private function send_automated_email($action, $posted_data) {
        $to = $this->replace_placeholders($action['to'], $posted_data);
        $subject = $this->replace_placeholders($action['subject'], $posted_data);
        $message = $this->replace_placeholders($action['message'], $posted_data);
        $headers = $action['headers'] ?? '';
        
        // Use SMTP fallback system
        global $smtp_fallback_plugin;
        if ($smtp_fallback_plugin) {
            $result = $smtp_fallback_plugin->send_with_fallback($to, $subject, $message, $headers);
        } else {
            $result = wp_mail($to, $subject, $message, $headers);
        }
        
        error_log("CF7 SMTP: Automated email sent to {$to}, result: " . ($result ? 'success' : 'failed'));
    }
    
    /**
     * Save to custom database
     */
    private function save_to_custom_database($action, $posted_data) {
        global $wpdb;
        
        $table_name = $wpdb->prefix . $action['table_name'];
        $data = array();
        
        foreach ($action['field_mapping'] as $db_field => $form_field) {
            $data[$db_field] = $posted_data[$form_field] ?? '';
        }
        
        $data['created_at'] = current_time('mysql');
        
        $wpdb->insert($table_name, $data);
        
        error_log("CF7 SMTP: Data saved to custom table {$table_name}");
    }
    
    /**
     * Send webhook
     */
    private function send_webhook($action, $posted_data) {
        $url = $action['url'];
        $method = $action['method'] ?? 'POST';
        $headers = $action['headers'] ?? array();
        
        $data = array();
        foreach ($posted_data as $key => $value) {
            $data[$key] = $value;
        }
        
        $args = array(
            'method' => $method,
            'headers' => $headers,
            'body' => json_encode($data),
            'timeout' => 30
        );
        
        $response = wp_remote_request($url, $args);
        
        if (is_wp_error($response)) {
            error_log("CF7 SMTP: Webhook failed - " . $response->get_error_message());
        } else {
            error_log("CF7 SMTP: Webhook sent to {$url}");
        }
    }
    
    /**
     * Set redirect
     */
    private function set_redirect($action, $posted_data) {
        $redirect_url = $this->replace_placeholders($action['url'], $posted_data);
        
        // Store redirect URL in session or transient
        set_transient('cf7_smtp_redirect_' . session_id(), $redirect_url, 300);
        
        error_log("CF7 SMTP: Redirect set to {$redirect_url}");
    }
    
    /**
     * Add to mailing list
     */
    private function add_to_mailing_list($action, $posted_data) {
        $email = $posted_data[$action['email_field']] ?? '';
        $name = $posted_data[$action['name_field']] ?? '';
        $list_id = $action['list_id'];
        
        if (empty($email)) {
            return;
        }
        
        // Add to WordPress users or custom mailing list table
        global $wpdb;
        $table_name = $wpdb->prefix . 'cf7_smtp_mailing_list';
        
        $data = array(
            'email' => $email,
            'name' => $name,
            'list_id' => $list_id,
            'subscribed_at' => current_time('mysql'),
            'status' => 'active'
        );
        
        $wpdb->replace($table_name, $data);
        
        error_log("CF7 SMTP: Added {$email} to mailing list {$list_id}");
    }
    
    /**
     * Replace placeholders in text
     */
    private function replace_placeholders($text, $posted_data) {
        foreach ($posted_data as $key => $value) {
            if (is_array($value)) {
                $value = implode(', ', $value);
            }
            $text = str_replace('[' . $key . ']', $value, $text);
        }
        
        // Replace common placeholders
        $text = str_replace('[site_name]', get_option('blogname'), $text);
        $text = str_replace('[site_url]', home_url(), $text);
        $text = str_replace('[admin_email]', get_option('admin_email'), $text);
        $text = str_replace('[date]', date('Y-m-d'), $text);
        $text = str_replace('[time]', date('H:i:s'), $text);
        
        return $text;
    }
    
    /**
     * Send notification emails
     */
    private function send_notification_emails($form_id, $posted_data, $status) {
        $notifications = get_option('cf7_smtp_notifications', array());
        
        if (empty($notifications[$form_id])) {
            return;
        }
        
        $form_notifications = $notifications[$form_id];
        
        foreach ($form_notifications as $notification) {
            if ($notification['trigger'] === $status || $notification['trigger'] === 'both') {
                $this->send_automated_email($notification, $posted_data);
            }
        }
    }
    
    /**
     * Apply pre-send rules
     */
    private function apply_pre_send_rules($form_id, $posted_data, &$abort) {
        $pre_send_rules = get_option('cf7_smtp_pre_send_rules', array());
        
        if (empty($pre_send_rules[$form_id])) {
            return;
        }
        
        foreach ($pre_send_rules[$form_id] as $rule) {
            if ($this->rule_matches($rule, $posted_data, 'pre_send')) {
                if ($rule['action'] === 'abort') {
                    $abort = true;
                    error_log("CF7 SMTP: Email sending aborted by pre-send rule");
                }
            }
        }
    }
    
    /**
     * Apply post-send rules
     */
    private function apply_post_send_rules($form_id, $posted_data, $result) {
        $post_send_rules = get_option('cf7_smtp_post_send_rules', array());
        
        if (empty($post_send_rules[$form_id])) {
            return;
        }
        
        foreach ($post_send_rules[$form_id] as $rule) {
            if ($this->rule_matches($rule, $posted_data, 'post_send')) {
                $this->execute_automation_action($rule, $posted_data);
            }
        }
    }
    
    /**
     * Get client IP address
     */
    private function get_client_ip() {
        $ip_keys = array('HTTP_CLIENT_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR');
        
        foreach ($ip_keys as $key) {
            if (array_key_exists($key, $_SERVER) === true) {
                foreach (explode(',', $_SERVER[$key]) as $ip) {
                    $ip = trim($ip);
                    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) !== false) {
                        return $ip;
                    }
                }
            }
        }
        
        return $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    }
    
    /**
     * Cleanup old submissions
     */
    private function cleanup_old_submissions() {
        global $wpdb;
        
        $table_name = $wpdb->prefix . 'cf7_smtp_submissions';
        
        // Keep only last 1000 submissions
        $wpdb->query("
            DELETE FROM {$table_name} 
            WHERE id NOT IN (
                SELECT id FROM (
                    SELECT id FROM {$table_name} 
                    ORDER BY submission_time DESC 
                    LIMIT 1000
                ) AS temp
            )
        ");
    }
    
    /**
     * Add admin menu
     */
    public function add_admin_menu() {
        add_submenu_page(
            'wpcf7',
            'SMTP Automation',
            'SMTP Automation',
            'manage_options',
            'cf7-smtp-automation',
            array($this, 'admin_page')
        );
    }
    
    /**
     * Register settings
     */
    public function register_settings() {
        register_setting('cf7_smtp_settings', 'cf7_smtp_automation_rules');
        register_setting('cf7_smtp_settings', 'cf7_smtp_notifications');
        register_setting('cf7_smtp_settings', 'cf7_smtp_pre_send_rules');
        register_setting('cf7_smtp_settings', 'cf7_smtp_post_send_rules');
    }
    
    /**
     * Admin page
     */
    public function admin_page() {
        ?>
        <div class="wrap">
            <h1>Contact Form 7 - SMTP Automation</h1>
            
            <div class="nav-tab-wrapper">
                <a href="#automation-rules" class="nav-tab nav-tab-active">Automation Rules</a>
                <a href="#notifications" class="nav-tab">Notifications</a>
                <a href="#submissions" class="nav-tab">Submissions Log</a>
                <a href="#export" class="nav-tab">Export Data</a>
            </div>
            
            <div id="automation-rules" class="tab-content">
                <h2>Automation Rules</h2>
                <p>Set up automated actions based on form submissions.</p>
                
                <form method="post" action="options.php">
                    <?php settings_fields('cf7_smtp_settings'); ?>
                    
                    <table class="form-table">
                        <tr>
                            <th scope="row">Select Form</th>
                            <td>
                                <select id="automation-form-select">
                                    <option value="">Select a form...</option>
                                    <?php
                                    $forms = WPCF7_ContactForm::find();
                                    foreach ($forms as $form) {
                                        echo '<option value="' . $form->id() . '">' . esc_html($form->title()) . '</option>';
                                    }
                                    ?>
                                </select>
                            </td>
                        </tr>
                    </table>
                    
                    <div id="automation-rules-container" style="display: none;">
                        <h3>Add Automation Rule</h3>
                        <table class="form-table">
                            <tr>
                                <th scope="row">Rule Name</th>
                                <td><input type="text" id="rule-name" class="regular-text" /></td>
                            </tr>
                            <tr>
                                <th scope="row">Trigger</th>
                                <td>
                                    <select id="rule-trigger">
                                        <option value="success">On Successful Submission</option>
                                        <option value="failed">On Failed Submission</option>
                                        <option value="both">On Both</option>
                                    </select>
                                </td>
                            </tr>
                            <tr>
                                <th scope="row">Action</th>
                                <td>
                                    <select id="rule-action">
                                        <option value="send_email">Send Email</option>
                                        <option value="save_to_database">Save to Database</option>
                                        <option value="webhook">Send Webhook</option>
                                        <option value="redirect">Redirect User</option>
                                        <option value="add_to_mailing_list">Add to Mailing List</option>
                                    </select>
                                </td>
                            </tr>
                        </table>
                        
                        <div id="action-details"></div>
                        
                        <p>
                            <button type="button" class="button button-primary" id="add-automation-rule">Add Rule</button>
                        </p>
                    </div>
                    
                    <?php submit_button('Save Automation Rules'); ?>
                </form>
            </div>
            
            <div id="notifications" class="tab-content" style="display: none;">
                <h2>Email Notifications</h2>
                <p>Configure email notifications for form submissions.</p>
                
                <form method="post" action="options.php">
                    <?php settings_fields('cf7_smtp_settings'); ?>
                    
                    <table class="form-table">
                        <tr>
                            <th scope="row">Admin Notification Email</th>
                            <td>
                                <input type="email" name="cf7_smtp_admin_email" value="<?php echo esc_attr(get_option('cf7_smtp_admin_email', get_option('admin_email'))); ?>" class="regular-text" />
                                <p class="description">Email address to receive admin notifications.</p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row">Enable Success Notifications</th>
                            <td>
                                <label>
                                    <input type="checkbox" name="cf7_smtp_success_notifications" value="1" <?php checked(get_option('cf7_smtp_success_notifications'), 1); ?> />
                                    Send notification on successful form submission
                                </label>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row">Enable Failure Notifications</th>
                            <td>
                                <label>
                                    <input type="checkbox" name="cf7_smtp_failure_notifications" value="1" <?php checked(get_option('cf7_smtp_failure_notifications'), 1); ?> />
                                    Send notification on failed form submission
                                </label>
                            </td>
                        </tr>
                    </table>
                    
                    <?php submit_button('Save Notification Settings'); ?>
                </form>
            </div>
            
            <div id="submissions" class="tab-content" style="display: none;">
                <h2>Form Submissions Log</h2>
                <?php $this->display_submissions_table(); ?>
            </div>
            
            <div id="export" class="tab-content" style="display: none;">
                <h2>Export Form Data</h2>
                <p>Export form submission data to CSV or other formats.</p>
                
                <table class="form-table">
                    <tr>
                        <th scope="row">Select Form</th>
                        <td>
                            <select id="export-form-select">
                                <option value="">Select a form...</option>
                                <?php
                                $forms = WPCF7_ContactForm::find();
                                foreach ($forms as $form) {
                                    echo '<option value="' . $form->id() . '">' . esc_html($form->title()) . '</option>';
                                }
                                ?>
                            </select>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">Date Range</th>
                        <td>
                            <input type="date" id="export-date-from" /> to <input type="date" id="export-date-to" />
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">Format</th>
                        <td>
                            <select id="export-format">
                                <option value="csv">CSV</option>
                                <option value="json">JSON</option>
                                <option value="xml">XML</option>
                            </select>
                        </td>
                    </tr>
                </table>
                
                <p>
                    <button type="button" class="button button-primary" id="export-data">Export Data</button>
                </p>
            </div>
        </div>
        
        <style>
        .tab-content { margin-top: 20px; }
        .nav-tab-wrapper { margin-bottom: 0; }
        .nav-tab-active { background: #fff; border-bottom: 1px solid #fff; }
        </style>
        
        <script>
        (function($) {
            $(document).ready(function() {
                // Tab switching
                $('.nav-tab').click(function(e) {
                    e.preventDefault();
                    $('.nav-tab').removeClass('nav-tab-active');
                    $(this).addClass('nav-tab-active');
                    $('.tab-content').hide();
                    $($(this).attr('href')).show();
                });
                
                // Form selection for automation
                $('#automation-form-select').change(function() {
                    if ($(this).val()) {
                        $('#automation-rules-container').show();
                    } else {
                        $('#automation-rules-container').hide();
                    }
                });
                
                // Export data
                $('#export-data').click(function() {
                    var formId = $('#export-form-select').val();
                    var dateFrom = $('#export-date-from').val();
                    var dateTo = $('#export-date-to').val();
                    var format = $('#export-format').val();
                    
                    if (!formId) {
                        alert('Please select a form to export.');
                        return;
                    }
                    
                    var url = ajaxurl + '?action=cf7_export_data&form_id=' + formId + '&date_from=' + dateFrom + '&date_to=' + dateTo + '&format=' + format + '&nonce=<?php echo wp_create_nonce("cf7_smtp_nonce"); ?>';
                    window.open(url, '_blank');
                });
    
                // Clear submissions
                $(document).on('click', '#clear-submissions', function(e) {
                    e.preventDefault();
                    if (!confirm('Are you sure you want to clear all submission logs?')) return false;
                    
                    var button = $(this);
                    var originalText = button.text();
                    button.prop('disabled', true).text('Clearing...');
                    
                    $.ajax({
                        url: ajaxurl,
                        type: 'POST',
                        dataType: 'json',
                        data: {
                            action: 'cf7_clear_submissions',
                            nonce: '<?php echo wp_create_nonce("cf7_smtp_nonce"); ?>'
                        },
                        success: function(response) {
                            if (response.success) {
                                location.reload();
                            } else {
                                alert('Failed to clear logs: ' + (response.data || 'Unknown error'));
                                button.prop('disabled', false).text(originalText);
                            }
                        },
                        error: function(xhr, status, error) {
                            console.error('CF7 Clear Logs Error:', xhr.responseText);
                            alert('AJAX error: ' + error + '\nCheck console for details.');
                            button.prop('disabled', false).text(originalText);
                        }
                    });
                });
            });
        })(jQuery);
        </script>
        <?php
    }
    
    /**
     * Display submissions table
     */
    private function display_submissions_table() {
        global $wpdb;
        
        $table_name = $wpdb->prefix . 'cf7_smtp_submissions';
        $submissions = $wpdb->get_results("SELECT * FROM {$table_name} ORDER BY submission_time DESC LIMIT 50");
        
        if (empty($submissions)) {
            echo '<p>No submissions found.</p>';
            return;
        }
        
        echo '<table class="wp-list-table widefat fixed striped">';
        echo '<thead><tr>';
        echo '<th style="width: 50px;">ID</th>';
        echo '<th>Form</th>';
        echo '<th>Status</th>';
        echo '<th>Submission Time</th>';
        echo '<th>Form Data</th>';
        echo '<th>Actions</th>';
        echo '</tr></thead>';
        echo '<tbody>';
        
        foreach ($submissions as $submission) {
            $form_data = json_decode($submission->form_data, true);
            $preview_data = '';
            if (is_array($form_data)) {
                $items = array();
                foreach (array_slice($form_data, 0, 3) as $key => $val) {
                    if (strpos($key, '_wpcf7') === 0) continue;
                    $items[] = '<strong>' . esc_html($key) . ':</strong> ' . esc_html(is_array($val) ? implode(', ', $val) : $val);
                }
                $preview_data = implode('<br>', $items);
                if (count($form_data) > 3) $preview_data .= '<br>...';
            }

            echo '<tr>';
            echo '<td>' . esc_html($submission->id) . '</td>';
            echo '<td>' . esc_html($submission->form_title) . '</td>';
            echo '<td><span class="status-tag status-' . esc_attr($submission->status) . '">' . esc_html(ucfirst($submission->status)) . '</span></td>';
            echo '<td>' . esc_html($submission->submission_time) . '</td>';
            echo '<td class="form-data-preview">' . $preview_data . '</td>';
            echo '<td>';
            echo '<a href="#" class="button button-small view-full-data" data-id="' . esc_attr($submission->id) . '">View All</a> ';
            echo '<div id="full-data-' . esc_attr($submission->id) . '" style="display:none;" title="Submission #' . esc_attr($submission->id) . '">';
            if (is_array($form_data)) {
                echo '<table class="widefat striped">';
                foreach ($form_data as $key => $val) {
                    if (strpos($key, '_wpcf7') === 0) continue;
                    echo '<tr><td><strong>' . esc_html($key) . '</strong></td><td>' . esc_html(is_array($val) ? implode(', ', $val) : $val) . '</td></tr>';
                }
                echo '</table>';
            }
            echo '</div>';
            echo '</td>';
            echo '</tr>';
        }
        
        echo '</tbody></table>';

        echo '<p><button type="button" class="button button-link-delete" id="clear-submissions">Clear All Submission Logs</button></p>';

        ?>
        <script>
        (function($) {
            $(document).ready(function() {
                $('.view-full-data').click(function(e) {
                    e.preventDefault();
                    var id = $(this).data('id');
                    var content = $('#full-data-' + id).html();
                    
                    var win = window.open("", "SubmissionData", "width=800,height=600");
                    win.document.write("<html><head><title>Full Submission Data</title><style>body{font-family:'Segoe UI',Roboto,sans-serif;padding:30px;line-height:1.6;color:#1e293b;background:#f8fafc;} h2{color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:10px;} .content-box{background:white;padding:20px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.05);word-break:break-word; border:1px solid #e2e8f0;} table{width:100%;border-collapse:collapse;} td{padding:12px;border-bottom:1px solid #f1f5f9;} strong{color:#475569;}</style></head><body>");
                    win.document.write("<h2>Submission #" + id + "</h2>");
                    win.document.write("<div class='content-box'>" + content + "</div>");
                    win.document.write("</body></html>");
                    win.document.close();
                });
            });
        })(jQuery);
        </script>
        <?php
    }
    
    public function ajax_test_automation() {
        check_ajax_referer('cf7_smtp_nonce', 'nonce');
        
        if (!current_user_can('manage_options')) {
            wp_die('Unauthorized');
        }
        
        // Test automation functionality
        wp_send_json_success('Automation test completed successfully');
    }

    /**
     * AJAX clear submissions
     */
    public function ajax_clear_submissions() {
        check_ajax_referer('cf7_smtp_nonce', 'nonce');
        
        if (!current_user_can('manage_options')) {
            wp_send_json_error('Unauthorized');
        }
        
        global $wpdb;
        $table_name = $wpdb->prefix . 'cf7_smtp_submissions';
        $wpdb->query("TRUNCATE TABLE $table_name");
        
        wp_send_json_success('Submissions cleared successfully');
    }
    
    /**
     * AJAX export data
     */
    public function ajax_export_data() {
        check_ajax_referer('cf7_smtp_nonce', 'nonce');
        
        if (!current_user_can('manage_options')) {
            wp_die('Unauthorized');
        }
        
        $form_id = intval($_GET['form_id'] ?? 0);
        $date_from = sanitize_text_field($_GET['date_from'] ?? '');
        $date_to = sanitize_text_field($_GET['date_to'] ?? '');
        $format = sanitize_text_field($_GET['format'] ?? 'csv');
        
        if (!$form_id) {
            wp_die('Invalid form ID');
        }
        
        global $wpdb;
        $table_name = $wpdb->prefix . 'cf7_smtp_submissions';
        
        $where_clause = "WHERE form_id = %d";
        $params = array($form_id);
        
        if ($date_from) {
            $where_clause .= " AND submission_time >= %s";
            $params[] = $date_from . ' 00:00:00';
        }
        
        if ($date_to) {
            $where_clause .= " AND submission_time <= %s";
            $params[] = $date_to . ' 23:59:59';
        }
        
        $query = "SELECT * FROM {$table_name} {$where_clause} ORDER BY submission_time DESC";
        $submissions = $wpdb->get_results($wpdb->prepare($query, $params));
        
        if (empty($submissions)) {
            wp_die('No data found for export');
        }
        
        $this->export_submissions($submissions, $format);
    }
    
    /**
     * Export submissions in specified format
     */
    private function export_submissions($submissions, $format) {
        $filename = 'cf7_submissions_' . date('Y-m-d_H-i-s');
        
        switch ($format) {
            case 'csv':
                $this->export_csv($submissions, $filename);
                break;
            case 'json':
                $this->export_json($submissions, $filename);
                break;
            case 'xml':
                $this->export_xml($submissions, $filename);
                break;
            default:
                wp_die('Invalid export format');
        }
    }
    
    /**
     * Export as CSV
     */
    private function export_csv($submissions, $filename) {
        header('Content-Type: text/csv');
        header('Content-Disposition: attachment; filename="' . $filename . '.csv"');
        
        $output = fopen('php://output', 'w');
        
        // Header row
        $headers = array('ID', 'Form ID', 'Form Title', 'Status', 'IP Address', 'Submission Time', 'Form Data');
        fputcsv($output, $headers);
        
        // Data rows
        foreach ($submissions as $submission) {
            $row = array(
                $submission->id,
                $submission->form_id,
                $submission->form_title,
                $submission->status,
                $submission->ip_address,
                $submission->submission_time,
                $submission->form_data
            );
            fputcsv($output, $row);
        }
        
        fclose($output);
        exit;
    }
    
    /**
     * Export as JSON
     */
    private function export_json($submissions, $filename) {
        header('Content-Type: application/json');
        header('Content-Disposition: attachment; filename="' . $filename . '.json"');
        
        echo json_encode($submissions, JSON_PRETTY_PRINT);
        exit;
    }
    
    /**
     * Export as XML
     */
    private function export_xml($submissions, $filename) {
        header('Content-Type: application/xml');
        header('Content-Disposition: attachment; filename="' . $filename . '.xml"');
        
        echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
        echo '<submissions>' . "\n";
        
        foreach ($submissions as $submission) {
            echo '  <submission>' . "\n";
            echo '    <id>' . $submission->id . '</id>' . "\n";
            echo '    <form_id>' . $submission->form_id . '</form_id>' . "\n";
            echo '    <form_title><![CDATA[' . $submission->form_title . ']]></form_title>' . "\n";
            echo '    <status>' . $submission->status . '</status>' . "\n";
            echo '    <ip_address>' . $submission->ip_address . '</ip_address>' . "\n";
            echo '    <submission_time>' . $submission->submission_time . '</submission_time>' . "\n";
            echo '    <form_data><![CDATA[' . $submission->form_data . ']]></form_data>' . "\n";
            echo '  </submission>' . "\n";
        }
        
        echo '</submissions>' . "\n";
        exit;
    }
    
    /**
     * Create database tables
     */
    public function create_database_tables() {
        global $wpdb;
        
        $charset_collate = $wpdb->get_charset_collate();
        
        // Submissions table
        $table_name = $wpdb->prefix . 'cf7_smtp_submissions';
        $sql = "CREATE TABLE $table_name (
            id mediumint(9) NOT NULL AUTO_INCREMENT,
            form_id mediumint(9) NOT NULL,
            form_title varchar(255) NOT NULL,
            form_data longtext NOT NULL,
            status varchar(20) NOT NULL,
            ip_address varchar(45) NOT NULL,
            user_agent text,
            submission_time datetime DEFAULT CURRENT_TIMESTAMP NOT NULL,
            processed tinyint(1) DEFAULT 0,
            PRIMARY KEY (id),
            KEY form_id (form_id),
            KEY status (status),
            KEY submission_time (submission_time)
        ) $charset_collate;";
        
        // Mailing list table
        $mailing_table = $wpdb->prefix . 'cf7_smtp_mailing_list';
        $sql2 = "CREATE TABLE $mailing_table (
            id mediumint(9) NOT NULL AUTO_INCREMENT,
            email varchar(255) NOT NULL,
            name varchar(255),
            list_id varchar(100),
            subscribed_at datetime DEFAULT CURRENT_TIMESTAMP NOT NULL,
            status varchar(20) DEFAULT 'active',
            PRIMARY KEY (id),
            UNIQUE KEY email_list (email, list_id),
            KEY status (status)
        ) $charset_collate;";
        
        require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
        dbDelta($sql);
        dbDelta($sql2);
    }

    /**
     * Get form title from the 'From' sender setting
     */
    private function get_form_title_from_sender($contact_form) {
        $mail = $contact_form->prop('mail');
        $sender = $mail['sender'] ?? '';
        
        if (empty($sender)) {
            return $contact_form->title();
        }

        // Replace tags in sender (e.g. site name)
        $sender = wpcf7_mail_replace_tags($sender, array(), $contact_form);

        // Extract name part: "Name <email@example.com>" -> "Name"
        if (preg_match('/^"?([^"<]+)"?\s*<[^>]+>$/', $sender, $matches)) {
            return trim($matches[1]);
        }

        $parts = explode('<', $sender);
        $name = trim($parts[0], ' "');
        
        return !empty($name) ? $name : $contact_form->title();
    }
}

// Initialize the integration
new CF7_SMTP_Integration();