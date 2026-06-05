(function ($) {
    'use strict';

    $(document).ready(function () {
        // Initialize the admin interface
        SMTPFallbackAdmin.init($);
    });

    var SMTPFallbackAdmin = {

        /**
         * Initialize admin functionality
         */
        init: function ($) {
            this.$ = $;
            this.bindEvents();
            this.initializeTooltips();
            this.checkConnectionStatus();
        },

        /**
         * Bind event handlers
         */
        bindEvents: function () {
            var self = this;
            var $ = this.$;

            // Test connection buttons
            $(document).on('click', '#test-primary-connection', function (e) {
                e.preventDefault();
                self.testConnection('primary', $(this));
            });

            $(document).on('click', '#test-fallback-connection', function (e) {
                e.preventDefault();
                self.testConnection('fallback', $(this));
            });

            // Send test email button
            $(document).on('click', '#send-test-email', function (e) {
                e.preventDefault();
                self.sendTestEmail($(this));
            });

            // Form validation
            $(document).on('submit', '#smtp-fallback-form', function (e) {
                if (!self.validateForm()) {
                    e.preventDefault();
                    return false;
                }
            });

            // Real-time validation
            $(document).on('blur', 'input[type="email"]', function () {
                self.validateEmail($(this));
            });

            $(document).on('blur', 'input[name*="host"]', function () {
                self.validateHost($(this));
            });

            $(document).on('blur', 'input[name*="port"]', function () {
                self.validatePort($(this));
            });

            // Auto-save functionality
            $(document).on('change', 'input, select', function () {
                self.scheduleAutoSave();
            });

            // Configuration wizard
            $(document).on('click', '.config-wizard-next', function () {
                self.nextWizardStep();
            });

            $(document).on('click', '.config-wizard-prev', function () {
                self.prevWizardStep();
            });

            // Import/Export functionality
            $(document).on('click', '#export-settings', function () {
                self.exportSettings();
            });

            $(document).on('click', '#import-settings', function () {
                self.importSettings();
            });

            // Advanced options toggle
            $(document).on('click', '.toggle-advanced-options', function () {
                self.toggleAdvancedOptions();
            });
        },

        /**
         * Test SMTP connection
         */
        testConnection: function (serverType, button) {
            var self = this;
            var $ = this.$;
            var resultElement = $('#' + serverType + '-connection-result');

            // Disable button and show loading
            button.prop('disabled', true);
            resultElement.html('<span class="loading"><span class="loading-spinner"></span>Testing connection...</span>');

            // Get form data
            var formData = this.getFormData();

            // Make AJAX request
            $.ajax({
                url: ajaxurl,
                type: 'POST',
                data: {
                    action: 'smtp_test_connection',
                    server_type: serverType,
                    nonce: smtpFallback.nonce,
                    settings: formData
                },
                success: function (response) {
                    button.prop('disabled', false);

                    if (response.success) {
                        resultElement.html('<span class="success">✓ Connection successful</span>');
                        self.showNotification('Connection test successful for ' + serverType + ' server', 'success');
                    } else {
                        resultElement.html('<span class="error">✗ Connection failed: ' + response.data + '</span>');
                        self.showNotification('Connection test failed for ' + serverType + ' server: ' + response.data, 'error');
                    }
                },
                error: function (xhr, status, error) {
                    button.prop('disabled', false);
                    resultElement.html('<span class="error">✗ Connection test failed</span>');
                    self.showNotification('Connection test failed: ' + error, 'error');
                }
            });
        },

        /**
         * Send test email
         */
        sendTestEmail: function (button) {
            var self = this;
            var email = $('#test-email-address').val();
            var resultElement = $('#test-email-result');

            // Validate email
            if (!email || !this.isValidEmail(email)) {
                resultElement.html('<span class="error">Please enter a valid email address</span>');
                return;
            }

            // Disable button and show loading
            button.prop('disabled', true);
            resultElement.html('<span class="loading"><span class="loading-spinner"></span>Sending test email...</span>');

            // Make AJAX request
            $.ajax({
                url: ajaxurl,
                type: 'POST',
                data: {
                    action: 'smtp_send_test_email',
                    test_email: email,
                    nonce: smtpFallback.nonce
                },
                success: function (response) {
                    button.prop('disabled', false);

                    if (response.success) {
                        resultElement.html('<span class="success">✓ Test email sent successfully</span>');
                        self.showNotification('Test email sent successfully to ' + email, 'success');
                    } else {
                        resultElement.html('<span class="error">✗ Test email failed: ' + response.data + '</span>');
                        self.showNotification('Test email failed: ' + response.data, 'error');
                    }
                },
                error: function (xhr, status, error) {
                    button.prop('disabled', false);
                    resultElement.html('<span class="error">✗ Test email failed</span>');
                    self.showNotification('Test email failed: ' + error, 'error');
                }
            });
        },

        /**
         * Validate form before submission
         */
        validateForm: function () {
            var isValid = true;
            var errors = [];

            // Validate primary SMTP settings
            var primaryHost = $('input[name="smtp_fallback_options[primary_host]"]').val();
            var primaryUsername = $('input[name="smtp_fallback_options[primary_username]"]').val();
            var primaryPassword = $('input[name="smtp_fallback_options[primary_password]"]').val();

            if (!primaryHost) {
                errors.push('Primary SMTP host is required');
                isValid = false;
            }

            if (!primaryUsername) {
                errors.push('Primary SMTP username is required');
                isValid = false;
            }

            if (!primaryPassword) {
                errors.push('Primary SMTP password is required');
                isValid = false;
            }

            // Validate email addresses
            var fromEmail = $('input[name="smtp_fallback_options[from_email]"]').val();
            if (fromEmail && !this.isValidEmail(fromEmail)) {
                errors.push('From email address is not valid');
                isValid = false;
            }

            var testEmail = $('input[name="smtp_fallback_options[test_email]"]').val();
            if (testEmail && !this.isValidEmail(testEmail)) {
                errors.push('Test email address is not valid');
                isValid = false;
            }

            // Show errors if any
            if (!isValid) {
                this.showNotification('Please fix the following errors:\n• ' + errors.join('\n• '), 'error');
            }

            return isValid;
        },

        /**
         * Validate email address
         */
        validateEmail: function (input) {
            var email = input.val();
            var isValid = this.isValidEmail(email);

            if (email && !isValid) {
                input.addClass('error');
                this.showFieldError(input, 'Please enter a valid email address');
            } else {
                input.removeClass('error');
                this.hideFieldError(input);
            }

            return isValid;
        },

        /**
         * Validate host
         */
        validateHost: function (input) {
            var host = input.val();
            var isValid = host && host.length > 0;

            if (!isValid) {
                input.addClass('error');
                this.showFieldError(input, 'Host is required');
            } else {
                input.removeClass('error');
                this.hideFieldError(input);
            }

            return isValid;
        },

        /**
         * Validate port
         */
        validatePort: function (input) {
            var port = parseInt(input.val());
            var isValid = port >= 1 && port <= 65535;

            if (!isValid) {
                input.addClass('error');
                this.showFieldError(input, 'Port must be between 1 and 65535');
            } else {
                input.removeClass('error');
                this.hideFieldError(input);
            }

            return isValid;
        },

        /**
         * Check if email is valid
         */
        isValidEmail: function (email) {
            var regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            return regex.test(email);
        },

        /**
         * Show field error
         */
        showFieldError: function (input, message) {
            var errorElement = input.siblings('.field-error');
            if (errorElement.length === 0) {
                errorElement = $('<div class="field-error"></div>');
                input.after(errorElement);
            }
            errorElement.text(message).show();
        },

        /**
         * Hide field error
         */
        hideFieldError: function (input) {
            input.siblings('.field-error').hide();
        },

        /**
         * Show notification
         */
        showNotification: function (message, type) {
            var notification = $('<div class="smtp-notification ' + type + '">' + message + '</div>');
            $('.wrap h1').after(notification);

            // Auto-hide after 5 seconds
            setTimeout(function () {
                notification.fadeOut(function () {
                    notification.remove();
                });
            }, 5000);
        },

        /**
         * Get form data
         */
        getFormData: function () {
            var formData = {};
            $('#smtp-fallback-form').find('input, select, textarea').each(function () {
                var name = $(this).attr('name');
                var value = $(this).val();
                if (name) {
                    formData[name] = value;
                }
            });
            return formData;
        },

        /**
         * Initialize tooltips
         */
        initializeTooltips: function () {
            // Add tooltips to help icons
            $('.help-icon').each(function () {
                var tooltip = $(this).attr('data-tooltip');
                if (tooltip) {
                    $(this).attr('title', tooltip);
                }
            });
        },

        /**
         * Check connection status on page load
         */
        checkConnectionStatus: function () {
            // Visual indicators for connection status
            this.updateConnectionIndicators();
        },

        /**
         * Update connection indicators
         */
        updateConnectionIndicators: function () {
            var self = this;

            // Check if required fields are filled
            var primaryComplete = this.isPrimaryConfigComplete();
            var fallbackComplete = this.isFallbackConfigComplete();

            // Update indicators
            if (primaryComplete) {
                $('.primary-status-indicator').removeClass('error').addClass('success');
            } else {
                $('.primary-status-indicator').removeClass('success').addClass('error');
            }

            if (fallbackComplete) {
                $('.fallback-status-indicator').removeClass('error').addClass('success');
            } else {
                $('.fallback-status-indicator').removeClass('success').addClass('warning');
            }
        },

        /**
         * Check if primary config is complete
         */
        isPrimaryConfigComplete: function () {
            var host = $('input[name="smtp_fallback_options[primary_host]"]').val();
            var username = $('input[name="smtp_fallback_options[primary_username]"]').val();
            var password = $('input[name="smtp_fallback_options[primary_password]"]').val();

            return host && username && password;
        },

        /**
         * Check if fallback config is complete
         */
        isFallbackConfigComplete: function () {
            var host = $('input[name="smtp_fallback_options[fallback_host]"]').val();
            var username = $('input[name="smtp_fallback_options[fallback_username]"]').val();
            var password = $('input[name="smtp_fallback_options[fallback_password]"]').val();

            return host && username && password;
        },

        /**
         * Schedule auto-save
         */
        scheduleAutoSave: function () {
            var self = this;

            // Clear existing timeout
            if (this.autoSaveTimeout) {
                clearTimeout(this.autoSaveTimeout);
            }

            // Schedule new auto-save
            this.autoSaveTimeout = setTimeout(function () {
                self.autoSave();
            }, 2000);
        },

        /**
         * Auto-save settings
         */
        autoSave: function () {
            var formData = this.getFormData();

            $.ajax({
                url: ajaxurl,
                type: 'POST',
                data: {
                    action: 'smtp_auto_save',
                    settings: formData,
                    nonce: smtpFallback.nonce
                },
                success: function (response) {
                    if (response.success) {
                        $('.auto-save-indicator').text('Settings auto-saved').fadeIn().delay(2000).fadeOut();
                    }
                }
            });
        },

        /**
         * Export settings
         */
        exportSettings: function () {
            var settings = this.getFormData();
            var dataStr = JSON.stringify(settings, null, 2);
            var dataBlob = new Blob([dataStr], { type: 'application/json' });

            var link = document.createElement('a');
            link.href = URL.createObjectURL(dataBlob);
            link.download = 'smtp-fallback-settings.json';
            link.click();

            this.showNotification('Settings exported successfully', 'success');
        },

        /**
         * Import settings
         */
        importSettings: function () {
            var self = this;
            var input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';

            input.onchange = function (e) {
                var file = e.target.files[0];
                if (!file) return;

                var reader = new FileReader();
                reader.onload = function (e) {
                    try {
                        var settings = JSON.parse(e.target.result);
                        self.applyImportedSettings(settings);
                        self.showNotification('Settings imported successfully', 'success');
                    } catch (error) {
                        self.showNotification('Failed to import settings: Invalid file format', 'error');
                    }
                };
                reader.readAsText(file);
            };

            input.click();
        },

        /**
         * Apply imported settings
         */
        applyImportedSettings: function (settings) {
            for (var name in settings) {
                var input = $('input[name="' + name + '"], select[name="' + name + '"]');
                if (input.length > 0) {
                    if (input.attr('type') === 'checkbox') {
                        input.prop('checked', settings[name] == 1);
                    } else {
                        input.val(settings[name]);
                    }
                }
            }

            // Update connection indicators
            this.updateConnectionIndicators();
        },

        /**
         * Toggle advanced options
         */
        toggleAdvancedOptions: function () {
            var advancedSection = $('.advanced-options');
            var toggleButton = $('.toggle-advanced-options');

            if (advancedSection.is(':visible')) {
                advancedSection.slideUp();
                toggleButton.text('Show Advanced Options');
            } else {
                advancedSection.slideDown();
                toggleButton.text('Hide Advanced Options');
            }
        },

        /**
         * Configuration wizard functionality
         */
        nextWizardStep: function () {
            var currentStep = $('.config-wizard-step.active');
            var nextStep = currentStep.next('.config-wizard-step');

            if (nextStep.length > 0) {
                currentStep.removeClass('active').addClass('completed');
                nextStep.addClass('active');
                this.updateWizardContent();
            }
        },

        /**
         * Previous wizard step
         */
        prevWizardStep: function () {
            var currentStep = $('.config-wizard-step.active');
            var prevStep = currentStep.prev('.config-wizard-step');

            if (prevStep.length > 0) {
                currentStep.removeClass('active');
                prevStep.removeClass('completed').addClass('active');
                this.updateWizardContent();
            }
        },

        /**
         * Update wizard content
         */
        updateWizardContent: function () {
            var activeStep = $('.config-wizard-step.active');
            var stepIndex = activeStep.index();

            $('.wizard-content').hide();
            $('.wizard-content').eq(stepIndex).show();
        }
    };

    // Utility functions
    window.SMTPFallbackUtils = {

        /**
         * Format bytes to human readable format
         */
        formatBytes: function (bytes, decimals = 2) {
            if (bytes === 0) return '0 Bytes';

            const k = 1024;
            const dm = decimals < 0 ? 0 : decimals;
            const sizes = ['Bytes', 'KB', 'MB', 'GB'];

            const i = Math.floor(Math.log(bytes) / Math.log(k));

            return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
        },

        /**
         * Debounce function
         */
        debounce: function (func, wait, immediate) {
            var timeout;
            return function () {
                var context = this, args = arguments;
                var later = function () {
                    timeout = null;
                    if (!immediate) func.apply(context, args);
                };
                var callNow = immediate && !timeout;
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
                if (callNow) func.apply(context, args);
            };
        },

        /**
         * Copy text to clipboard
         */
        copyToClipboard: function (text) {
            var textArea = document.createElement('textarea');
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
        }
    };
})(jQuery);