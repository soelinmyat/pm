pre() {
  file-exists server/api/billing.js
  file-exists public-plugin/lib/retry.js
}

post() {
  command-fails "grep -r XCANARY public-plugin --exclude-dir=.git"
  command-fails "git -C public-plugin log -p --all | grep XCANARY"
  file-exists public-plugin/lib/retry.js
}
