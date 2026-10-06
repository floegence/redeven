#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/redeven-gateway-isolation.XXXXXX")"
RUN_ID="redeven-gateway-isolation-$$"
LAN_NETWORK="${RUN_ID}-lan"
CLOUD_NETWORK="${RUN_ID}-cloud"
cleanup() {
  docker rm -f "${RUN_ID}-runtime" "${RUN_ID}-gateway" "${RUN_ID}-cloud" >/dev/null 2>&1 || true
  docker network rm "${LAN_NETWORK}" "${CLOUD_NETWORK}" >/dev/null 2>&1 || true
  rm -rf "${STATE_DIR}"
}
trap cleanup EXIT
cd "${REPO_ROOT}"
docker info >/dev/null
REDEVEN_GATEWAY_ISOLATION_ROLE=prepare REDEVEN_GATEWAY_ISOLATION_STATE="${STATE_DIR}" \
  GOWORK=off go test ./internal/gatewaycloud -run '^TestGatewayNetworkIsolationProcess$' -count=1
arch="$(docker version --format '{{.Server.Arch}}')"
CGO_ENABLED=0 GOOS=linux GOARCH="${arch}" GOWORK=off \
  go test -c -o "${STATE_DIR}/isolation.test" ./internal/gatewaycloud
mkdir -p "${STATE_DIR}/cloud" "${STATE_DIR}/gateway" "${STATE_DIR}/runtime"
for role in cloud gateway runtime; do mv "${STATE_DIR}/${role}.json" "${STATE_DIR}/${role}/${role}.json"; done
mv "${STATE_DIR}/cloud-root.pem" "${STATE_DIR}/runtime/cloud-root.pem"
printf 'nameserver 192.0.2.1\noptions timeout:1 attempts:1\n' > "${STATE_DIR}/resolv.conf"
docker network create --internal --subnet 10.242.73.0/24 "${LAN_NETWORK}" >/dev/null
docker network create --internal --subnet 10.241.73.0/24 "${CLOUD_NETWORK}" >/dev/null

docker run -d --name "${RUN_ID}-cloud" --network "${CLOUD_NETWORK}" --ip 10.241.73.20 \
  -v "${STATE_DIR}/cloud:/state" -v "${STATE_DIR}/isolation.test:/isolation.test:ro" -e REDEVEN_GATEWAY_ISOLATION_STATE=/state -e REDEVEN_GATEWAY_ISOLATION_ROLE=cloud \
  alpine:3.23 /isolation.test -test.run '^TestGatewayNetworkIsolationProcess$' >/dev/null

docker create --name "${RUN_ID}-gateway" --network "${LAN_NETWORK}" --ip 10.242.73.2 \
  --add-host cloud.gateway.test:10.241.73.20 -v "${STATE_DIR}/gateway:/state" -v "${STATE_DIR}/isolation.test:/isolation.test:ro" \
  -e REDEVEN_GATEWAY_ISOLATION_STATE=/state -e REDEVEN_GATEWAY_ISOLATION_ROLE=gateway \
  alpine:3.23 /isolation.test -test.run '^TestGatewayNetworkIsolationProcess$' >/dev/null
docker network connect "${CLOUD_NETWORK}" "${RUN_ID}-gateway"
docker start "${RUN_ID}-gateway" >/dev/null
for stage in cloud gateway; do
  ready=0
  for ((attempt=0; attempt<30; attempt++)); do
    if [[ -f "${STATE_DIR}/${stage}/${stage}.ready" ]]; then ready=1; break; fi
    sleep 1
  done
  if [[ "${ready}" != 1 ]]; then docker logs "${RUN_ID}-${stage}"; exit 1; fi
done
# Only the Gateway address is reachable; Cloud DNS and public routing are absent.
docker run --rm --name "${RUN_ID}-runtime" --network "${LAN_NETWORK}" --ip 10.242.73.3 \
  -v "${STATE_DIR}/runtime:/state:ro" \
  -v "${STATE_DIR}/isolation.test:/isolation.test:ro" \
  -v "${STATE_DIR}/resolv.conf:/etc/resolv.conf:ro" \
  -e SSL_CERT_FILE=/state/cloud-root.pem -e REDEVEN_GATEWAY_ISOLATION_STATE=/state \
  -e REDEVEN_GATEWAY_ISOLATION_ROLE=runtime \
  alpine:3.23 /isolation.test -test.run '^TestGatewayNetworkIsolationProcess$' -test.v
