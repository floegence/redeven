package agentprotocol

import (
	"net/url"
	"strings"

	"github.com/floegence/redeven/internal/runtimemanagement"
)

const (
	TargetKindLocalHostRuntime      = "local_host_runtime"
	TargetKindLocalContainerRuntime = "local_container_runtime"
	TargetKindSSHEnvironment        = "ssh_environment"
	TargetKindSSHContainerRuntime   = "ssh_container_runtime"
	TargetKindProviderEnvironment   = "provider_environment"
	TargetKindGatewayEnvironment    = "gateway_environment"
	TargetKindExternalLocalUI       = "external_local_ui"

	TargetStatusUnsupported = "unsupported"

	EnvOperationStatus   = "status"
	EnvOperationDiagnose = "diagnose"
	EnvOperationStart    = "start"
	EnvOperationStop     = "stop"
	EnvOperationRestart  = "restart"
	EnvOperationUpdate   = "update"

	OperationAvailabilityAvailable   = "available"
	OperationAvailabilityBlocked     = "blocked"
	OperationAvailabilityUnavailable = "unavailable"
	OperationAvailabilityHidden      = "hidden"

	OperationMethodLocalHost                 = "local_host"
	OperationMethodSSHHost                   = "ssh_host"
	OperationMethodLocalContainerExec        = "local_container_exec"
	OperationMethodSSHContainerExec          = "ssh_container_exec"
	OperationMethodDesktopLocalUpdateHandoff = "desktop_local_update_handoff"
	OperationMethodRuntimeControlRPC         = "runtime_control_rpc"
	OperationMethodRuntimeGateway            = "runtime_gateway"
	OperationMethodProviderTunnel            = "provider_tunnel"
	OperationMethodNone                      = "none"

	EnvReasonUnsupportedTargetKind = "unsupported_target_kind"
	EnvReasonRuntimeNotStarted     = "runtime_not_started"
	EnvReasonRuntimeAlreadyRunning = "runtime_already_running"
	EnvReasonRuntimeOwnerExternal  = "runtime_owner_external"
	EnvReasonDesktopStartRequired  = "desktop_start_required"
	EnvReasonDesktopUpdateRequired = "desktop_update_required"
	EnvReasonCLIUpdateUnavailable  = "cli_update_unavailable"
)

type EnvironmentTargetResolution struct {
	RequestedTarget string           `json:"requested_target,omitempty"`
	Target          TargetDescriptor `json:"target"`
	Supported       bool             `json:"supported"`
	ReasonCode      string           `json:"reason_code,omitempty"`
	Message         string           `json:"message,omitempty"`
}

type EnvironmentStatus struct {
	Target      TargetDescriptor          `json:"target"`
	Supported   bool                      `json:"supported"`
	ReasonCode  string                    `json:"reason_code,omitempty"`
	Message     string                    `json:"message,omitempty"`
	Runtime     RuntimeStatusSummary      `json:"runtime"`
	Operations  EnvironmentOperationPlans `json:"operations"`
	Diagnostics *EnvironmentDiagnostics   `json:"diagnostics,omitempty"`
}

type RuntimeStatusSummary struct {
	State            string   `json:"state"`
	Message          string   `json:"message,omitempty"`
	Ready            bool     `json:"ready"`
	Running          bool     `json:"running"`
	DesktopManaged   bool     `json:"desktop_managed,omitempty"`
	RuntimeVersion   string   `json:"runtime_version,omitempty"`
	RuntimeCommit    string   `json:"runtime_commit,omitempty"`
	PID              int      `json:"pid,omitempty"`
	LocalUIURL       string   `json:"local_ui_url,omitempty"`
	LocalUIURLs      []string `json:"local_ui_urls,omitempty"`
	PasswordRequired bool     `json:"password_required,omitempty"`
	EffectiveRunMode string   `json:"effective_run_mode,omitempty"`
	RemoteEnabled    bool     `json:"remote_enabled,omitempty"`
	FailureCode      string   `json:"failure_code,omitempty"`
}

