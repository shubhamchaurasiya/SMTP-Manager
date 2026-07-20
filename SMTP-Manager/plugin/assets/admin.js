(function ($) {
    'use strict';

    $(document).ready(function () {

        /* ------------------------------------------------------------------ */
        /* Tab switching                                                        */
        /* ------------------------------------------------------------------ */
        $('#smtpfb-tab-nav .smtpfb-tab-btn').on('click', function () {
            var tab = $(this).data('tab');
            $('#smtpfb-tab-nav .smtpfb-tab-btn').removeClass('active');
            $(this).addClass('active');
            $('.tab-content').removeClass('active');
            $('#' + tab).addClass('active');
            if (window.sessionStorage) {
                sessionStorage.setItem('smtpfb_tab', tab);
            }
        });

        // Restore last-active tab on page load
        if (window.sessionStorage) {
            var saved = sessionStorage.getItem('smtpfb_tab');
            if (saved) {
                $('[data-tab="' + saved + '"]').trigger('click');
            }
        }

        /* ------------------------------------------------------------------ */
        /* Password show / hide toggle                                          */
        /* ------------------------------------------------------------------ */
        $(document).on('click', '.smtpfb-pass-toggle', function () {
            var target = $(this).data('target');
            var input  = $('[name="smtp_fallback_options[' + target + ']"]');
            var type   = input.attr('type') === 'password' ? 'text' : 'password';
            input.attr('type', type);
            $(this).text(type === 'password' ? '👁' : '🙈');
        });

        /* ------------------------------------------------------------------ */
        /* Helper: result badge HTML                                            */
        /* ------------------------------------------------------------------ */
        function resultBadge(success, message) {
            var cls = success ? 'smtpfb-success' : 'smtpfb-error';
            var icon = success ? '&#10003;' : '&#10007;';
            return '<span class="' + cls + '">' + icon + ' ' + message + '</span>';
        }

        function loadingBadge(label) {
            return '<span><span class="smtpfb-spinner"></span> ' + label + '</span>';
        }

        /* ------------------------------------------------------------------ */
        /* Helper: read named field value from the form                        */
        /* ------------------------------------------------------------------ */
        function fieldVal(name) {
            return $('[name="smtp_fallback_options[' + name + ']"]').val() || '';
        }

        /* ------------------------------------------------------------------ */
        /* Test primary SMTP connection                                         */
        /* ------------------------------------------------------------------ */
        $('#test-primary-connection').on('click', function () {
            var btn = $(this);
            var res = $('#primary-connection-result');
            btn.prop('disabled', true);
            res.html(loadingBadge('Testing&hellip;'));

            $.post(smtpFallback.ajaxUrl, {
                action:      'smtp_test_connection',
                server_type: 'primary',
                host:        fieldVal('primary_host'),
                port:        fieldVal('primary_port'),
                username:    fieldVal('primary_username'),
                password:    fieldVal('primary_password'),
                encryption:  fieldVal('primary_encryption'),
                nonce:       smtpFallback.nonce
            })
            .done(function (r) {
                res.html(resultBadge(r.success, r.data));
            })
            .fail(function () {
                res.html(resultBadge(false, 'Request failed'));
            })
            .always(function () {
                btn.prop('disabled', false);
            });
        });

        /* ------------------------------------------------------------------ */
        /* Test fallback SMTP connection                                        */
        /* ------------------------------------------------------------------ */
        $('#test-fallback-connection').on('click', function () {
            var btn = $(this);
            var res = $('#fallback-connection-result');
            btn.prop('disabled', true);
            res.html(loadingBadge('Testing&hellip;'));

            $.post(smtpFallback.ajaxUrl, {
                action:      'smtp_test_connection',
                server_type: 'fallback',
                host:        fieldVal('fallback_host'),
                port:        fieldVal('fallback_port'),
                username:    fieldVal('fallback_username'),
                password:    fieldVal('fallback_password'),
                encryption:  fieldVal('fallback_encryption'),
                nonce:       smtpFallback.nonce
            })
            .done(function (r) {
                res.html(resultBadge(r.success, r.data));
            })
            .fail(function () {
                res.html(resultBadge(false, 'Request failed'));
            })
            .always(function () {
                btn.prop('disabled', false);
            });
        });

        /* ------------------------------------------------------------------ */
        /* Send test email                                                      */
        /* ------------------------------------------------------------------ */
        $('#send-test-email').on('click', function () {
            var btn   = $(this);
            var res   = $('#test-email-result');
            var email = $('#test-email-address').val();

            if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                res.html(resultBadge(false, 'Please enter a valid email address'));
                return;
            }

            btn.prop('disabled', true);
            res.html(loadingBadge('Sending&hellip;'));

            $.post(smtpFallback.ajaxUrl, {
                action:     'smtp_send_test_email',
                test_email: email,
                nonce:      smtpFallback.nonce
            })
            .done(function (r) {
                res.html(resultBadge(r.success, r.data));
            })
            .fail(function (xhr, status, err) {
                res.html(resultBadge(false, err || 'Request failed'));
            })
            .always(function () {
                btn.prop('disabled', false);
            });
        });

    });
})(jQuery);
