#!/bin/sh
# 官网上线：把 website/ 推到公开发布仓库的 gh-pages 分支，GitHub Pages 从那里发；
# Hetzner 的 Caddy（127.0.0.1:8825）把 pararead.us-cloud.uk 反代到 schaeferanjon.github.io/pararead/。
#   sh scripts/site-publish.sh
set -e
cd "$(dirname "$0")/.."
REPO=https://github.com/SchaeferAnjon/pararead.git
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
if git ls-remote --exit-code --heads "$REPO" gh-pages >/dev/null 2>&1; then
  git clone -q --depth 1 --branch gh-pages "$REPO" "$TMP/site"
else
  git init -q -b gh-pages "$TMP/site"
  git -C "$TMP/site" remote add origin "$REPO"
fi
rsync -a --delete --exclude .git website/ "$TMP/site/"
# 没有 Jekyll：文件原样发
touch "$TMP/site/.nojekyll"
cd "$TMP/site"
git add -A
if git diff --cached --quiet; then echo "官网没有变化"; exit 0; fi
git -c user.name="$(git -C "$OLDPWD" config user.name)" -c user.email="$(git -C "$OLDPWD" config user.email)" commit -q -m "site: $(git -C "$OLDPWD" log -1 --format=%h) 的官网"
git push -q origin gh-pages
echo "已推到 gh-pages，一两分钟后生效"
