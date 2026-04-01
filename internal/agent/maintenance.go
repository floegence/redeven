package agent

import (
	"strings"
	"sync"
	"time"

	syssvc "github.com/floegence/redeven/internal/sys"
)

type maintenanceSnapshotStore struct {
	mu       sync.Mutex
	snapshot syssvc.MaintenanceSnapshot
}

func (s *maintenanceSnapshotStore) set(snapshot syssvc.MaintenanceSnapshot) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot = snapshot
}

func (s *maintenanceSnapshotStore) snapshotCopy() *syssvc.MaintenanceSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()

	if strings.TrimSpace(s.snapshot.Kind) == "" || strings.TrimSpace(s.snapshot.State) == "" {
		return nil
	}

	out := s.snapshot
	return &out
}

func (a *Agent) CurrentMaintenanceSnapshot() *syssvc.MaintenanceSnapshot {
	if a == nil {
		return nil
	}
	return a.maintenanceState.snapshotCopy()
}

func (a *Agent) markMaintenanceRunning(kind string, targetVersion string, message string) {
	if a == nil {
		return
	}

	now := time.Now().UnixMilli()
	a.maintenanceState.set(syssvc.MaintenanceSnapshot{
		Kind:          strings.TrimSpace(kind),
		State:         syssvc.MaintenanceStateRunning,
		TargetVersion: strings.TrimSpace(targetVersion),
		Message:       strings.TrimSpace(message),
		StartedAtMs:   now,
		UpdatedAtMs:   now,
	})
}

func (a *Agent) markMaintenanceFailed(kind string, targetVersion string, message string) {
	if a == nil {
		return
	}

	now := time.Now().UnixMilli()
	previous := a.CurrentMaintenanceSnapshot()
	startedAtMs := now
	if previous != nil && strings.TrimSpace(previous.Kind) == strings.TrimSpace(kind) && previous.StartedAtMs > 0 {
		startedAtMs = previous.StartedAtMs
	}

	a.maintenanceState.set(syssvc.MaintenanceSnapshot{
		Kind:          strings.TrimSpace(kind),
		State:         syssvc.MaintenanceStateFailed,
		TargetVersion: strings.TrimSpace(targetVersion),
		Message:       strings.TrimSpace(message),
		StartedAtMs:   startedAtMs,
		UpdatedAtMs:   now,
	})
}
