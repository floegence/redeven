#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
export GOWORK=off REDEVEN_MANAGED_OPENING_QUALIFICATION=1 REDEVEN_MANAGED_CONTAINER_DOCKER_TEST=1
case "$(uname -m)" in
  arm64|aarch64)
    FAULT_DIGEST=sha256:6b6bb4afb9c948666100be528d83ccd6cc809dd4d7847a9ae31298e2977dd1e8
    RECOMMENDED_DIGEST=sha256:dc25ba9a99ed371ffbb92d5ff0c317c9fcbd0f6dade557523b2916d20f975661
    ;;
  *) echo 'Supply reviewed platform digests before qualifying this platform.' >&2; exit 1 ;;
esac
export REDEVEN_MANAGED_COMPOSE_DIGEST=$RECOMMENDED_DIGEST
./scripts/check_desktop_electron_test_runtime.sh
printf 'Managed opening qualification: commit=%s template-module=%s\n' "$(git rev-parse HEAD)" "$(go list -m -f '{{.Version}}' github.com/floegence/redeven-service-templates)"
go test ./internal/managedwebservice -run '^TestManaged(Host|Compose)OpeningQualification$' -count=1 -v
go test ./internal/codeapp/appserver -run '^TestManagedProtectedOpeningQualification$' -count=1 -v
REDEVEN_MANAGED_CONTAINER_TEMPLATE=deepseek-harness-container \
REDEVEN_MANAGED_CONTAINER_TAG=0.1.6-alpha.1-r1-ungoogled.1 \
REDEVEN_MANAGED_CONTAINER_DIGEST=$FAULT_DIGEST \
REDEVEN_MANAGED_CONTAINER_UPDATE_TAG=0.2.1-alpha.2-r1-ungoogled.1 \
go test ./internal/managedwebservice -run '^TestManagedContainerDockerLifecycle$' -count=1 -v
REDEVEN_MANAGED_CONTAINER_TEMPLATE=deepseek-harness-container \
REDEVEN_MANAGED_CONTAINER_TAG=0.2.1-alpha.2-r1-ungoogled.1 \
REDEVEN_MANAGED_CONTAINER_DIGEST=$RECOMMENDED_DIGEST \
go test ./internal/managedwebservice -run '^TestManagedContainerDockerLifecycle$' -count=1 -v
