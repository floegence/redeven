package agent

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	syssvc "github.com/floegence/redeven/internal/sys"
)

const (
	runtimeMaintenanceMarkerSchemaVersion   = 1
	runtimeMaintenanceErrorMarkerUnreadable = "marker_unreadable"
	runtimeMaintenanceErrorVersionMismatch  = "version_mismatch"
	runtimeMaintenanceErrorIdentityMissing  = "identity_missing"
	runtimeMaintenanceErrorInstallFailed    = "install_failed"
	runtimeMaintenanceErrorExecFailed       = "exec_failed"
)

type maintenanceSnapshotStore struct {
	mu       sync.Mutex
	snapshot syssvc.MaintenanceSnapshot
}

type runtimeMaintenanceMarker struct {
	SchemaVersion              int    `json:"schema_version"`
	Kind                       string `json:"kind"`
	State                      string `json:"state"`
	TargetVersion              string `json:"target_version,omitempty"`
	PreviousVersion            string `json:"previous_version,omitempty"`
	ObservedVersion            string `json:"observed_version,omitempty"`
	PreviousProcessStartedAtMs int64  `json:"previous_process_started_at_ms,omitempty"`
	ObservedProcessStartedAtMs int64  `json:"observed_process_started_at_ms,omitempty"`
	PreviousRuntimeInstanceID  string `json:"previous_runtime_instance_id,omitempty"`
	ObservedRuntimeInstanceID  string `json:"observed_runtime_instance_id,omitempty"`
	InstallDir                 string `json:"install_dir,omitempty"`
	ExePath                    string `json:"exe_path,omitempty"`
	Message                    string `json:"message,omitempty"`
	ErrorCode                  string `json:"error_code,omitempty"`
	StartedAtMs                int64  `json:"started_at_ms"`
	UpdatedAtMs                int64  `json:"updated_at_ms"`
	CompletedAtMs              int64  `json:"completed_at_ms,omitempty"`
}

type runtimeMaintenanceMarkerStore struct {
	path string
}

type runtimeMaintenanceRunInput struct {
	kind          string
	targetVersion string
	message       string
	plan          selfExecPlan
}

type runtimeMaintenanceFailureInput struct {
	kind          string
	targetVersion string
	message       string
	errorCode     string
}

func newRuntimeMaintenanceMarkerStore(path string) *runtimeMaintenanceMarkerStore {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil
	}
	return &runtimeMaintenanceMarkerStore{path: filepath.Clean(path)}
}

