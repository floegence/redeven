package runtimeservice

import (
	"sort"
	"strings"
)

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

type OpenReadinessState string

const (
	OpenReadinessStarting OpenReadinessState = "starting"
	OpenReadinessOpenable OpenReadinessState = "openable"
	OpenReadinessBlocked  OpenReadinessState = "blocked"
)

const (
	OpenReadinessReasonEnvAppShellUnavailable = "env_app_shell_unavailable"
)

type OpenReadiness struct {
	State      OpenReadinessState `json:"state"`
	ReasonCode string             `json:"reason_code,omitempty"`
	Message    string             `json:"message,omitempty"`
}

type Workload struct {
	TerminalCount    int `json:"terminal_count"`
	SessionCount     int `json:"session_count"`
	TaskCount        int `json:"task_count"`
	PortForwardCount int `json:"port_forward_count"`
}

const RuntimeControlBindMethodV1 = "runtime_control_v1"

type Capability struct {
	Supported  bool   `json:"supported"`
	BindMethod string `json:"bind_method,omitempty"`
	ReasonCode string `json:"reason_code,omitempty"`
	Message    string `json:"message,omitempty"`
}

type Capabilities struct {
	DesktopAIBroker Capability `json:"desktop_ai_broker"`
}

type BindingState string

const (
	BindingStateUnbound     BindingState = "unbound"
	BindingStateBound       BindingState = "bound"
	BindingStateUnsupported BindingState = "unsupported"
	BindingStateError       BindingState = "error"
	BindingStateExpired     BindingState = "expired"
)

type Binding struct {
	State                 BindingState `json:"state"`
	SessionID             string       `json:"session_id,omitempty"`
	SSHRuntimeKey         string       `json:"ssh_runtime_key,omitempty"`
	ExpiresAtUnixMS       int64        `json:"expires_at_unix_ms,omitempty"`
	ModelSource           string       `json:"model_source,omitempty"`
	ModelCount            int          `json:"model_count,omitempty"`
	MissingKeyProviderIDs []string     `json:"missing_key_provider_ids,omitempty"`
	LastError             string       `json:"last_error,omitempty"`
}

type Bindings struct {
	DesktopAIBroker Binding `json:"desktop_ai_broker"`
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
	OpenReadiness         OpenReadiness `json:"open_readiness"`
	ActiveWorkload        Workload      `json:"active_workload"`
	Capabilities          Capabilities  `json:"capabilities"`
	Bindings              Bindings      `json:"bindings"`
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
		OpenReadiness: OpenReadiness{
			State:      OpenReadinessStarting,
			ReasonCode: "runtime_service_unknown",
			Message:    "Runtime Service readiness is not available yet.",
		},
	}
}

