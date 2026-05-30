#!/usr/bin/env bash
# Sync shared AI conventions from notebox (canonical) to a sibling repo.
# Usage:
#   ./scripts/sync-shared-conventions.sh /path/to/eskerra-go
#   ./scripts/sync-shared-conventions.sh --check /path/to/eskerra-go
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
MANIFEST="${SCRIPT_DIR}/shared-conventions.manifest.json"
HEADER_MARKER="AUTO-SYNCED from notebox"

CHECK_MODE=false
TARGET_ROOT=""

usage() {
  echo "Usage: $0 [--check] <target-repo-path>" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)
      CHECK_MODE=true
      shift
      ;;
    -h|--help)
      usage
      ;;
    *)
      if [[ -n "${TARGET_ROOT}" ]]; then
        usage
      fi
      TARGET_ROOT="$1"
      shift
      ;;
  esac
done

[[ -n "${TARGET_ROOT}" ]] || usage
[[ -f "${MANIFEST}" ]] || { echo "Missing manifest: ${MANIFEST}" >&2; exit 1; }

TARGET_ROOT="$(cd "${TARGET_ROOT}" && pwd)"
if [[ "${TARGET_ROOT}" == "${SOURCE_ROOT}" ]]; then
  echo "Refusing to sync into the canonical repo itself." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required." >&2
  exit 1
fi

strip_for_sibling() {
  awk '
    /<!-- repo-specific:start -->/ { skip = 1; next }
    /<!-- repo-specific:end -->/ { skip = 0; next }
    skip { next }
    /<!-- shared-fallback:start -->/ { next }
    /<!-- shared-fallback:end -->/ { next }
    { print }
  '
}

transform_skill_md_to() {
  local src_file="$1"
  local dest_file="$2"
  local rel_source="$3"
  mkdir -p "$(dirname "${dest_file}")"
  strip_for_sibling < "${src_file}" > "${dest_file}"
  inject_sync_notice "${dest_file}" "${rel_source}" "${dest_file}"
}

build_skill_dir_snapshot() {
  local src_dir="$1"
  local out_dir="$2"
  local rel_prefix="$3"
  rm -rf "${out_dir}"
  mkdir -p "${out_dir}"
  while IFS= read -r -d '' src_file; do
    local rel="${src_file#${src_dir}/}"
    local dest_file="${out_dir}/${rel}"
    if [[ "${src_file}" == *.md ]]; then
      transform_skill_md_to "${src_file}" "${dest_file}" "${rel_prefix}/${rel}"
    else
      mkdir -p "$(dirname "${dest_file}")"
      cp "${src_file}" "${dest_file}"
    fi
  done < <(find "${src_dir}" -type f -print0)
}

inject_frontmatter_notice() {
  local file_path="$1"
  local rel_source="$2"
  awk -v marker="${HEADER_MARKER}" -v src="${rel_source}" '
    BEGIN { done = 0 }
    /^---$/ && !done {
      print
      getline
      while ($0 !~ /^---$/) { print; getline }
      print "---"
      print ""
      print "<!-- " marker " — do not edit here. Canonical: notebox/" src " -->"
      print "<!-- Re-run: notebox/scripts/sync-shared-conventions.sh -->"
      print ""
      done = 1
      next
    }
    { print }
  ' "${file_path}" > "${file_path}.tmp" && mv "${file_path}.tmp" "${file_path}"
}

inject_sync_notice() {
  local file_path="$1"
  local rel_source="$2"
  local dest_hint="${3:-${file_path}}"
  if grep -q "${HEADER_MARKER}" "${file_path}" 2>/dev/null; then
    return 0
  fi

  case "${dest_hint}" in
    *.mdc|*.md)
      if head -n 1 "${file_path}" | grep -q '^---$'; then
        inject_frontmatter_notice "${file_path}" "${rel_source}"
        return 0
      fi
      {
        echo "<!-- ${HEADER_MARKER} — do not edit here. Canonical: notebox/${rel_source} -->"
        echo "<!-- Re-run: notebox/scripts/sync-shared-conventions.sh -->"
        echo ""
        cat "${file_path}"
      } > "${file_path}.tmp" && mv "${file_path}.tmp" "${file_path}"
      ;;
    *.sh)
      if head -n 1 "${file_path}" | grep -q '^#!'; then
        {
          head -n 1 "${file_path}"
          echo "# ${HEADER_MARKER} — do not edit here. Canonical: notebox/${rel_source}"
          echo "# Re-run: notebox/scripts/sync-shared-conventions.sh"
          tail -n +2 "${file_path}"
        } > "${file_path}.tmp" && mv "${file_path}.tmp" "${file_path}"
      else
        {
          echo "# ${HEADER_MARKER} — do not edit here. Canonical: notebox/${rel_source}"
          echo "# Re-run: notebox/scripts/sync-shared-conventions.sh"
          cat "${file_path}"
        } > "${file_path}.tmp" && mv "${file_path}.tmp" "${file_path}"
      fi
      ;;
    *)
      {
        echo "<!-- ${HEADER_MARKER} — do not edit here. Canonical: notebox/${rel_source} -->"
        echo "<!-- Re-run: notebox/scripts/sync-shared-conventions.sh -->"
        echo ""
        cat "${file_path}"
      } > "${file_path}.tmp" && mv "${file_path}.tmp" "${file_path}"
      ;;
  esac
}

