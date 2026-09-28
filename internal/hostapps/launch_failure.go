package hostapps

// LaunchFailureCode maps released native diagnostics to product recovery actions.
// Unknown diagnostics stay failures; they never imply an application exit.
func LaunchFailureCode(code string) string {
	switch code {
	case "APPLICATION_PLAN_STALE", "APPLICATION_PLAN_INVALID":
		return "plan_stale"
	case "PACKAGE_RUNTIME_UNAVAILABLE", "PACKAGE_PROBE_TIMEOUT":
		return "package_unavailable"
	case "HOST_SERVICE_UNAVAILABLE", "APPLICATION_HOST_SERVICE_UNAVAILABLE":
		return "host_service_unavailable"
	case "GRAPHICAL_BACKEND_UNAVAILABLE", "GRAPHICAL_BACKEND_UNSUPPORTED":
		return "graphics_unavailable"
	case "PACKAGE_METADATA_REQUIRED", "PACKAGE_METADATA_INVALID", "PACKAGE_LAUNCHER_MISMATCH", "PACKAGE_LAUNCHER_UNSUPPORTED", "PACKAGE_CONFINEMENT_UNSUPPORTED", "APPLICATION_LAUNCHER_UNSUPPORTED", "PACKAGE_INPUT_UNAVAILABLE":
		return "package_unsupported"
	default:
		return "launch_failed"
	}
}

// LaunchDiagnostic contains bounded protocol identifiers and an observed exit
// status. Child output, environment and application contents are never included.
type LaunchDiagnostic struct {
	Stage    string `json:"stage,omitempty"`
	Code     string `json:"code,omitempty"`
	ExitCode *int   `json:"exit_code,omitempty"`
}
