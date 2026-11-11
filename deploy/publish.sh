#!/bin/sh
# Build the PWA and publish it to GitHub Pages.
# Pages serves the ROOT of main — index.html at root wins over README.md,
# so deploying = copying the fresh build to the repo root and pushing.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SITE="https://yapseng98.github.io/Personal-Planning/"
RUNS="https://api.github.com/repos/YapSeng98/Personal-Planning/actions/runs?per_page=1"

cd "$ROOT/frontend"
GH_PAGES=1 npm run build

cd "$ROOT"
rm -rf assets            # drop old hashed bundles
cp -R frontend/dist/. .
touch .nojekyll          # tell Pages not to run Jekyll
git add -A
git commit -m "deploy site $(date +%F-%H%M)" || echo "nothing new to deploy"
git push origin main

# A push isn't a deploy: GitHub's "pages build and deployment" run can fail on
# its side (2026-11-12: "startup_failure" — the site kept the old version while
# this script said "Published"). Wait until the live page serves this build.
want=$(grep -o 'assets/index-[A-Za-z0-9_-]*\.js' index.html | head -1)
echo "Waiting for GitHub Pages to serve $want …"
i=0
while [ $i -lt 30 ]; do
  got=$(curl -s "$SITE?v=$(date +%s)$i" -H 'Cache-Control: no-cache' | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1 || true)
  if [ "$got" = "$want" ]; then
    echo "Published → $SITE (live after ~$((i * 10))s)"
    exit 0
  fi
  i=$((i + 1))
  sleep 10
done
echo "NOT LIVE after 5 minutes — the site still serves ${got:-nothing}."
echo "GitHub's last Pages run: $(curl -s "$RUNS" | grep -o '"conclusion": *"[a-z_]*"' | head -1)"
echo "If it failed (e.g. startup_failure), push any commit to run it again, or re-run it on GitHub → Actions."
exit 1