type EnvironmentDiagnostics struct {
	LockPath          string `json:"lock_path,omitempty"`
	ControlSocketPath string `json:"control_socket_path,omitempty"`
	LockPID           int    `json:"lock_pid,omitempty"`
	LockInstanceID    string `json:"lock_instance_id,omitempty"`
	PIDAlive          bool   `json:"pid_alive,omitempty"`
	SocketReachable   bool   `json:"socket_reachable,omitempty"`
	FailureCode       string `json:"failure_code,omitempty"`
}

type EnvironmentOperationPlans map[string]EnvironmentOperationPlan

type EnvironmentOperationPlan struct {
	Operation            string   `json:"operation"`
	Availability         string   `json:"availability"`
	Method               string   `json:"method"`
	Performed            bool     `json:"performed,omitempty"`
	RequiresConfirmation bool     `json:"requires_confirmation"`
	Label                string   `json:"label"`
	ReasonCode           string   `json:"reason_code,omitempty"`
	Message              string   `json:"message,omitempty"`
	Command              string   `json:"command,omitempty"`
	Argv                 []string `json:"argv,omitempty"`
	NextActions          []string `json:"next_actions,omitempty"`
}

type EnvironmentOperationResult struct {
	Target      TargetDescriptor         `json:"target"`
	Runtime     RuntimeStatusSummary     `json:"runtime"`
	Operation   EnvironmentOperationPlan `json:"operation"`
	Diagnostics *EnvironmentDiagnostics  `json:"diagnostics,omitempty"`
}

func ResolveEnvironmentTarget(catalog TargetCatalog, rawTarget string) (EnvironmentTargetResolution, error) {
	requested := strings.TrimSpace(rawTarget)
	target, err := ResolveTarget(catalog, requested)
	if err == nil {
		return EnvironmentTargetResolution{
			RequestedTarget: requested,
			Target:          sanitizeEnvironmentTarget(target),
			Supported:       true,
		}, nil
	}
	if requested == "" {
		return EnvironmentTargetResolution{}, err
	}
	if target, ok := recognizedUnsupportedEnvironmentTarget(requested); ok {
		return EnvironmentTargetResolution{
			RequestedTarget: requested,
			Target:          target,
			Supported:       false,
			ReasonCode:      EnvReasonUnsupportedTargetKind,
			Message:         unsupportedTargetMessage(target.Kind),
		}, nil
	}
	return EnvironmentTargetResolution{}, err
}

func EnvironmentTargetCatalog(catalog TargetCatalog) TargetCatalog {
	if len(catalog.Targets) == 0 {
		return TargetCatalog{}
	}
	out := TargetCatalog{Targets: make([]TargetDescriptor, 0, len(catalog.Targets))}
	for _, target := range catalog.Targets {
		out.Targets = append(out.Targets, sanitizeEnvironmentTarget(target))
	}
	return out
}

func EnvironmentStatusFromAttach(resolution EnvironmentTargetResolution, status runtimemanagement.RuntimeAttachStatus, includeDiagnostics bool) EnvironmentStatus {
	if !resolution.Supported {
		return UnsupportedEnvironmentStatus(resolution)
	}
	runtime := RuntimeStatusSummaryFromAttach(status)
	out := EnvironmentStatus{
		Target:     sanitizeEnvironmentTarget(resolution.Target),
		Supported:  true,
		Runtime:    runtime,
		Operations: EnvironmentOperationPlansFromRuntime(resolution.Target, status, runtime),
	}
	if includeDiagnostics {
		out.Diagnostics = EnvironmentDiagnosticsFromAttach(status)
	}
	return out
}

func UnsupportedEnvironmentStatus(resolution EnvironmentTargetResolution) EnvironmentStatus {
	runtime := RuntimeStatusSummary{
		State:       "unsupported",
		Message:     strings.TrimSpace(resolution.Message),
		FailureCode: strings.TrimSpace(resolution.ReasonCode),
	}
	if runtime.Message == "" {
		runtime.Message = unsupportedTargetMessage(resolution.Target.Kind)
	}
	if runtime.FailureCode == "" {
		runtime.FailureCode = EnvReasonUnsupportedTargetKind
	}
	return EnvironmentStatus{
		Target:     sanitizeEnvironmentTarget(resolution.Target),
		Supported:  false,
		ReasonCode: runtime.FailureCode,
		Message:    runtime.Message,
		Runtime:    runtime,
		Operations: UnsupportedEnvironmentOperationPlans(resolution.Target, runtime.Message),
	}
}

