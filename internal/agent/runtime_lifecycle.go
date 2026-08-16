package agent

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strings"

	gatewayprotocol "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimeservice"
)

func (a *Agent) RuntimeLifecycleIdentity() (runtimeservice.RuntimeIdentity, error) {
	if a == nil {
		return runtimeservice.RuntimeIdentity{}, errors.New("Runtime identity is unavailable")
	}
	file, err := os.Open(a.binaryPath)
	if err != nil {
		return runtimeservice.RuntimeIdentity{}, fmt.Errorf("open Runtime artifact: %w", err)
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := file.WriteTo(hash); err != nil {
		return runtimeservice.RuntimeIdentity{}, fmt.Errorf("hash Runtime artifact: %w", err)
	}
	contract := runtimeservice.CurrentCompatibilityContract()
	return runtimeservice.RuntimeIdentity{
		RuntimeInstanceID: strings.TrimSpace(a.instanceID), RuntimeBinaryVersion: strings.TrimSpace(a.version),
		ServiceProtocol: runtimeservice.ProtocolVersion, CompatibilityEpoch: contract.CompatibilityEpoch,
		Capabilities: []string{"lifecycle_fence_v1"}, ArtifactSHA256: "sha256:" + hex.EncodeToString(hash.Sum(nil)),
	}, nil
}

func (a *Agent) admitRuntimeWorkload(workload runtimeservice.ManagedWorkload) (*runtimeservice.WorkloadLease, error) {
	if a == nil || a.runtimeLifecycle == nil {
		return &runtimeservice.WorkloadLease{}, nil
	}
	return a.runtimeLifecycle.Admit(workload)
}

func (a *Agent) RuntimeLifecycleSnapshot() gatewayprotocol.WorkloadSnapshot {
	if a == nil || a.runtimeLifecycle == nil {
		return gatewayprotocol.NormalizeWorkloadSnapshot(gatewayprotocol.WorkloadSnapshot{
			Impact: gatewayprotocol.WorkloadImpact{Knowledge: gatewayprotocol.WorkloadUnknown},
		})
	}
	snapshot := a.runtimeLifecycle.Snapshot()
	snapshot.RuntimeBinaryVersion = strings.TrimSpace(a.version)
	return snapshot
}

func (a *Agent) BeginRuntimeLifecycleFence(operationID string, targetGeneration int64) (runtimeservice.LifecycleFenceSnapshot, error) {
	if a == nil || a.runtimeLifecycle == nil {
		return runtimeservice.LifecycleFenceSnapshot{}, errors.New("Runtime lifecycle admission is unavailable")
	}
	return a.runtimeLifecycle.BeginLifecycleFence(operationID, targetGeneration)
}

func (a *Agent) ReleaseRuntimeLifecycleFence(token string) error {
	if a == nil || a.runtimeLifecycle == nil {
		return errors.New("Runtime lifecycle admission is unavailable")
	}
	return a.runtimeLifecycle.ReleaseLifecycleFence(token)
}

func (a *Agent) RequestRuntimeLifecycleShutdown(token string) error {
	if a == nil || a.runtimeLifecycle == nil {
		return errors.New("Runtime lifecycle admission is unavailable")
	}
	return a.runtimeLifecycle.RequestShutdown(token)
}
