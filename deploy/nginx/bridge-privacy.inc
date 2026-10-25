# Include in EVERY wxmr.io/www/onion server that serves the bridge, including
# HTTP redirect servers. Remove other access_log/error_log directives in these
# contexts and their child locations; multiple error_log directives can coexist.
# Keep swap configuration separate. Test with nginx -t before reloading.
# Error messages can contain client addresses and full request URLs, so raising
# their severity alone is insufficient to meet the no-address logging rule.
access_log off;
error_log /dev/null crit;
