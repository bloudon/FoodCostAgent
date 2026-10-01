#!/usr/bin/env bash
set -Eeuo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly HELPER_SOURCE="${REPO_ROOT}/scripts/vps/update-fnbcostpro-from-main.sh"
readonly APPROVED_ORIGIN="https://github.com/bloudon/FoodCostAgent.git"
readonly BEFORE_SHA="1111111111111111111111111111111111111111"
readonly FETCHED_SHA="2222222222222222222222222222222222222222"
readonly MOVED_SHA="3333333333333333333333333333333333333333"
readonly TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

new_case() {
  local name="$1"
  CASE_DIR="${TEST_ROOT}/${name}"
  APP_DIR="${CASE_DIR}/app"
  STUB_DIR="${CASE_DIR}/stubs"
  mkdir -p "$APP_DIR/.git" "$STUB_DIR"
  : > "${APP_DIR}/pnpm-lock.yaml"
  printf 'APP_BUILD_ID=test\n' > "${APP_DIR}/.env"

  # Replace only the hard-bound checkout path in a private helper copy. The
  # production helper itself remains non-configurable and no VPS path is used.
  sed "s|/home/administrator/apps/CostPro/fnbcostpro|${APP_DIR}|g" \
    "$HELPER_SOURCE" > "${CASE_DIR}/helper.sh"

  printf '%s\n' "$BEFORE_SHA" > "${CASE_DIR}/head"
  printf '%s\n' "$BEFORE_SHA" > "${CASE_DIR}/origin"
  : > "${CASE_DIR}/git.log"
  : > "${CASE_DIR}/pnpm.log"
  : > "${CASE_DIR}/pm2.log"

  cat > "${STUB_DIR}/git" <<'GIT_STUB'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "$GIT_LOG"
case "${1:-}" in
  status)
    if [[ "${GIT_DIRTY:-0}" = "1" ]]; then
      printf ' M local-change\n'
    fi
    ;;
  remote)
    printf '%s\n' 'https://github.com/bloudon/FoodCostAgent.git'
    ;;
  fetch)
    printf '%s\n' "$FETCHED_SHA" > "$ORIGIN_SHA_FILE"
    ;;
  rev-parse)
    if [[ "${2:-}" = "--verify" && "${3:-}" = "refs/remotes/origin/main^{commit}" ]]; then
      resolved_sha="$(<"$ORIGIN_SHA_FILE")"
      printf '%s\n' "$resolved_sha"
      printf '%s\n' "$MOVED_SHA" > "$ORIGIN_SHA_FILE"
    elif [[ "${2:-}" = "--verify" && "${3:-}" = "HEAD" ]]; then
      cat "$HEAD_SHA_FILE"
    else
      printf 'Unexpected rev-parse invocation: %s\n' "$*" >&2
      exit 90
    fi
    ;;
  switch)
    ;;
  merge)
    [[ "${2:-}" = "--ff-only" ]] || exit 91
    [[ "${GIT_MERGE_FAIL:-0}" = "0" ]] || exit 1
    printf '%s\n' "${3:-}" > "$HEAD_SHA_FILE"
    ;;
  pull)
    exit 92
    ;;
  *)
    printf 'Unexpected git invocation: %s\n' "$*" >&2
    exit 93
    ;;
esac
GIT_STUB
  cat > "${STUB_DIR}/pnpm" <<'PNPM_STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$PNPM_LOG"
exit 77
PNPM_STUB
  cat > "${STUB_DIR}/pm2" <<'PM2_STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$PM2_LOG"
exit 0
PM2_STUB
  for command in curl awk mktemp sha256sum; do
    cat > "${STUB_DIR}/${command}" <<'COMMAND_STUB'
#!/usr/bin/env bash
exit 94
COMMAND_STUB
  done
  cat > "${STUB_DIR}/node" <<'NODE_STUB'
#!/usr/bin/env bash
exit 0
NODE_STUB
  chmod 700 "${STUB_DIR}/"* "${CASE_DIR}/helper.sh"
}

run_helper() {
  local expected_sha_mode="$1"
  shift
  local -a expected_sha_env=()
  if [[ "$expected_sha_mode" = "set" ]]; then
    expected_sha_env=("EXPECTED_GIT_SHA=$1")
    shift
  fi

  env -i \
    "PATH=${STUB_DIR}:${PATH}" \
    "GIT_LOG=${CASE_DIR}/git.log" \
    "PNPM_LOG=${CASE_DIR}/pnpm.log" \
    "PM2_LOG=${CASE_DIR}/pm2.log" \
    "HEAD_SHA_FILE=${CASE_DIR}/head" \
    "ORIGIN_SHA_FILE=${CASE_DIR}/origin" \
    "FETCHED_SHA=${FETCHED_SHA}" \
    "MOVED_SHA=${MOVED_SHA}" \
    "$@" \
    "${expected_sha_env[@]}" \
    bash "${CASE_DIR}/helper.sh" \
    > "${CASE_DIR}/stdout" 2> "${CASE_DIR}/stderr"
}

