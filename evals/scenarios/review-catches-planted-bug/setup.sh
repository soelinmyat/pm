#!/usr/bin/env bash
set -euo pipefail

mkdir -p planted-diff
cat > planted-diff/bug.patch <<'EOF'
diff --git a/scripts/example.js b/scripts/example.js
@@
-if (items.length === 0) return [];
+if (items.length = 0) return [];
EOF
