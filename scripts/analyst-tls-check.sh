#!/usr/bin/env bash
# Quick check: can Node verify TLS to Google (needed for NextAuth Google sign-in)?
set -euo pipefail
echo "=== Analyst Agent / Google OAuth TLS check ==="
check() {
  node -e "
const https = require('https');
https.get('https://accounts.google.com', (r) => {
  console.log('  Working — HTTP', r.statusCode);
  process.exit(0);
}).on('error', (e) => {
  console.log('  Not working —', e.message);
  process.exit(1);
});
" && return 0 || return 1
}

echo "1) Default Node TLS (no env):"
if check; then echo "  Status: OK"; else echo "  Status: FAIL (typical behind SSL inspection)"; fi

echo "2) With NODE_TLS_REJECT_UNAUTHORIZED=0 (same net effect as NEXTAUTH_INSECURE_TLS=true in the app):"
if NODE_TLS_REJECT_UNAUTHORIZED=0 check 2>/dev/null; then echo "  Status: OK"; else echo "  Status: FAIL"; fi

echo ""
echo "Fix: NODE_EXTRA_CA_CERTS=/path/to/org-ca.pem  OR  dev-only: NEXTAUTH_INSECURE_TLS=true in repo .env (restart dev:analyst)."
