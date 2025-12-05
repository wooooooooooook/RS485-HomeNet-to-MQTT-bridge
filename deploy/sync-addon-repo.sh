#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd -- "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ENV_FILE="$ROOT_DIR/deploy/docker/.env"
TARGET_REPO=${TARGET_REPO:-"wooooooooooook/HAaddons"}
TARGET_BRANCH=${TARGET_BRANCH:-"main"}

log() {
  printf '\n[sync-addon] %s\n' "$1"
}

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  log ".env 파일($ENV_FILE)을 찾을 수 없습니다. 필요한 환경 변수를 직접 내보내세요."
fi

: "${ADDONS_REPO_TOKEN:?ADDONS_REPO_TOKEN가 필요합니다}"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
TARGET_DIR="$TMP_DIR/target"
ADDON_DIR="$TARGET_DIR/Homenet2MQTT"

log "${TARGET_REPO} 리포지토리를 클론합니다"
if ! git clone "https://x-access-token:${ADDONS_REPO_TOKEN}@github.com/${TARGET_REPO}.git" "$TARGET_DIR"; then
  log "리포지토리를 클론하지 못했습니다. TARGET_REPO 또는 토큰을 확인하세요."
  exit 1
fi

rm -rf "$ADDON_DIR"
mkdir -p "$ADDON_DIR"
cp -R "$ROOT_DIR/hassio-addon/." "$ADDON_DIR/"

pushd "$TARGET_DIR" >/dev/null
if [[ -n $(git status -s) ]]; then
  git config user.name "github-actions[bot]"
  git config user.email "github-actions[bot]@users.noreply.github.com"
  git add .
  git commit -m "Update Homenet2MQTT addon from source"
  git push origin "$TARGET_BRANCH"
  log "${TARGET_REPO} 리포지토리에 변경 사항을 푸시했습니다"
else
  log "동기화할 변경 사항이 없어 푸시를 건너뜁니다"
fi
popd >/dev/null