func EnvironmentOperationResultFromStatus(status EnvironmentStatus, operation EnvironmentOperationPlan, includeDiagnostics bool) EnvironmentOperationResult {
	out := EnvironmentOperationResult{
		Target:    sanitizeEnvironmentTarget(status.Target),
		Runtime:   status.Runtime,
		Operation: operation,
	}
	if includeDiagnostics {
		out.Diagnostics = status.Diagnostics
	}
	return out
}

func RuntimeStatusSummaryFromAttach(status runtimemanagement.RuntimeAttachStatus) RuntimeStatusSummary {
	state := strings.TrimSpace(string(status.State))
	if state == "" {
		state = string(runtimemanagement.AttachStateNotRunning)
	}
	endpoint := status.Endpoint
	runtimeVersion := strings.TrimSpace(status.Identity.RuntimeVersion)
	if runtimeVersion == "" {
		runtimeVersion = strings.TrimSpace(status.RuntimeService.RuntimeVersion)
	}
	runtimeCommit := strings.TrimSpace(status.Identity.RuntimeCommit)
	if runtimeCommit == "" {
		runtimeCommit = strings.TrimSpace(status.RuntimeService.RuntimeCommit)
	}
	summary := RuntimeStatusSummary{
		State:            state,
		Message:          strings.TrimSpace(status.Message),
		Ready:            status.State == runtimemanagement.AttachStateReady,
		Running:          runtimeAttachStateIsRunning(status.State),
		DesktopManaged:   status.Identity.DesktopManaged || status.RuntimeService.DesktopManaged,
		RuntimeVersion:   runtimeVersion,
		RuntimeCommit:    runtimeCommit,
		PID:              status.Identity.PID,
		EffectiveRunMode: strings.TrimSpace(status.RuntimeService.EffectiveRunMode),
		RemoteEnabled:    status.RuntimeService.RemoteEnabled,
		FailureCode:      strings.TrimSpace(status.Diagnostics.FailureCode),
	}
	if endpoint != nil {
		summary.LocalUIURL = strings.TrimSpace(endpoint.LocalUIURL)
		summary.LocalUIURLs = compactStrings(endpoint.LocalUIURLs)
		summary.PasswordRequired = endpoint.PasswordRequired
	}
	return summary
}

func EnvironmentDiagnosticsFromAttach(status runtimemanagement.RuntimeAttachStatus) *EnvironmentDiagnostics {
	diag := EnvironmentDiagnostics{
		LockPath:          strings.TrimSpace(status.Diagnostics.LockPath),
		ControlSocketPath: strings.TrimSpace(status.Diagnostics.ControlSocketPath),
		LockPID:           status.Diagnostics.LockPID,
		LockInstanceID:    strings.TrimSpace(status.Diagnostics.LockInstanceID),
		PIDAlive:          status.Diagnostics.PIDAlive,
		SocketReachable:   status.Diagnostics.SocketReachable,
		FailureCode:       strings.TrimSpace(status.Diagnostics.FailureCode),
	}
	if diag.LockPath == "" &&
		diag.ControlSocketPath == "" &&
		diag.LockPID == 0 &&
		diag.LockInstanceID == "" &&
		!diag.PIDAlive &&
		!diag.SocketReachable &&
		diag.FailureCode == "" {
		return nil
	}
	return &diag
}

func EnvironmentOperationPlansFromRuntime(target TargetDescriptor, status runtimemanagement.RuntimeAttachStatus, runtime RuntimeStatusSummary) EnvironmentOperationPlans {
	targetID := strings.TrimSpace(target.ID)
	if targetID == "" {
		targetID = "local:local"
	}
	plans := EnvironmentOperationPlans{
		EnvOperationStatus: operationPlan(EnvOperationStatus, OperationAvailabilityAvailable, OperationMethodLocalHost, "Check status", argvForEnvOperation(EnvOperationStatus, targetID)),
		EnvOperationDiagnose: operationPlan(
			EnvOperationDiagnose,
			OperationAvailabilityAvailable,
			OperationMethodLocalHost,
			"Diagnose runtime",
			argvForEnvOperation(EnvOperationDiagnose, targetID),
		),
	}
	plans[EnvOperationStop] = stopOperationPlan(status, runtime, targetID)
	plans[EnvOperationStart] = startOperationPlan(runtime, targetID)
	plans[EnvOperationRestart] = restartOperationPlan(runtime, targetID)
	plans[EnvOperationUpdate] = updateOperationPlan(runtime, targetID)
	return plans
}

