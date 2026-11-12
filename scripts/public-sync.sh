#!/bin/sh
# 把代码同步到公开仓库 SchaeferAnjon/pararead 的 main 分支（GPL-3.0 开源）。
# 开发在私有仓库里做；公开的是一份不带历史的快照，每次同步一个提交。不公开的：
#   docs/、design/、DESIGN.md（内部的交接、交付页、设计稿和界面规范）；
#   tests/fixtures/simpler-*.md（一篇有版权的论文的全文，用到它的用例在公开仓库里跳过）。
# 推之前检查导出的文件里没有本机路径、dispatch env 里存着的任何密钥值。
#   sh scripts/public-sync.sh            只导出和检查，不推
#   sh scripts/public-sync.sh --push     检查过了再推
set -e
cd "$(dirname "$0")/.."
ROOT=$(pwd)
REPO=https://github.com/SchaeferAnjon/pararead.git
[ -z "$(git status --porcelain)" ] || { echo "工作区有没提交的改动，先提交"; exit 1; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
git clone -q --depth 1 --branch main "$REPO" "$TMP/pub"
# 公开仓库里的文件整个换成这次的快照（.git 留着）
find "$TMP/pub" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
git ls-files -z -- . ':!docs' ':!design' ':!DESIGN.md' ':!tests/fixtures/simpler-*.md' | rsync -a --from0 --files-from=- ./ "$TMP/pub/"
cd "$TMP/pub"
# 检查 1：本机路径和个人文件夹
# （这个脚本自己写着检查的规则，不算）
HITS=$(grep -rIl -E "/Users/[a-z]+/|com~apple~CloudDocs/[^'\" ]" --exclude-dir=.git --exclude=public-sync.sh . || true)
if [ -n "$HITS" ]; then echo "导出的文件里有本机路径："; echo "$HITS" | head; exit 1; fi
# 检查 2：dispatch env 里的每个值都不在导出的文件里（只报名字）
for name in $(dispatch env list 2>/dev/null | awk '$1 ~ /^[A-Z][A-Z0-9_]+$/ {print $1}' | sort -u); do
  v=$(dispatch env get "$name" 2>/dev/null)
  [ ${#v} -lt 8 ] && continue
  if grep -rIlF --exclude-dir=.git -- "$v" . | grep -q .; then echo "导出的文件里有密钥 $name 的值，没推"; exit 1; fi
done
git add -A
if git diff --cached --quiet; then echo "公开仓库已经是最新的"; exit 0; fi
echo "要公开的改动：$(git diff --cached --shortstat)"
[ "$1" = "--push" ] || { echo "检查通过，没推（加 --push 才推）"; exit 0; }
git -c user.name="$(git -C "$ROOT" config user.name)" -c user.email="$(git -C "$ROOT" config user.email)" commit -q -m "sync: 同步到 $(git -C "$ROOT" log -1 --format=%h)（$(node -p "require('$ROOT/package.json').version")）"
git push -q origin main
echo "已推到公开仓库 main"
