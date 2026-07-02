#!/usr/bin/env bash
set -euo pipefail

# Redeploys the BRIDGE app (wxmr.io) — sibling of redeploy-swap-remote.sh,
# which only ships the swap app + orchestrator and does NOT touch the bridge.
#
# No sudo needed: the remote wxmr-bridge.path unit watches
# apps/bridge/.next/BUILD_ID and restarts wxmr-bridge.service automatically
# when the uploaded tarball overwrites it. This script waits for that restart
# and then health-checks the live site.

cd "$(git rev-parse --show-toplevel)"

# The deploy host is intentionally never committed (this repo is public).
# Provide REMOTE directly, or set WXMR_DEPLOY_HOST in the environment or the
# gitignored repo-root .env.
if [[ -z "${WXMR_DEPLOY_HOST:-}" && -f .env ]]; then
  WXMR_DEPLOY_HOST="$(sed -n 's/^WXMR_DEPLOY_HOST=//p' .env | tail -1)"
fi
REMOTE="${REMOTE:-deploy@${WXMR_DEPLOY_HOST:?set WXMR_DEPLOY_HOST (env or repo-root .env) or pass REMOTE}}"
REMOTE_DIR="${REMOTE_DIR:-/home/deploy/wxmr-frontend}"
SITE_URL="${SITE_URL:-https://wxmr.io}"
SSH_OPTS=(-F /dev/null -o StrictHostKeyChecking=no)
BUILD_FILTERS=(
  @wxmr/bridge
)
ARTIFACTS=(
  packages/core/dist
  apps/bridge/.next
)

echo "Deploying local build artifacts to ${REMOTE}:${REMOTE_DIR}"
echo "Local HEAD: $(git rev-parse --short HEAD)"
echo "This script does not pull or build on the remote host."

# NEXT_PUBLIC_* values are inlined into the client bundle at BUILD time.
# Export the repo-root .env (copy of the production one; gitignored) into the
# build environment so (a) next inlines the real values instead of fallbacks
# and (b) turbo's cache key sees them (it cannot hash the .env file itself,
# so a cached env-less build would otherwise be replayed silently).
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
else
  echo "WARNING: no repo-root .env — the build will bake in code fallbacks" >&2
  echo "         (public Solana RPC, default program id)." >&2
fi

for filter in "${BUILD_FILTERS[@]}"; do
  npm run build -- --filter="${filter}" --force
done

# Snapshot the service start time so we can detect the path-unit restart.
before_ts="$(ssh "${SSH_OPTS[@]}" "${REMOTE}" \
  "systemctl show wxmr-bridge.service -p ActiveEnterTimestampMonotonic --value")"

# Two-phase upload: everything EXCEPT BUILD_ID first, then BUILD_ID alone.
# The remote wxmr-bridge.path unit restarts the service the instant BUILD_ID
# changes — if BUILD_ID landed mid-extraction the server would boot against a
# half-written .next and 404 the new static chunks.
tar \
  -C "$(git rev-parse --show-toplevel)" \
  --exclude='apps/bridge/.next/cache' \
  --exclude='apps/bridge/.next/BUILD_ID' \
  -czf - \
  "${ARTIFACTS[@]}" \
  | ssh "${SSH_OPTS[@]}" "${REMOTE}" "cd '${REMOTE_DIR}' && tar -xzf -"
tar \
  -C "$(git rev-parse --show-toplevel)" \
  -czf - \
  apps/bridge/.next/BUILD_ID \
  | ssh "${SSH_OPTS[@]}" "${REMOTE}" "cd '${REMOTE_DIR}' && tar -xzf -"

echo "Uploaded. Waiting for wxmr-bridge.path to restart the service..."
restarted=0
for attempt in $(seq 1 30); do
  after_ts="$(ssh "${SSH_OPTS[@]}" "${REMOTE}" \
    "systemctl show wxmr-bridge.service -p ActiveEnterTimestampMonotonic --value")"
  if [[ -n "${after_ts}" && "${after_ts}" != "${before_ts}" ]]; then
    restarted=1
    break
  fi
  sleep 2
done
if [[ "${restarted}" != 1 ]]; then
  echo "Service did not restart on its own; run manually on the remote:" >&2
  echo "  sudo systemctl restart wxmr-bridge.service" >&2
  exit 1
fi

ssh "${SSH_OPTS[@]}" "${REMOTE}" "systemctl is-active wxmr-bridge.service"

for attempt in $(seq 1 10); do
  if curl -fsS -o /dev/null "${SITE_URL}/"; then
    echo "${SITE_URL} is serving."
    break
  fi
  if [[ "${attempt}" == 10 ]]; then
    exit 1
  fi
  sleep 2
done

# Confirm the served build is the one we just uploaded: BUILD_ID on the remote
# must match the local build.
local_build_id="$(cat apps/bridge/.next/BUILD_ID)"
remote_build_id="$(ssh "${SSH_OPTS[@]}" "${REMOTE}" "cat '${REMOTE_DIR}/apps/bridge/.next/BUILD_ID'")"
if [[ "${local_build_id}" != "${remote_build_id}" ]]; then
  echo "BUILD_ID mismatch: local ${local_build_id} vs remote ${remote_build_id}" >&2
  exit 1
fi
echo "Deployed BUILD_ID ${local_build_id}."