func UnsupportedEnvironmentOperationPlans(target TargetDescriptor, message string) EnvironmentOperationPlans {
	targetID := strings.TrimSpace(target.ID)
	plans := EnvironmentOperationPlans{
		EnvOperationStatus: operationPlan(EnvOperationStatus, OperationAvailabilityAvailable, OperationMethodNone, "Check status", argvForEnvOperation(EnvOperationStatus, targetID)),
		EnvOperationDiagnose: operationPlan(
			EnvOperationDiagnose,
			OperationAvailabilityAvailable,
			OperationMethodNone,
			"Diagnose runtime",
			argvForEnvOperation(EnvOperationDiagnose, targetID),
		),
	}
	for _, operation := range []string{EnvOperationStart, EnvOperationStop, EnvOperationRestart, EnvOperationUpdate} {
		plan := operationPlan(operation, OperationAvailabilityUnavailable, OperationMethodNone, envOperationLabel(operation), nil)
		plan.ReasonCode = EnvReasonUnsupportedTargetKind
		plan.Message = strings.TrimSpace(message)
		plan.NextActions = []string{"Use Redeven Desktop for lifecycle actions for this target."}
		plans[operation] = plan
	}
	return plans
}

func MarkOperationPerformed(plan EnvironmentOperationPlan, message string) EnvironmentOperationPlan {
	plan.Performed = true
	plan.Availability = OperationAvailabilityAvailable
	plan.ReasonCode = ""
	if strings.TrimSpace(message) != "" {
		plan.Message = strings.TrimSpace(message)
	}
	return plan
}

func BlockedOperationPlan(operation string, method string, reasonCode string, message string) EnvironmentOperationPlan {
	plan := operationPlan(operation, OperationAvailabilityBlocked, method, envOperationLabel(operation), nil)
	plan.ReasonCode = strings.TrimSpace(reasonCode)
	plan.Message = strings.TrimSpace(message)
	return plan
}

func runtimeAttachStateIsRunning(state runtimemanagement.AttachState) bool {
	switch state {
	case runtimemanagement.AttachStateReady,
		runtimemanagement.AttachStateStarting,
		runtimemanagement.AttachStateBlocked,
		runtimemanagement.AttachStateUnhealthy,
		runtimemanagement.AttachStateLiveProcessWithoutSocket,
		runtimemanagement.AttachStateGenerationConflict:
		return true
	default:
		return false
	}
}

func stopOperationPlan(status runtimemanagement.RuntimeAttachStatus, runtime RuntimeStatusSummary, targetID string) EnvironmentOperationPlan {
	plan := operationPlan(EnvOperationStop, OperationAvailabilityAvailable, OperationMethodLocalHost, "Stop runtime", argvForEnvOperation(EnvOperationStop, targetID))
	if status.State == runtimemanagement.AttachStateNotRunning || status.State == "" {
		plan.Availability = OperationAvailabilityUnavailable
		plan.ReasonCode = EnvReasonRuntimeNotStarted
		plan.Message = "Runtime is not running."
		plan.Command = ""
		plan.Argv = nil
		return plan
	}
	if status.State == runtimemanagement.AttachStateStaleLock && !status.Identity.DesktopManaged {
		plan.Availability = OperationAvailabilityBlocked
		plan.ReasonCode = EnvReasonRuntimeOwnerExternal
		plan.Message = "The runtime lock is not owned by a Desktop-managed Redeven runtime; use the owning surface to clean it up."
		plan.Command = ""
		plan.Argv = nil
		return plan
	}
	if runtime.Running && !status.Identity.DesktopManaged {
		plan.Availability = OperationAvailabilityBlocked
		plan.ReasonCode = EnvReasonRuntimeOwnerExternal
		plan.Message = "A runtime appears to be running, but it is not Desktop-managed; use the owning runtime surface to stop it."
		plan.Command = ""
		plan.Argv = nil
		return plan
	}
	plan.RequiresConfirmation = runtime.Running
	return plan
}

