package runtimeservice

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	gatewayprotocol "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

var (
	ErrLifecycleAdmissionClosed = errors.New("Runtime lifecycle admission is closed")
	ErrLifecycleFenceHeld       = errors.New("Runtime lifecycle fence is held by another operation")
	ErrLifecycleFenceToken      = errors.New("Runtime lifecycle fence token is stale or invalid")
	ErrLifecycleOperation       = errors.New("Runtime lifecycle operation is invalid")
)

type WorkloadKnowledge = gatewayprotocol.WorkloadKnowledge

const (
	WorkloadKnown   = gatewayprotocol.WorkloadKnown
	WorkloadUnknown = gatewayprotocol.WorkloadUnknown
)

type ManagedWorkload struct {
	Identity  string
	Kind      string
	Protected bool
}

type WorkloadLease struct {
	once    sync.Once
	release func()
}

func (lease *WorkloadLease) Release() {
	if lease == nil {
		return
	}
	lease.once.Do(func() {
		if lease.release != nil {
			lease.release()
		}
	})
}

type LifecycleFenceSnapshot struct {
	Token            string
	OperationID      string
	TargetGeneration int64
	Snapshot         gatewayprotocol.WorkloadSnapshot
}

type RuntimeIdentity struct {
	RuntimeInstanceID    string   `json:"runtime_instance_id"`
	RuntimeBinaryVersion string   `json:"runtime_binary_version"`
	ServiceProtocol      string   `json:"service_protocol"`
	CompatibilityEpoch   int      `json:"compatibility_epoch"`
	Capabilities         []string `json:"capabilities"`
	ArtifactSHA256       string   `json:"artifact_sha256"`
}

type activeFence struct {
	token            string
	operationID      string
	targetGeneration int64
	snapshot         gatewayprotocol.WorkloadSnapshot
}

type LifecycleManager struct {
	mu               sync.Mutex
	revision         int64
	active           map[string]ManagedWorkload
	fence            *activeFence
	inventoryUnknown bool
	shutdown         func() error
	now              func() time.Time
}

func NewLifecycleManager() *LifecycleManager {
	return &LifecycleManager{
		active: make(map[string]ManagedWorkload),
		now:    time.Now,
	}
}

func (manager *LifecycleManager) SetShutdown(shutdown func() error) {
	if manager == nil {
		return
	}
	manager.mu.Lock()
	manager.shutdown = shutdown
	manager.mu.Unlock()
}

func (manager *LifecycleManager) SetInventoryUnknown(unknown bool) {
	if manager == nil {
		return
	}
	manager.mu.Lock()
	if manager.inventoryUnknown != unknown {
		manager.inventoryUnknown = unknown
		manager.revision++
	}
	manager.mu.Unlock()
}

func (manager *LifecycleManager) Admit(workload ManagedWorkload) (*WorkloadLease, error) {
	if manager == nil {
		return nil, ErrLifecycleOperation
	}
	workload.Identity = strings.TrimSpace(workload.Identity)
	workload.Kind = strings.TrimSpace(workload.Kind)
	if workload.Identity == "" || workload.Kind == "" {
		return nil, ErrLifecycleOperation
	}
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if manager.fence != nil {
		return nil, ErrLifecycleAdmissionClosed
	}
	if _, exists := manager.active[workload.Identity]; exists {
		return nil, ErrLifecycleOperation
	}
	manager.active[workload.Identity] = workload
	manager.revision++
	return &WorkloadLease{release: func() { manager.releaseWorkload(workload.Identity) }}, nil
}

func (manager *LifecycleManager) Snapshot() gatewayprotocol.WorkloadSnapshot {
	if manager == nil {
		return gatewayprotocol.NormalizeWorkloadSnapshot(gatewayprotocol.WorkloadSnapshot{
			Impact: gatewayprotocol.WorkloadImpact{Knowledge: gatewayprotocol.WorkloadUnknown},
		})
	}
	manager.mu.Lock()
	defer manager.mu.Unlock()
	return manager.snapshotLocked()
}

