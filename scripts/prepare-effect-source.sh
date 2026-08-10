#!/usr/bin/env bash
set -euo pipefail

readonly effect_upstream="https://github.com/Effect-TS/effect.git"
readonly repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly checkout="$repo_root/.repos/effect"
readonly effect_version="$(node -p 'require(process.argv[1]).dependencies.effect' "$repo_root/package.json")"

if [[ ! "$effect_version" =~ ^4\.0\.0-beta\.[0-9]+$ ]]; then
  echo "package.json must pin effect to an exact v4 beta version, got: $effect_version" >&2
  exit 1
fi

readonly effect_ref="effect@$effect_version"

if [[ -e "$checkout" && ! -d "$checkout/.git" ]]; then
  echo "Effect source path exists but is not a Git checkout: $checkout" >&2
  exit 1
fi

if [[ ! -d "$checkout/.git" ]]; then
  mkdir -p "$checkout"
  git -C "$checkout" init --quiet
fi

if [[ -n "$(git -C "$checkout" status --porcelain=v1)" ]]; then
  echo "Effect source checkout has local changes: $checkout" >&2
  echo "Commit, stash, or remove those changes before running this command again." >&2
  exit 1
fi

readonly current_remote="$(git -C "$checkout" remote get-url origin 2>/dev/null || true)"

if [[ -z "$current_remote" ]]; then
  git -C "$checkout" remote add origin "$effect_upstream"
elif [[ "$current_remote" != "$effect_upstream" ]]; then
  git -C "$checkout" remote set-url origin "$effect_upstream"
fi

git -C "$checkout" fetch --depth 1 --force origin "refs/tags/$effect_ref:refs/tags/$effect_ref"
readonly target_commit="$(git -C "$checkout" rev-list -n 1 "$effect_ref")"
readonly current_commit="$(git -C "$checkout" rev-parse HEAD 2>/dev/null || true)"

if [[ "$current_commit" != "$target_commit" ]]; then
  git -C "$checkout" checkout --detach "$target_commit"
fi

printf 'Effect source ready at %s (%s)\n' "$checkout" "$effect_ref"
