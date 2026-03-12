#!/usr/bin/env bash
# First-run detection for pm plugin.
# Outputs advisory message if .pm/config.json is missing.

if [ -f ".pm/config.json" ]; then
  exit 0
fi

cat <<'EOF'
PM plugin is not configured for this project. Run /pm:setup to bootstrap
the knowledge base and configure integrations (Linear, Ahrefs/DataForSEO).
Skip this if you only need /pm:view (read-only over committed files).
EOF
