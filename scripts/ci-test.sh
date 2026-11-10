#!/bin/sh
# CI's build-and-test (0.10.2, RELEASING.md): what every push and pull request runs before anything is deployed.
# The workflows (.gitea/workflows) hand this a clean copy of the pushed commit inside a throwaway node container, with
# CPU and memory caps so a test run never starves production on the same host. Nothing here reaches a real server,
# Blizzard or Discord (tests use an in-memory database and fake outbound fetches).
#
#   sh scripts/ci-test.sh production|dev|any
#     production  the changelog must be production's (no dev builds left in): the main branch
#     dev         dev builds allowed: the dev branch
#     any         feature branches and pull requests (their target isn't known yet)
set -eu
target="${1:-any}"
case "$target" in
  production|dev) changelog_target="$target" ;;
  any) changelog_target="" ;;
  *) echo "ci-test.sh: target must be production, dev or any (got $target)" >&2; exit 2 ;;
esac

echo "== Node $(node --version), npm $(npm --version); target: $target"
echo "== Changelog"
CHANGELOG_TARGET="$changelog_target" node scripts/check-changelog.js
echo "== Install"
npm ci --no-audit --no-fund
echo "== Tests"
npm test
echo "== Build"
CHANGELOG_TARGET="$changelog_target" npm run build
echo "== Build and tests passed"
