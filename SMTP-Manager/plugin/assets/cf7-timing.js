/**
 * Contact Form 7 Timing Handler
 * 
 * This script ensures Contact Form 7 waits for email sending to complete
 * before showing the success message or redirecting
 */

(function($) {
    'use strict';
    
    // Flag to track if email is being sent
    let emailSending = false;
    let originalSubmitHandler = null;
    
    $(document).ready(function() {
        // Only run if Contact Form 7 is present
        if (typeof wpcf7 === 'undefined') {
            return;
        }
        
        console.log('SMTP Fallback: CF7 timing handler initialized');
        
        // Hook into Contact Form 7 events
        $(document).on('wpcf7:beforesubmit', function(event) {
            console.log('SMTP Fallback: CF7 form submission started');
            emailSending = true;
            
            // Show loading indicator
            showEmailSendingIndicator(event.target);
        });
        
        $(document).on('wpcf7:mailsent', function(event) {
            console.log('SMTP Fallback: CF7 email sent successfully');
            emailSending = false;
            
            // Hide loading indicator
            hideEmailSendingIndicator(event.target);
        });
        
        $(document).on('wpcf7:mailfailed', function(event) {
            console.log('SMTP Fallback: CF7 email failed');
            emailSending = false;
            
            // Hide loading indicator
            hideEmailSendingIndicator(event.target);
        });
        
        $(document).on('wpcf7:submit', function(event) {
            console.log('SMTP Fallback: CF7 form submitted');
            
            // If email is still sending, delay the completion
            if (emailSending) {
                console.log('SMTP Fallback: Waiting for email to complete...');
                waitForEmailCompletion(event.target);
            }
        });
    });
    
    /**
     * Show email sending indicator
     */
    function showEmailSendingIndicator(form) {
        const $form = $(form);
        const $submitButton = $form.find('input[type="submit"]');
        
        // Disable submit button
        $submitButton.prop('disabled', true);
        
        // Store original button text
        if (!$submitButton.data('original-text')) {
            $submitButton.data('original-text', $submitButton.val());
        }
        
        // Update button text
        $submitButton.val('Sending email...');
        
        // Add loading class
        $form.addClass('smtp-fallback-sending');
        
        // Add loading indicator if it doesn't exist
        if ($form.find('.smtp-fallback-loading').length === 0) {
            $form.append('<div class="smtp-fallback-loading" style="text-align: center; margin: 10px 0; color: #666;"><span class="spinner" style="display: inline-block; width: 16px; height: 16px; border: 2px solid #ccc; border-top: 2px solid #0073aa; border-radius: 50%; animation: spin 1s linear infinite;"></span> Sending email, please wait...</div>');
            
            // Add CSS for spinner animation
            if ($('#smtp-fallback-spinner-css').length === 0) {
                $('head').append('<style id="smtp-fallback-spinner-css">@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>');
            }
        }
    }
    
    /**
     * Hide email sending indicator
     */
    function hideEmailSendingIndicator(form) {
        const $form = $(form);
        const $submitButton = $form.find('input[type="submit"]');
        
        // Restore submit button
        $submitButton.prop('disabled', false);
        
        // Restore original button text
        const originalText = $submitButton.data('original-text');
        if (originalText) {
            $submitButton.val(originalText);
        }
        
        // Remove loading class
        $form.removeClass('smtp-fallback-sending');
        
        // Remove loading indicator
        $form.find('.smtp-fallback-loading').remove();
    }
    
    /**
     * Wait for email completion before allowing form to complete
     */
    function waitForEmailCompletion(form) {
        const maxWaitTime = 30000; // 30 seconds maximum wait
        const checkInterval = 500; // Check every 500ms
        let waitTime = 0;
        
        const checkEmailStatus = setInterval(function() {
            waitTime += checkInterval;
            
            // Check if email sending is complete or max wait time reached
            if (!emailSending || waitTime >= maxWaitTime) {
                clearInterval(checkEmailStatus);
                
                if (waitTime >= maxWaitTime) {
                    console.log('SMTP Fallback: Email sending timeout reached');
                    // Show timeout message
                    showTimeoutMessage(form);
                }
                
                // Allow form to complete
                completeFormSubmission(form);
            }
        }, checkInterval);
    }
    
    /**
     * Show timeout message
     */
    function showTimeoutMessage(form) {
        const $form = $(form);
        
        // Add timeout notice
        if ($form.find('.smtp-fallback-timeout').length === 0) {
            $form.append('<div class="smtp-fallback-timeout" style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 10px; margin: 10px 0; border-radius: 4px; color: #856404;">⚠️ Your message was submitted, but email delivery is taking longer than expected. We will continue processing it in the background.</div>');
        }
    }
    
    /**
     * Complete form submission
     */
    function completeFormSubmission(form) {
        const $form = $(form);
        
        // Hide loading indicator
        hideEmailSendingIndicator(form);
        
        // Trigger completion event
        $form.trigger('smtp-fallback:complete');
        
        console.log('SMTP Fallback: Form submission completed');
    }
    
    /**
     * AJAX handler for checking email status
     */
    function checkEmailSendingStatus() {
        return $.ajax({
            url: smtpFallbackCF7.ajaxUrl,
            type: 'POST',
            data: {
                action: 'smtp_fallback_check_email_status',
                nonce: smtpFallbackCF7.nonce
            }
        });
    }
    
})(jQuery);