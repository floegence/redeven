package runtimeservice

import "strings"

const ProtocolVersion = "redeven-runtime-v1"

type Owner string

const (
	OwnerDesktop  Owner = "desktop"
	OwnerExternal Owner = "external"
	OwnerUnknown  Owner = "unknown"
)

type Compatibility string

const (
	CompatibilityCompatible            Compatibility = "compatible"
	CompatibilityUpdateAvailable       Compatibility = "update_available"
	CompatibilityRestartRecommended    Compatibility = "restart_recommended"
	CompatibilityUpdateRequired        Compatibility = "update_required"
	CompatibilityDesktopUpdateRequired Compatibility = "desktop_update_required"
	CompatibilityManagedElsewhere      Compatibility = "managed_elsewhere"
	CompatibilityUnknown               Compatibility = "unknown"
)

type Workload struct {
	TerminalCount    int `json:"terminal_count"`
	SessionCount     int `json:"session_count"`
	TaskCount        int `json:"task_count"`
	PortForwardCount int `json:"port_forward_count"`
}

type Snapshot struct {
	RuntimeVersion        string        `json:"runtime_version,omitempty"`
	RuntimeCommit         string        `json:"runtime_commit,omitempty"`
	RuntimeBuildTime      string        `json:"runtime_build_time,omitempty"`
	ProtocolVersion       string        `json:"protocol_version,omitempty"`
	CompatibilityEpoch    int           `json:"compatibility_epoch,omitempty"`
	ServiceOwner          Owner         `json:"service_owner,omitempty"`
	DesktopManaged        bool          `json:"desktop_managed"`
	EffectiveRunMode      string        `json:"effective_run_mode,omitempty"`
	RemoteEnabled         bool          `json:"remote_enabled"`
	Compatibility         Compatibility `json:"compatibility,omitempty"`
	CompatibilityMessage  string        `json:"compatibility_message,omitempty"`
	MinimumDesktopVersion string        `json:"minimum_desktop_version,omitempty"`
	MinimumRuntimeVersion string        `json:"minimum_runtime_version,omitempty"`
	CompatibilityReviewID string        `json:"compatibility_review_id,omitempty"`
	ActiveWorkload        Workload      `json:"active_workload"`
}

// NormalizeSnapshotForEndpoint applies endpoint-level facts that older or
// partial carriers may not include before the canonical snapshot normalization.
func NormalizeSnapshotForEndpoint(snapshot Snapshot, desktopManaged bool, effectiveRunMode string, remoteEnabled bool) Snapshot {
	owner := strings.TrimSpace(string(snapshot.ServiceOwner))
	if desktopManaged && (owner == "" || owner == string(OwnerUnknown)) {
		snapshot.DesktopManaged = true
		snapshot.ServiceOwner = OwnerDesktop
	}
	if strings.TrimSpace(snapshot.EffectiveRunMode) == "" {
		snapshot.EffectiveRunMode = strings.TrimSpace(effectiveRunMode)
	}
	snapshot.RemoteEnabled = snapshot.RemoteEnabled || remoteEnabled
	return NormalizeSnapshot(snapshot)
}

func UnknownSnapshot() Snapshot {
	return Snapshot{
		ProtocolVersion: ProtocolVersion,
		ServiceOwner:    OwnerUnknown,
		Compatibility:   CompatibilityUnknown,
	}
}

func NormalizeSnapshot(snapshot Snapshot) Snapshot {
	snapshot.RuntimeVersion = strings.TrimSpace(snapshot.RuntimeVersion)
	snapshot.RuntimeCommit = strings.TrimSpace(snapshot.RuntimeCommit)
	snapshot.RuntimeBuildTime = strings.TrimSpace(snapshot.RuntimeBuildTime)
	snapshot.ProtocolVersion = strings.TrimSpace(snapshot.ProtocolVersion)
	if snapshot.ProtocolVersion == "" {
		snapshot.ProtocolVersion = ProtocolVersion
	}
	if snapshot.CompatibilityEpoch < 0 {
		snapshot.CompatibilityEpoch = 0
	}
	snapshot.ServiceOwner = Owner(strings.TrimSpace(string(snapshot.ServiceOwner)))
	switch snapshot.ServiceOwner {
	case OwnerDesktop, OwnerExternal, OwnerUnknown:
	default:
		if snapshot.DesktopManaged {
			snapshot.ServiceOwner = OwnerDesktop
		} else {
			snapshot.ServiceOwner = OwnerUnknown
		}
	}
	snapshot.EffectiveRunMode = strings.TrimSpace(snapshot.EffectiveRunMode)
	snapshot.Compatibility = Compatibility(strings.TrimSpace(string(snapshot.Compatibility)))
	switch snapshot.Compatibility {
	case CompatibilityCompatible,
		CompatibilityUpdateAvailable,
		CompatibilityRestartRecommended,
		CompatibilityUpdateRequired,
		CompatibilityDesktopUpdateRequired,
		CompatibilityManagedElsewhere,
		CompatibilityUnknown:
	default:
		snapshot.Compatibility = CompatibilityUnknown
	}
	snapshot.CompatibilityMessage = strings.TrimSpace(snapshot.CompatibilityMessage)
	snapshot.MinimumDesktopVersion = strings.TrimSpace(snapshot.MinimumDesktopVersion)
	snapshot.MinimumRuntimeVersion = strings.TrimSpace(snapshot.MinimumRuntimeVersion)
	snapshot.CompatibilityReviewID = strings.TrimSpace(snapshot.CompatibilityReviewID)
	snapshot.ActiveWorkload.TerminalCount = normalizeCount(snapshot.ActiveWorkload.TerminalCount)
	snapshot.ActiveWorkload.SessionCount = normalizeCount(snapshot.ActiveWorkload.SessionCount)
	snapshot.ActiveWorkload.TaskCount = normalizeCount(snapshot.ActiveWorkload.TaskCount)
	snapshot.ActiveWorkload.PortForwardCount = normalizeCount(snapshot.ActiveWorkload.PortForwardCount)
	return snapshot
}

func normalizeCount(value int) int {
	if value < 0 {
		return 0
	}
	return value
}