func startOperationPlan(runtime RuntimeStatusSummary, targetID string) EnvironmentOperationPlan {
	plan := operationPlan(EnvOperationStart, OperationAvailabilityUnavailable, OperationMethodLocalHost, "Start runtime", nil)
	if runtime.Running || runtime.Ready {
		plan.ReasonCode = EnvReasonRuntimeAlreadyRunning
		plan.Message = "Runtime is already running."
		return plan
	}
	plan.ReasonCode = EnvReasonDesktopStartRequired
	plan.Message = "Start this runtime from Redeven Desktop. This CLI surface reports the required action but does not start Desktop runtime sessions in phase one."
	plan.NextActions = []string{"Use the Start Runtime action in Redeven Desktop."}
	_ = targetID
	return plan
}

func restartOperationPlan(runtime RuntimeStatusSummary, targetID string) EnvironmentOperationPlan {
	plan := operationPlan(EnvOperationRestart, OperationAvailabilityUnavailable, OperationMethodLocalHost, "Restart runtime", nil)
	plan.ReasonCode = EnvReasonDesktopStartRequired
	plan.Message = "Restart requires Redeven Desktop to start the runtime session after stop. This CLI surface reports the required action but does not restart Desktop runtime sessions in phase one."
	plan.NextActions = []string{"Use the Restart Runtime or Start Runtime action in Redeven Desktop."}
	_ = runtime
	_ = targetID
	return plan
}

func updateOperationPlan(runtime RuntimeStatusSummary, targetID string) EnvironmentOperationPlan {
	plan := operationPlan(EnvOperationUpdate, OperationAvailabilityUnavailable, OperationMethodDesktopLocalUpdateHandoff, "Update runtime", nil)
	if runtime.Running || runtime.Ready {
		plan.ReasonCode = EnvReasonDesktopUpdateRequired
		plan.Message = "Update this runtime through Redeven Desktop so bundled runtime compatibility and active work checks stay aligned."
		plan.NextActions = []string{"Use the Update Runtime or Update Redeven Desktop action when Redeven Desktop offers it."}
		return plan
	}
	plan.ReasonCode = EnvReasonCLIUpdateUnavailable
	plan.Message = "No CLI runtime update is available for this target in phase one."
	_ = targetID
	return plan
}

func operationPlan(operation string, availability string, method string, label string, argv []string) EnvironmentOperationPlan {
	argv = compactStrings(argv)
	return EnvironmentOperationPlan{
		Operation:    strings.TrimSpace(operation),
		Availability: strings.TrimSpace(availability),
		Method:       strings.TrimSpace(method),
		Label:        strings.TrimSpace(label),
		Command:      quoteArgv(argv),
		Argv:         append([]string(nil), argv...),
	}
}

func envOperationLabel(operation string) string {
	switch operation {
	case EnvOperationStatus:
		return "Check status"
	case EnvOperationDiagnose:
		return "Diagnose runtime"
	case EnvOperationStart:
		return "Start runtime"
	case EnvOperationStop:
		return "Stop runtime"
	case EnvOperationRestart:
		return "Restart runtime"
	case EnvOperationUpdate:
		return "Update runtime"
	default:
		return operation
	}
}

func argvForEnvOperation(operation string, targetID string) []string {
	operation = strings.TrimSpace(operation)
	targetID = strings.TrimSpace(targetID)
	if operation == "" {
		return nil
	}
	if targetID == "" {
		return []string{"redeven", "env", operation, "--json"}
	}
	return []string{"redeven", "env", operation, "--target", targetID, "--json"}
}

func quoteArgv(argv []string) string {
	argv = compactStrings(argv)
	if len(argv) == 0 {
		return ""
	}
	parts := make([]string, 0, len(argv))
	for _, arg := range argv {
		parts = append(parts, shellQuoteArg(arg))
	}
	return strings.Join(parts, " ")
}

func shellQuoteArg(arg string) string {
	arg = strings.TrimSpace(arg)
	if arg == "" {
		return "''"
	}
	if strings.IndexFunc(arg, func(r rune) bool {
		return !(r >= 'A' && r <= 'Z') &&
			!(r >= 'a' && r <= 'z') &&
			!(r >= '0' && r <= '9') &&
			!strings.ContainsRune("@%_+=:,./-", r)
	}) < 0 {
		return arg
	}
	return "'" + strings.ReplaceAll(arg, "'", "'\\''") + "'"
}

