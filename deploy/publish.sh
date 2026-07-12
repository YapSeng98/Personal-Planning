#!/bin/sh
# Build the PWA and publish it to GitHub Pages.
# Pages serves the ROOT of main — index.html at root wins over README.md,
# so deploying = copying the fresh build to the repo root and pushing.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT/frontend"
GH_PAGES=1 npm run build

cd "$ROOT"
rm -rf assets            # drop old hashed bundles
cp -R frontend/dist/. .
touch .nojekyll          # tell Pages not to run Jekyll
git add -A
git commit -m "deploy site $(date +%F-%H%M)" || echo "nothing new to deploy"
git push origin main
echo "Published → https://yapseng98.github.io/Personal-Planning/ (allow ~1 min)"