func (s *runtimeMaintenanceMarkerStore) read() (*runtimeMaintenanceMarker, error) {
	if s == nil || strings.TrimSpace(s.path) == "" {
		return nil, nil
	}
	raw, err := os.ReadFile(s.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	var marker runtimeMaintenanceMarker
	if err := json.Unmarshal(raw, &marker); err != nil {
		return nil, err
	}
	marker = normalizeRuntimeMaintenanceMarker(marker)
	if marker.SchemaVersion != runtimeMaintenanceMarkerSchemaVersion {
		return nil, fmt.Errorf("unsupported runtime maintenance marker schema_version %d", marker.SchemaVersion)
	}
	return &marker, nil
}

func (s *runtimeMaintenanceMarkerStore) write(marker runtimeMaintenanceMarker) error {
	if s == nil || strings.TrimSpace(s.path) == "" {
		return nil
	}
	marker = normalizeRuntimeMaintenanceMarker(marker)
	marker.SchemaVersion = runtimeMaintenanceMarkerSchemaVersion
	if marker.StartedAtMs <= 0 {
		marker.StartedAtMs = time.Now().UnixMilli()
	}
	if marker.UpdatedAtMs <= 0 {
		marker.UpdatedAtMs = time.Now().UnixMilli()
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(marker, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	tmp, err := os.CreateTemp(filepath.Dir(s.path), ".current-*.json")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer func() { _ = os.Remove(tmpPath) }()
	if _, err := tmp.Write(raw); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpPath, s.path)
}

func (s *runtimeMaintenanceMarkerStore) quarantineUnreadable() (string, error) {
	if s == nil || strings.TrimSpace(s.path) == "" {
		return "", nil
	}
	quarantinePath := fmt.Sprintf("%s.unreadable.%d", s.path, time.Now().UnixMilli())
	if err := os.Rename(s.path, quarantinePath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", nil
		}
		return "", err
	}
	return quarantinePath, nil
}

func normalizeRuntimeMaintenanceMarker(marker runtimeMaintenanceMarker) runtimeMaintenanceMarker {
	marker.Kind = strings.TrimSpace(marker.Kind)
	marker.State = strings.TrimSpace(marker.State)
	marker.TargetVersion = strings.TrimSpace(marker.TargetVersion)
	marker.PreviousVersion = strings.TrimSpace(marker.PreviousVersion)
	marker.ObservedVersion = strings.TrimSpace(marker.ObservedVersion)
	marker.PreviousRuntimeInstanceID = strings.TrimSpace(marker.PreviousRuntimeInstanceID)
	marker.ObservedRuntimeInstanceID = strings.TrimSpace(marker.ObservedRuntimeInstanceID)
	marker.InstallDir = strings.TrimSpace(marker.InstallDir)
	marker.ExePath = strings.TrimSpace(marker.ExePath)
	marker.Message = strings.TrimSpace(marker.Message)
	marker.ErrorCode = strings.TrimSpace(marker.ErrorCode)
	if marker.SchemaVersion == 0 {
		marker.SchemaVersion = runtimeMaintenanceMarkerSchemaVersion
	}
	return marker
}

func markerToMaintenanceSnapshot(marker runtimeMaintenanceMarker) syssvc.MaintenanceSnapshot {
	marker = normalizeRuntimeMaintenanceMarker(marker)
	return syssvc.MaintenanceSnapshot{
		Kind:                       marker.Kind,
		State:                      marker.State,
		TargetVersion:              marker.TargetVersion,
		PreviousVersion:            marker.PreviousVersion,
		ObservedVersion:            marker.ObservedVersion,
		PreviousProcessStartedAtMs: marker.PreviousProcessStartedAtMs,
		ObservedProcessStartedAtMs: marker.ObservedProcessStartedAtMs,
		PreviousRuntimeInstanceID:  marker.PreviousRuntimeInstanceID,
		ObservedRuntimeInstanceID:  marker.ObservedRuntimeInstanceID,
		InstallDir:                 marker.InstallDir,
		ExePath:                    marker.ExePath,
		Message:                    marker.Message,
		ErrorCode:                  marker.ErrorCode,
		StartedAtMs:                marker.StartedAtMs,
		UpdatedAtMs:                marker.UpdatedAtMs,
		CompletedAtMs:              marker.CompletedAtMs,
	}
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

func (a *Agent) markMaintenanceRunning(input runtimeMaintenanceRunInput) {
	if a == nil {
		return
	}

	now := time.Now().UnixMilli()
	marker := runtimeMaintenanceMarker{
		SchemaVersion:              runtimeMaintenanceMarkerSchemaVersion,
		Kind:                       strings.TrimSpace(input.kind),
		State:                      syssvc.MaintenanceStateRunning,
		TargetVersion:              strings.TrimSpace(input.targetVersion),
		PreviousVersion:            a.Version(),
		PreviousProcessStartedAtMs: a.ProcessStartedAtUnixMS(),
		PreviousRuntimeInstanceID:  a.InstanceID(),
		InstallDir:                 strings.TrimSpace(input.plan.installDir),
		ExePath:                    strings.TrimSpace(input.plan.exePath),
		Message:                    strings.TrimSpace(input.message),
		StartedAtMs:                now,
		UpdatedAtMs:                now,
	}
	if marker.Kind == syssvc.MaintenanceKindRestart {
		marker.TargetVersion = ""
	}
	if err := a.writeRuntimeMaintenanceMarker(marker); err != nil {
		a.log.Warn("runtime maintenance marker write failed", "kind", marker.Kind, "state", marker.State, "error", err)
	}
	a.maintenanceState.set(markerToMaintenanceSnapshot(marker))
}

func (a *Agent) markMaintenanceFailed(input runtimeMaintenanceFailureInput) {
	if a == nil {
		return
	}

	now := time.Now().UnixMilli()
	previous := a.CurrentMaintenanceSnapshot()
	startedAtMs := now
	if previous != nil && strings.TrimSpace(previous.Kind) == strings.TrimSpace(input.kind) && previous.StartedAtMs > 0 {
		startedAtMs = previous.StartedAtMs
	}

	marker := runtimeMaintenanceMarker{
		SchemaVersion:              runtimeMaintenanceMarkerSchemaVersion,
		Kind:                       strings.TrimSpace(input.kind),
		State:                      syssvc.MaintenanceStateFailed,
		TargetVersion:              strings.TrimSpace(input.targetVersion),
		PreviousVersion:            snapshotString(previous, func(s syssvc.MaintenanceSnapshot) string { return s.PreviousVersion }),
		ObservedVersion:            a.Version(),
		PreviousProcessStartedAtMs: snapshotInt(previous, func(s syssvc.MaintenanceSnapshot) int64 { return s.PreviousProcessStartedAtMs }),
		ObservedProcessStartedAtMs: a.ProcessStartedAtUnixMS(),
		PreviousRuntimeInstanceID:  snapshotString(previous, func(s syssvc.MaintenanceSnapshot) string { return s.PreviousRuntimeInstanceID }),
		ObservedRuntimeInstanceID:  a.InstanceID(),
		InstallDir:                 snapshotString(previous, func(s syssvc.MaintenanceSnapshot) string { return s.InstallDir }),
		ExePath:                    snapshotString(previous, func(s syssvc.MaintenanceSnapshot) string { return s.ExePath }),
		Message:                    strings.TrimSpace(input.message),
		ErrorCode:                  strings.TrimSpace(input.errorCode),
		StartedAtMs:                startedAtMs,
		UpdatedAtMs:                now,
		CompletedAtMs:              now,
	}
	if marker.Kind == syssvc.MaintenanceKindRestart {
		marker.TargetVersion = ""
	}
	if marker.PreviousVersion == "" {
		marker.PreviousVersion = a.Version()
	}
	if marker.PreviousProcessStartedAtMs <= 0 {
		marker.PreviousProcessStartedAtMs = a.ProcessStartedAtUnixMS()
	}
	if marker.PreviousRuntimeInstanceID == "" {
		marker.PreviousRuntimeInstanceID = a.InstanceID()
	}
	if err := a.writeRuntimeMaintenanceMarker(marker); err != nil {
		a.log.Warn("runtime maintenance marker write failed", "kind", marker.Kind, "state", marker.State, "error", err)
	}
	a.maintenanceState.set(markerToMaintenanceSnapshot(marker))
}

func snapshotString(snapshot *syssvc.MaintenanceSnapshot, pick func(syssvc.MaintenanceSnapshot) string) string {
	if snapshot == nil {
		return ""
	}
	return strings.TrimSpace(pick(*snapshot))
}

func snapshotInt(snapshot *syssvc.MaintenanceSnapshot, pick func(syssvc.MaintenanceSnapshot) int64) int64 {
	if snapshot == nil {
		return 0
	}
	return pick(*snapshot)
}

func (a *Agent) writeRuntimeMaintenanceMarker(marker runtimeMaintenanceMarker) error {
	if a == nil || a.maintenanceMarkerStore == nil {
		return nil
	}
	return a.maintenanceMarkerStore.write(marker)
}

func (a *Agent) reconcileRuntimeMaintenanceMarker() {
	if a == nil || a.maintenanceMarkerStore == nil {
		return
	}
	marker, err := a.maintenanceMarkerStore.read()
	if err != nil {
		a.log.Warn("runtime maintenance marker read failed", "error", err)
		quarantinePath, quarantineErr := a.maintenanceMarkerStore.quarantineUnreadable()
		if quarantineErr != nil {
			a.log.Warn("runtime maintenance marker quarantine failed", "error", quarantineErr)
		}
		now := time.Now().UnixMilli()
		message := "Runtime maintenance marker could not be read."
		if quarantinePath != "" {
			message = "Runtime maintenance marker could not be read and was moved aside."
		}
		a.maintenanceState.set(syssvc.MaintenanceSnapshot{
			Kind:                       syssvc.MaintenanceKindUpgrade,
			State:                      syssvc.MaintenanceStateFailed,
			ObservedVersion:            a.Version(),
			ObservedProcessStartedAtMs: a.ProcessStartedAtUnixMS(),
			ObservedRuntimeInstanceID:  a.InstanceID(),
			Message:                    message,
			ErrorCode:                  runtimeMaintenanceErrorMarkerUnreadable,
			StartedAtMs:                now,
			UpdatedAtMs:                now,
			CompletedAtMs:              now,
		})
		return
	}
	if marker == nil {
		return
	}
	if marker.State != syssvc.MaintenanceStateRunning {
		a.maintenanceState.set(markerToMaintenanceSnapshot(*marker))
		return
	}

	now := time.Now().UnixMilli()
	marker.ObservedVersion = a.Version()
	marker.ObservedProcessStartedAtMs = a.ProcessStartedAtUnixMS()
	marker.ObservedRuntimeInstanceID = a.InstanceID()
	marker.UpdatedAtMs = now
	marker.CompletedAtMs = now

	switch marker.Kind {
	case syssvc.MaintenanceKindUpgrade:
		if marker.TargetVersion != "" && marker.ObservedVersion != marker.TargetVersion {
			marker.State = syssvc.MaintenanceStateFailed
			marker.ErrorCode = runtimeMaintenanceErrorVersionMismatch
			observedVersion := marker.ObservedVersion
			if observedVersion == "" {
				observedVersion = "an unknown version"
			}
			marker.Message = fmt.Sprintf("Update did not take effect: Redeven is running %s instead of %s.", observedVersion, marker.TargetVersion)
		} else if !runtimeMaintenanceObservedNewIdentity(*marker) {
			marker.State = syssvc.MaintenanceStateFailed
			marker.ErrorCode = runtimeMaintenanceErrorIdentityMissing
			marker.Message = "Update could not be verified: the restarted runtime identity was not observable."
		} else {
			marker.State = syssvc.MaintenanceStateSucceeded
			marker.Message = successMaintenanceMessage(*marker)
		}
	case syssvc.MaintenanceKindRestart:
		marker.State = syssvc.MaintenanceStateSucceeded
		marker.Message = "Runtime restarted."
	default:
		marker.State = syssvc.MaintenanceStateFailed
		marker.ErrorCode = "unknown_kind"
		marker.Message = "Runtime maintenance marker has an unknown kind."
	}

	if err := a.writeRuntimeMaintenanceMarker(*marker); err != nil {
		a.log.Warn("runtime maintenance marker reconcile write failed", "kind", marker.Kind, "state", marker.State, "error", err)
	}
	a.maintenanceState.set(markerToMaintenanceSnapshot(*marker))
}

func runtimeMaintenanceObservedNewIdentity(marker runtimeMaintenanceMarker) bool {
	if marker.ObservedRuntimeInstanceID != "" {
		return marker.PreviousRuntimeInstanceID == "" || marker.ObservedRuntimeInstanceID != marker.PreviousRuntimeInstanceID
	}
	if marker.ObservedProcessStartedAtMs > 0 {
		return marker.PreviousProcessStartedAtMs <= 0 || marker.ObservedProcessStartedAtMs != marker.PreviousProcessStartedAtMs
	}
	return false
}

func successMaintenanceMessage(marker runtimeMaintenanceMarker) string {
	if marker.Kind == syssvc.MaintenanceKindUpgrade {
		if marker.ObservedVersion != "" {
			return "Redeven updated to " + marker.ObservedVersion + "."
		}
		return "Redeven update completed."
	}
	return "Runtime maintenance completed."
}