func recognizedUnsupportedEnvironmentTarget(rawTarget string) (TargetDescriptor, bool) {
	target := strings.TrimSpace(rawTarget)
	if target == "" {
		return TargetDescriptor{}, false
	}
	kind := recognizedUnsupportedEnvironmentKind(target)
	if kind == "" {
		return TargetDescriptor{}, false
	}
	return TargetDescriptor{
		ID:                    target,
		Kind:                  kind,
		Label:                 labelFromEnvironmentTarget(target),
		Status:                TargetStatusUnsupported,
		Capabilities:          []string{},
		UnavailableReasonCode: EnvReasonUnsupportedTargetKind,
	}, true
}

func recognizedUnsupportedEnvironmentKind(target string) string {
	lower := strings.ToLower(strings.TrimSpace(target))
	switch {
	case strings.HasPrefix(lower, "local:local:container:"), strings.HasPrefix(lower, "local:container:"):
		return TargetKindLocalContainerRuntime
	case strings.HasPrefix(lower, "local:local:host:"), strings.HasPrefix(lower, "local:host:"):
		return TargetKindLocalHostRuntime
	case strings.HasPrefix(lower, "ssh:container:"):
		return TargetKindSSHContainerRuntime
	case strings.HasPrefix(lower, "ssh:"):
		return TargetKindSSHEnvironment
	case strings.HasPrefix(lower, "provider:") && strings.Contains(lower, ":env:"):
		return TargetKindProviderEnvironment
	case strings.HasPrefix(lower, "gateway:"):
		return TargetKindGatewayEnvironment
	case strings.HasPrefix(lower, "external_local_ui:"), strings.HasPrefix(lower, "external:local-ui:"):
		return TargetKindExternalLocalUI
	default:
		return ""
	}
}

func sanitizeEnvironmentTarget(target TargetDescriptor) TargetDescriptor {
	target.StateRoot = ""
	target.StateDir = ""
	target.ConfigPath = ""
	target.RuntimeControlSocketPath = ""
	target.AgentHomeDir = ""
	return target
}

func unsupportedTargetMessage(kind string) string {
	switch strings.TrimSpace(kind) {
	case TargetKindLocalContainerRuntime:
		return "Redeven recognized this local container target, but CLI lifecycle execution for container placements is not available in phase one. Use Redeven Desktop for lifecycle actions."
	case TargetKindLocalHostRuntime:
		return "Redeven recognized this local host target, but only the default Local Environment is executable through `redeven env` in phase one."
	case TargetKindSSHEnvironment, TargetKindSSHContainerRuntime:
		return "Redeven recognized this SSH target, but SSH lifecycle execution is not available through `redeven env` in phase one. Use Redeven Desktop for lifecycle actions."
	case TargetKindProviderEnvironment:
		return "Redeven recognized this provider environment target, but provider lifecycle execution is not available through `redeven env` in phase one. Use Redeven Desktop or the provider surface."
	case TargetKindGatewayEnvironment:
		return "Redeven recognized this Gateway target, but Gateway lifecycle execution is not available through `redeven env` in phase one. Use the Gateway surface in Redeven Desktop."
	case TargetKindExternalLocalUI:
		return "Redeven recognized this external Local UI target, but external lifecycle execution is not owned by this CLI."
	default:
		return "Redeven recognized this target shape, but lifecycle execution is not available through `redeven env` in phase one."
	}
}

func labelFromEnvironmentTarget(target string) string {
	target = strings.TrimSpace(target)
	if target == "" {
		return "Unsupported environment target"
	}
	if idx := strings.LastIndex(strings.ToLower(target), ":env:"); idx >= 0 {
		if label := decodeTargetLabel(target[idx+len(":env:"):]); label != "" {
			return label
		}
	}
	parts := strings.Split(target, ":")
	for i := len(parts) - 1; i >= 0; i-- {
		if label := decodeTargetLabel(parts[i]); label != "" {
			return label
		}
	}
	return target
}

func decodeTargetLabel(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if decoded, err := url.PathUnescape(value); err == nil && strings.TrimSpace(decoded) != "" {
		return strings.TrimSpace(decoded)
	}
	return value
}