assert_log_has() {
  local file="$1"
  local pattern="$2"
  grep -Fq -- "$pattern" "$file" || fail "expected '$pattern' in $file"
}

assert_log_lacks() {
  local file="$1"
  local pattern="$2"
  if grep -Fq -- "$pattern" "$file"; then
    fail "did not expect '$pattern' in $file"
  fi
}

# A malformed pin is rejected before any Git or deployment command is called.
new_case malformed
if run_helper set '0123456789ABCDEF'; then
  fail "malformed pin unexpectedly succeeded"
else
  status=$?
fi
[[ "$status" -ne 0 ]] || fail "malformed pin returned success"
assert_log_has "${CASE_DIR}/stderr" "EXPECTED_GIT_SHA must be exactly 40 lowercase hexadecimal characters"
[[ ! -s "${CASE_DIR}/git.log" ]] || fail "malformed pin invoked Git"
[[ ! -s "${CASE_DIR}/pnpm.log" ]] || fail "malformed pin invoked pnpm"
[[ ! -s "${CASE_DIR}/pm2.log" ]] || fail "malformed pin invoked PM2"

# A fetched commit mismatch must stop before switching, merging, building, or restarting.
new_case mismatch
if run_helper set "$MOVED_SHA"; then
  fail "mismatching pin unexpectedly succeeded"
else
  status=$?
fi
[[ "$status" -ne 0 ]] || fail "mismatching pin returned success"
assert_log_has "${CASE_DIR}/stderr" "does not match EXPECTED_GIT_SHA"
assert_log_has "${CASE_DIR}/git.log" "fetch --prune origin"
assert_log_has "${CASE_DIR}/git.log" "rev-parse --verify refs/remotes/origin/main^{commit}"
assert_log_lacks "${CASE_DIR}/git.log" "switch main"
assert_log_lacks "${CASE_DIR}/git.log" "merge "
assert_log_lacks "${CASE_DIR}/git.log" "pull"
[[ ! -s "${CASE_DIR}/pnpm.log" ]] || fail "mismatching pin invoked pnpm"
[[ ! -s "${CASE_DIR}/pm2.log" ]] || fail "mismatching pin invoked PM2"

# After capture, the stub moves origin/main. The accepted pin must merge the
# captured SHA, confirm HEAD, and never issue git pull. pnpm's intentional
# failure is a sentinel proving the release reached the first install only
# after the commit gates completed.
new_case matching
if run_helper set "$FETCHED_SHA"; then
  fail "matching case should stop at the pnpm sentinel"
else
  status=$?
fi
[[ "$status" -eq 77 ]] || fail "matching pin failed before the pnpm sentinel (status $status)"
assert_log_has "${CASE_DIR}/git.log" "merge --ff-only ${FETCHED_SHA}"
assert_log_has "${CASE_DIR}/git.log" "rev-parse --verify HEAD"
assert_log_lacks "${CASE_DIR}/git.log" "pull"
[[ "$(<"${CASE_DIR}/head")" = "$FETCHED_SHA" ]] || fail "merge did not use the captured SHA"
[[ "$(<"${CASE_DIR}/origin")" = "$MOVED_SHA" ]] || fail "remote-movement simulation did not run"
assert_log_has "${CASE_DIR}/pnpm.log" "install --frozen-lockfile --prod=false"
assert_log_has "${CASE_DIR}/pm2.log" "jlist"
assert_log_lacks "${CASE_DIR}/pm2.log" "restart"

# A non-fast-forward merge refusal must not continue to dependency installation or PM2.
new_case fast-forward-refusal
if run_helper set "$FETCHED_SHA" GIT_MERGE_FAIL=1; then
  fail "fast-forward refusal unexpectedly succeeded"
else
  status=$?
fi
[[ "$status" -ne 0 ]] || fail "fast-forward refusal returned success"
assert_log_has "${CASE_DIR}/git.log" "merge --ff-only ${FETCHED_SHA}"
[[ ! -s "${CASE_DIR}/pnpm.log" ]] || fail "fast-forward refusal invoked pnpm"
[[ ! -s "${CASE_DIR}/pm2.log" ]] || fail "fast-forward refusal invoked PM2"

# Dirty worktrees remain an unconditional stop condition before fetch/checkout.
new_case dirty-tree
if run_helper unset GIT_DIRTY=1; then
  fail "dirty tree unexpectedly succeeded"
else
  status=$?
fi
[[ "$status" -ne 0 ]] || fail "dirty tree returned success"
assert_log_has "${CASE_DIR}/stderr" "VPS checkout is dirty"
assert_log_has "${CASE_DIR}/git.log" "status --porcelain"
assert_log_lacks "${CASE_DIR}/git.log" "fetch --prune origin"
assert_log_lacks "${CASE_DIR}/git.log" "switch main"
assert_log_lacks "${CASE_DIR}/git.log" "merge "
[[ ! -s "${CASE_DIR}/pnpm.log" ]] || fail "dirty tree invoked pnpm"
[[ ! -s "${CASE_DIR}/pm2.log" ]] || fail "dirty tree invoked PM2"

printf '%s\n' "PASS: pinned VPS release helper regression cases"