copy_file() {
  local src_rel="$1"
  local dest_rel="$2"
  local inject_header="$3"
  local src="${SOURCE_ROOT}/${src_rel}"
  local dest="${TARGET_ROOT}/${dest_rel}"

  [[ -f "${src}" ]] || { echo "Missing source: ${src}" >&2; exit 1; }

  if [[ "${CHECK_MODE}" == true ]]; then
    mkdir -p "$(dirname "${dest}")"
    local tmp
    tmp="$(mktemp "${TMPDIR:-/tmp}/sync-conventions.XXXXXX")"
    cp "${src}" "${tmp}"
    if [[ "${inject_header}" == "true" ]]; then
      inject_sync_notice "${tmp}" "${src_rel}" "${dest}"
    fi
    if [[ -f "${dest}" ]] && cmp -s "${tmp}" "${dest}"; then
      rm -f "${tmp}"
      return 0
    fi
    echo "Would update: ${dest_rel}"
    diff -u "${dest}" "${tmp}" 2>/dev/null || true
    rm -f "${tmp}"
    return 1
  fi

  mkdir -p "$(dirname "${dest}")"
  cp "${src}" "${dest}"
  if [[ "${inject_header}" == "true" ]]; then
    inject_sync_notice "${dest}" "${src_rel}" "${dest}"
  fi
  echo "Synced: ${dest_rel}"
}

copy_skill_dir() {
  local name="$1"
  local src="${SOURCE_ROOT}/.cursor/skills/${name}"
  local dest="${TARGET_ROOT}/.cursor/skills/${name}"
  local rel_prefix=".cursor/skills/${name}"
  [[ -d "${src}" ]] || { echo "Missing skill: ${src}" >&2; exit 1; }

  local snapshot
  snapshot="$(mktemp -d "${TMPDIR:-/tmp}/sync-skill-snapshot.XXXXXX")"
  build_skill_dir_snapshot "${src}" "${snapshot}" "${rel_prefix}"

  if [[ "${CHECK_MODE}" == true ]]; then
    if [[ -d "${dest}" ]] && diff -qr "${snapshot}" "${dest}" >/dev/null 2>&1; then
      rm -rf "${snapshot}"
      return 0
    fi
    echo "Would update skill dir: .cursor/skills/${name}"
    diff -qr "${dest}" "${snapshot}" 2>/dev/null || true
    rm -rf "${snapshot}"
    return 1
  fi

  mkdir -p "${TARGET_ROOT}/.cursor/skills"
  rm -rf "${dest}"
  cp -a "${snapshot}/." "${dest}/"
  rm -rf "${snapshot}"
  echo "Synced skill: .cursor/skills/${name}"
}

ensure_claude_skills_symlink() {
  local link="${TARGET_ROOT}/.claude/skills"
  local expected="../.cursor/skills"
  if [[ "${CHECK_MODE}" == true ]]; then
    if [[ -L "${link}" ]] && [[ "$(readlink "${link}")" == "${expected}" ]]; then
      return 0
    fi
    echo "Would create symlink: .claude/skills -> ${expected}"
    return 1
  fi
  mkdir -p "${TARGET_ROOT}/.claude"
  ln -sfn "${expected}" "${link}"
  echo "Linked: .claude/skills -> ${expected}"
}

echo "Canonical: ${SOURCE_ROOT}"
echo "Target:    ${TARGET_ROOT}"
echo "Mode:      $([[ "${CHECK_MODE}" == true ]] && echo check || echo sync)"
echo ""

FAIL=0

while IFS= read -r entry; do
  src_rel="$(jq -r '.source' <<<"${entry}")"
  dest_rel="$(jq -r '.dest' <<<"${entry}")"
  inject="$(jq -r '.injectHeader' <<<"${entry}")"
  copy_file "${src_rel}" "${dest_rel}" "${inject}" || FAIL=1
done < <(jq -c '.files[]' "${MANIFEST}")

while IFS= read -r skill; do
  copy_skill_dir "${skill}" || FAIL=1
done < <(jq -r '.skillDirs[]' "${MANIFEST}")

while IFS= read -r skill_file; do
  copy_file "${skill_file}" "${skill_file}" "false" || FAIL=1
done < <(jq -r '.skillFiles[]' "${MANIFEST}")

while IFS= read -r entry; do
  src_rel="$(jq -r '.source' <<<"${entry}")"
  dest_rel="$(jq -r '.dest' <<<"${entry}")"
  inject="$(jq -r '.injectHeader' <<<"${entry}")"
  copy_file "${src_rel}" "${dest_rel}" "${inject}" || FAIL=1
done < <(jq -c '.generatedFiles[]? // empty' "${MANIFEST}")

ensure_claude_skills_symlink || FAIL=1

if [[ "${CHECK_MODE}" == true ]]; then
  if [[ "${FAIL}" -ne 0 ]]; then
    echo ""
    echo "Check failed: target is out of date. Run without --check to sync." >&2
    exit 1
  fi
  echo ""
  echo "Check passed: target matches manifest."
  exit 0
fi

echo ""
echo "Done. Verify with: $0 --check ${TARGET_ROOT}"