func EnvAppShellUnavailableReadiness() OpenReadiness {
	return OpenReadiness{
		State:      OpenReadinessBlocked,
		ReasonCode: OpenReadinessReasonEnvAppShellUnavailable,
		Message:    "The Environment App shell is not available in this runtime build. Install the update, then restart the runtime when it is safe to interrupt active work.",
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
	snapshot.OpenReadiness = NormalizeOpenReadiness(snapshot.OpenReadiness, snapshot)
	snapshot.ActiveWorkload.TerminalCount = normalizeCount(snapshot.ActiveWorkload.TerminalCount)
	snapshot.ActiveWorkload.SessionCount = normalizeCount(snapshot.ActiveWorkload.SessionCount)
	snapshot.ActiveWorkload.TaskCount = normalizeCount(snapshot.ActiveWorkload.TaskCount)
	snapshot.ActiveWorkload.PortForwardCount = normalizeCount(snapshot.ActiveWorkload.PortForwardCount)
	snapshot.Capabilities = NormalizeCapabilities(snapshot.Capabilities)
	snapshot.Bindings = NormalizeBindings(snapshot.Bindings, snapshot.Capabilities)
	return snapshot
}

func NormalizeCapabilities(capabilities Capabilities) Capabilities {
	capabilities.DesktopAIBroker = NormalizeCapability(capabilities.DesktopAIBroker)
	return capabilities
}

func NormalizeCapability(capability Capability) Capability {
	capability.BindMethod = strings.TrimSpace(capability.BindMethod)
	capability.ReasonCode = strings.TrimSpace(capability.ReasonCode)
	capability.Message = strings.TrimSpace(capability.Message)
	if !capability.Supported {
		capability.BindMethod = ""
	}
	if capability.Supported && capability.BindMethod == "" {
		capability.BindMethod = RuntimeControlBindMethodV1
	}
	return capability
}

func NormalizeBindings(bindings Bindings, capabilities Capabilities) Bindings {
	bindings.DesktopAIBroker = NormalizeBinding(bindings.DesktopAIBroker, capabilities.DesktopAIBroker)
	return bindings
}

func NormalizeBinding(binding Binding, capability Capability) Binding {
	binding.State = BindingState(strings.TrimSpace(string(binding.State)))
	binding.SessionID = strings.TrimSpace(binding.SessionID)
	binding.SSHRuntimeKey = strings.TrimSpace(binding.SSHRuntimeKey)
	binding.ModelSource = strings.TrimSpace(binding.ModelSource)
	binding.LastError = strings.TrimSpace(binding.LastError)
	if binding.ExpiresAtUnixMS < 0 {
		binding.ExpiresAtUnixMS = 0
	}
	binding.ModelCount = normalizeCount(binding.ModelCount)
	binding.MissingKeyProviderIDs = compactSortedStrings(binding.MissingKeyProviderIDs)

	if !capability.Supported {
		binding.State = BindingStateUnsupported
		return binding
	}
	switch binding.State {
	case BindingStateUnbound, BindingStateBound, BindingStateUnsupported, BindingStateError, BindingStateExpired:
	default:
		binding.State = BindingStateUnbound
	}
	if binding.State == BindingStateUnsupported {
		binding.State = BindingStateUnbound
	}
	return binding
}

func NormalizeOpenReadiness(readiness OpenReadiness, snapshot Snapshot) OpenReadiness {
	readiness.State = OpenReadinessState(strings.TrimSpace(string(readiness.State)))
	readiness.ReasonCode = strings.TrimSpace(readiness.ReasonCode)
	readiness.Message = strings.TrimSpace(readiness.Message)

	switch readiness.State {
	case OpenReadinessStarting, OpenReadinessOpenable, OpenReadinessBlocked:
	default:
		readiness = inferredOpenReadiness(snapshot)
	}
	if readiness.State == OpenReadinessOpenable {
		readiness.ReasonCode = ""
		readiness.Message = ""
	}
	if readiness.State == OpenReadinessStarting && readiness.ReasonCode == "" {
		readiness.ReasonCode = "runtime_service_starting"
	}
	if readiness.State == OpenReadinessBlocked && readiness.ReasonCode == "" {
		readiness.ReasonCode = "runtime_service_blocked"
	}
	return readiness
}

func inferredOpenReadiness(snapshot Snapshot) OpenReadiness {
	if strings.TrimSpace(snapshot.ProtocolVersion) == "" {
		return OpenReadiness{
			State:      OpenReadinessStarting,
			ReasonCode: "runtime_protocol_missing",
			Message:    "Runtime Service protocol metadata is not available yet.",
		}
	}
	switch snapshot.Compatibility {
	case CompatibilityUpdateRequired:
		return OpenReadiness{
			State:      OpenReadinessBlocked,
			ReasonCode: "runtime_update_required",
			Message:    firstNonEmpty(snapshot.CompatibilityMessage, "Update the runtime before opening this environment."),
		}
	case CompatibilityDesktopUpdateRequired:
		return OpenReadiness{
			State:      OpenReadinessBlocked,
			ReasonCode: "desktop_update_required",
			Message:    firstNonEmpty(snapshot.CompatibilityMessage, "Update Desktop before opening this environment."),
		}
	case CompatibilityManagedElsewhere:
		return OpenReadiness{
			State:      OpenReadinessBlocked,
			ReasonCode: "runtime_managed_elsewhere",
			Message:    firstNonEmpty(snapshot.CompatibilityMessage, "This runtime is managed by another Desktop instance."),
		}
	default:
		return OpenReadiness{State: OpenReadinessOpenable}
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

func normalizeCount(value int) int {
	if value < 0 {
		return 0
	}
	return value
}

func compactSortedStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
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
