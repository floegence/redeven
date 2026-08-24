package runtimeservice

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"
)

var (
	ErrLifecycleOperation = errors.New("Runtime workload admission is invalid")
)

type WorkloadKnowledge string

const (
	WorkloadKnown   WorkloadKnowledge = "known"
	WorkloadUnknown WorkloadKnowledge = "unknown"
)

type WorkloadImpact struct {
	Knowledge                WorkloadKnowledge `json:"knowledge"`
	AffectedProcessCount     *int              `json:"affected_process_count,omitempty"`
	ActiveSessionCount       *int              `json:"active_session_count,omitempty"`
	ProtectedWorkloadPresent bool              `json:"protected_workload_present"`
}

type WorkloadSnapshot struct {
	RuntimeBinaryVersion   string         `json:"runtime_binary_version,omitempty"`
	SnapshotRevision       int64          `json:"snapshot_revision"`
	ProcessInventoryDigest string         `json:"process_inventory_digest"`
	WorkloadIdentityDigest string         `json:"workload_identity_digest"`
	WorkloadIdentities     []string       `json:"workload_identities,omitempty"`
	Impact                 WorkloadImpact `json:"workload"`
	ObservedAtUnixMS       int64          `json:"observed_at_unix_ms"`
}

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

type WorkloadManager struct {
	mu               sync.Mutex
	revision         int64
	active           map[string]ManagedWorkload
	inventoryUnknown bool
	now              func() time.Time
}

func NewWorkloadManager() *WorkloadManager {
	return &WorkloadManager{
		active: make(map[string]ManagedWorkload),
		now:    time.Now,
	}
}

func (manager *WorkloadManager) SetInventoryUnknown(unknown bool) {
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

func (manager *WorkloadManager) Admit(workload ManagedWorkload) (*WorkloadLease, error) {
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
	if _, exists := manager.active[workload.Identity]; exists {
		return nil, ErrLifecycleOperation
	}
	manager.active[workload.Identity] = workload
	manager.revision++
	return &WorkloadLease{release: func() { manager.releaseWorkload(workload.Identity) }}, nil
}

func (manager *WorkloadManager) Snapshot() WorkloadSnapshot {
	if manager == nil {
		return normalizeWorkloadSnapshot(WorkloadSnapshot{
			Impact: WorkloadImpact{Knowledge: WorkloadUnknown},
		})
	}
	manager.mu.Lock()
	defer manager.mu.Unlock()
	return manager.snapshotLocked()
}

func (manager *WorkloadManager) releaseWorkload(identity string) {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if _, ok := manager.active[identity]; !ok {
		return
	}
	delete(manager.active, identity)
	manager.revision++
}

func (manager *WorkloadManager) snapshotLocked() WorkloadSnapshot {
	now := time.Now
	if manager.now != nil {
		now = manager.now
	}
	if manager.inventoryUnknown {
		return normalizeWorkloadSnapshot(WorkloadSnapshot{
			SnapshotRevision: manager.revision,
			Impact:           WorkloadImpact{Knowledge: WorkloadUnknown},
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
	return normalizeWorkloadSnapshot(WorkloadSnapshot{
		SnapshotRevision:       manager.revision,
		ProcessInventoryDigest: processDigest,
		WorkloadIdentityDigest: identityDigest,
		WorkloadIdentities:     identities,
		Impact: WorkloadImpact{
			Knowledge:                WorkloadKnown,
			AffectedProcessCount:     &count,
			ActiveSessionCount:       &activeSessions,
			ProtectedWorkloadPresent: protected,
		},
		ObservedAtUnixMS: now().UnixMilli(),
	})
}

func normalizeWorkloadSnapshot(snapshot WorkloadSnapshot) WorkloadSnapshot {
	snapshot.RuntimeBinaryVersion = strings.TrimSpace(snapshot.RuntimeBinaryVersion)
	snapshot.ProcessInventoryDigest = strings.TrimSpace(snapshot.ProcessInventoryDigest)
	snapshot.WorkloadIdentityDigest = strings.TrimSpace(snapshot.WorkloadIdentityDigest)
	snapshot.WorkloadIdentities = compactSortedWorkloadIdentities(snapshot.WorkloadIdentities)
	if snapshot.SnapshotRevision < 0 {
		snapshot.SnapshotRevision = 0
	}
	if snapshot.ObservedAtUnixMS < 0 {
		snapshot.ObservedAtUnixMS = 0
	}
	if snapshot.Impact.Knowledge != WorkloadKnown {
		snapshot.Impact = WorkloadImpact{Knowledge: WorkloadUnknown}
		snapshot.WorkloadIdentities = nil
		if snapshot.WorkloadIdentityDigest == "" {
			snapshot.WorkloadIdentityDigest = "unknown"
		}
		if snapshot.ProcessInventoryDigest == "" {
			snapshot.ProcessInventoryDigest = "unknown"
		}
		return snapshot
	}
	snapshot.Impact.Knowledge = WorkloadKnown
	if snapshot.Impact.AffectedProcessCount == nil || *snapshot.Impact.AffectedProcessCount < 0 || snapshot.ProcessInventoryDigest == "" || snapshot.WorkloadIdentityDigest == "" {
		return normalizeWorkloadSnapshot(WorkloadSnapshot{
			RuntimeBinaryVersion: snapshot.RuntimeBinaryVersion,
			SnapshotRevision:     snapshot.SnapshotRevision,
			ObservedAtUnixMS:     snapshot.ObservedAtUnixMS,
			Impact:               WorkloadImpact{Knowledge: WorkloadUnknown},
		})
	}
	if snapshot.Impact.ActiveSessionCount != nil && *snapshot.Impact.ActiveSessionCount < 0 {
		snapshot.Impact.ActiveSessionCount = nil
	}
	return snapshot
}

func compactSortedWorkloadIdentities(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func digestJSON(value any) string {
	raw, _ := json.Marshal(value)
	sum := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(sum[:])
}