func (manager *LifecycleManager) BeginLifecycleFence(operationID string, targetGeneration int64) (LifecycleFenceSnapshot, error) {
	if manager == nil {
		return LifecycleFenceSnapshot{}, ErrLifecycleOperation
	}
	operationID = strings.TrimSpace(operationID)
	if operationID == "" || targetGeneration <= 0 {
		return LifecycleFenceSnapshot{}, ErrLifecycleOperation
	}
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if manager.fence != nil {
		if manager.fence.operationID == operationID && manager.fence.targetGeneration == targetGeneration {
			return lifecycleFenceSnapshot(*manager.fence), nil
		}
		return LifecycleFenceSnapshot{}, ErrLifecycleFenceHeld
	}
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return LifecycleFenceSnapshot{}, err
	}
	manager.revision++
	fence := &activeFence{
		token:            "rtf_" + base64.RawURLEncoding.EncodeToString(tokenBytes),
		operationID:      operationID,
		targetGeneration: targetGeneration,
		snapshot:         manager.snapshotLocked(),
	}
	manager.fence = fence
	return lifecycleFenceSnapshot(*fence), nil
}

func (manager *LifecycleManager) ReleaseLifecycleFence(token string) error {
	if manager == nil {
		return ErrLifecycleFenceToken
	}
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if manager.fence == nil || manager.fence.token != strings.TrimSpace(token) {
		return ErrLifecycleFenceToken
	}
	manager.fence = nil
	manager.revision++
	return nil
}

func (manager *LifecycleManager) RequestShutdown(token string) error {
	if manager == nil {
		return ErrLifecycleFenceToken
	}
	manager.mu.Lock()
	if manager.fence == nil || manager.fence.token != strings.TrimSpace(token) {
		manager.mu.Unlock()
		return ErrLifecycleFenceToken
	}
	shutdown := manager.shutdown
	manager.mu.Unlock()
	if shutdown == nil {
		return errors.New("Runtime lifecycle shutdown callback is unavailable")
	}
	return shutdown()
}

func (manager *LifecycleManager) releaseWorkload(identity string) {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if _, ok := manager.active[identity]; !ok {
		return
	}
	delete(manager.active, identity)
	manager.revision++
}

func (manager *LifecycleManager) snapshotLocked() gatewayprotocol.WorkloadSnapshot {
	now := time.Now
	if manager.now != nil {
		now = manager.now
	}
	if manager.inventoryUnknown {
		return gatewayprotocol.NormalizeWorkloadSnapshot(gatewayprotocol.WorkloadSnapshot{
			SnapshotRevision: manager.revision,
			Impact:           gatewayprotocol.WorkloadImpact{Knowledge: gatewayprotocol.WorkloadUnknown},
			ObservedAtUnixMS: now().UnixMilli(),
		})
	}
	identities := make([]string, 0, len(manager.active))
	protected := false
	activeSessions := 0
	for identity, workload := range manager.active {
		identities = append(identities, identity)
		protected = protected || workload.Protected
		if workload.Kind == "session" || workload.Kind == "terminal" {
			activeSessions++
		}
	}
	sort.Strings(identities)
	count := len(identities)
	identityDigest := digestJSON(identities)
	processDigest := digestJSON(struct {
		Revision   int64    `json:"revision"`
		Identities []string `json:"identities"`
	}{Revision: manager.revision, Identities: identities})
	return gatewayprotocol.NormalizeWorkloadSnapshot(gatewayprotocol.WorkloadSnapshot{
		SnapshotRevision:       manager.revision,
		ProcessInventoryDigest: processDigest,
		WorkloadIdentityDigest: identityDigest,
		WorkloadIdentities:     identities,
		Impact: gatewayprotocol.WorkloadImpact{
			Knowledge:                gatewayprotocol.WorkloadKnown,
			AffectedProcessCount:     &count,
			ActiveSessionCount:       &activeSessions,
			ProtectedWorkloadPresent: protected,
		},
		ObservedAtUnixMS: now().UnixMilli(),
	})
}

func lifecycleFenceSnapshot(fence activeFence) LifecycleFenceSnapshot {
	return LifecycleFenceSnapshot{
		Token: fence.token, OperationID: fence.operationID, TargetGeneration: fence.targetGeneration,
		Snapshot: fence.snapshot,
	}
}

func digestJSON(value any) string {
	raw, _ := json.Marshal(value)
	sum := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(sum[:])
}
