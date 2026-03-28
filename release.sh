# used to release a new version locally using
# //registry.npmjs.org/:_authToken=${NPM_TOKEN} in .npmrc
# where NPM_TOKEN is a secret environment variable
# ask for NPM_TOKEN from project owner if not set
#
# I don't want to dabble with Action Runners for this small yet powerful library

if [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]; then
  echo "Error: Must be on main branch to release"
  exit 1
fi
git add .
git commit -m "feat(.changeset/) versioned files  "
git push origin main
pnpm build
pnpm run release
pnpm run clean
