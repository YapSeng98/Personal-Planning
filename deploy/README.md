# Deploying to GitHub Pages

## Current method: gh-pages branch
Run ./deploy/publish.sh after any frontend change — it rebuilds and
force-pushes the built site to the gh-pages branch.
Pages settings: Source = "Deploy from a branch", branch = gh-pages, folder = / (root).

## Optional upgrade: auto-deploy on push
github-workflow-deploy.yml is a ready GitHub Actions workflow. To use it, your
Personal Access Token needs the "workflow" scope (github.com → Settings →
Developer settings → tokens). Then:
  mv deploy/github-workflow-deploy.yml .github/workflows/deploy.yml
  git add -A && git commit -m "enable Pages workflow" && git push
and switch Pages Source to "GitHub Actions".
