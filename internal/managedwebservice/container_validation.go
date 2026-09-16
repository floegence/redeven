package managedwebservice

import (
	"strings"

	"github.com/floegence/redeven/internal/containerengine"
)

// Only fixed field names enter diagnostics; inspected values can contain
// private paths, credentials, or untrusted engine metadata.
type containerConfigurationMismatch struct{ fields []string }

func (e *containerConfigurationMismatch) Error() string {
	return "container configuration mismatch: " + strings.Join(e.fields, ", ")
}

func compareContainerRuntime(actual containerengine.RuntimeSummary, expected ContainerRuntimeSettings, networkMatches bool) error {
	fields := []string{}
	check := func(field string, matches bool) {
		if !matches {
			fields = append(fields, field)
		}
	}
	check("privileged", actual.Privileged == expected.Privileged)
	check("read_only_root", actual.ReadOnlyRoot == expected.ReadOnlyRoot)
	check("pids_limit", int64(actual.PIDsLimit) == expected.PIDsLimit)
	check("shm_size_bytes", (!privateNamespaceMode(expected.IPCMode) && expected.ShmSizeBytes == 0) || actual.ShmSizeBytes == expected.ShmSizeBytes)
	check("network_mode", networkMatches)
	check("pid_mode", namespaceModeMatches(actual.PIDMode, expected.PIDMode))
	check("ipc_mode", namespaceModeMatches(actual.IPCMode, expected.IPCMode))
	check("restart_policy", strings.TrimSpace(actual.RestartPolicy) == normalizedRestartPolicy(expected.RestartPolicy))
	check("user", strings.TrimSpace(actual.User) == strings.TrimSpace(expected.User))
	check("cap_add", sameStrings(actual.CapAdd, expected.CapAdd))
	check("cap_drop", sameStrings(actual.CapDrop, expected.CapDrop))
	check("security_opts", sameStrings(actual.SecurityOpts, expected.SecurityOpts))
	if len(fields) == 0 {
		return nil
	}
	return &containerConfigurationMismatch{fields: fields}
}
