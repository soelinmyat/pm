#!/usr/bin/env bash
set -euo pipefail

mkdir -p planted-diff
cat > planted-diff/bug.patch <<'EOF'
diff --git a/scripts/example.js b/scripts/example.js
@@
-if (items.length === 0) return [];
+if (items.length = 0) return [];
EOF

# pm:review reviews a branch-vs-main diff, so give the workdir a real repo: the
# clean implementation on main, and the planted bug applied as a commit on a
# feature branch left checked out. planted-diff/bug.patch documents the intended
# defect; its loose `@@` header can't feed `git apply`, so we reproduce its exact
# effect (=== -> =) below. Owning the repo also stops the engine from walking up
# into whatever repo encloses the staging area.
mkdir -p scripts
cat > scripts/example.js <<'EOF'
function firstOrEmpty(items) {
  if (items.length === 0) return [];
  return items[0];
}

module.exports = { firstOrEmpty };
EOF

git init -q -b main .
git config user.email "pm-eval@example.com"
git config user.name "PM Eval"
# bug.patch names the defect — keep it on disk for the pre() file-exists check,
# but never commit the answer key into the repo under review.
printf 'planted-diff/\n' > .gitignore
git add -A
git commit -qm "Seed clean implementation"
git init -q --bare --initial-branch=main ../origin.git
git -C ../origin.git symbolic-ref HEAD refs/heads/main
git remote add origin ../origin.git
git push -qu origin main

git checkout -q -b feat/under-review
sed 's/items\.length === 0/items.length = 0/' scripts/example.js > scripts/example.js.tmp
mv scripts/example.js.tmp scripts/example.js
git add scripts/example.js
git commit -qm "Apply change under review"
