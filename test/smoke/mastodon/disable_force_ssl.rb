# Disable force_ssl for smoke tests so HTTP works without HTTPS proxy.
# Mastodon production mode enables force_ssl regardless of LOCAL_HTTPS.
Rails.application.config.force_ssl = false
