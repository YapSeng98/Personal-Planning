#!/bin/sh
# Build the PWA and publish it to the gh-pages branch.
set -e
cd "$(dirname "$0")/../frontend"
GH_PAGES=1 npm run build
cd dist
touch .nojekyll
git init -b gh-pages -q
git add -A
git -c user.name="YapSeng98" -c user.email="ycseng0398@gmail.com" commit -q -m "deploy $(date +%F-%H%M)"
git push -f https://github.com/YapSeng98/Personal-Planning.git gh-pages
rm -rf .git
echo "Published → https://yapseng98.github.io/Personal-Planning/"
