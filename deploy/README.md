# Deploying to GitHub Pages

## Current method: main branch root
GitHub Pages is configured to serve the root of `main`. The built app
(index.html, assets/, sw.js, …) lives at the repo root; `index.html` takes
precedence over README.md, so visitors get the app while the repo page still
shows the README.

Deploy after any frontend change:

```bash
./deploy/publish.sh
```

It rebuilds with the /Personal-Planning/ base path, copies the build to the
repo root, commits, and pushes.

## Optional upgrade: auto-deploy on push
github-workflow-deploy.yml is a ready GitHub Actions workflow that builds on
every push instead. To use it, your Personal Access Token needs the "workflow"
scope (github.com → Settings → Developer settings → tokens). Then:

```bash
mv deploy/github-workflow-deploy.yml .github/workflows/deploy.yml
git add -A && git commit -m "enable Pages workflow" && git push
```

and switch Pages Source to "GitHub Actions" in repo Settings → Pages.
