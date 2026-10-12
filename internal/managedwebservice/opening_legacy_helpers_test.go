package managedwebservice

import (
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
	"strings"
)

// Frozen fixtures for the retired Host-only entrance writer and resolver.
func (d *hostScriptDriver) writeOpenSession(service *pfregistry.ManagedService, runtimeIdentity, appPath string) error {
	state := serviceOpenSessionState{SchemaVersion: serviceOpenSessionSchemaVersion, ServiceID: service.ServiceID, RuntimeSpecSHA256: service.RuntimeSpecSHA256, RuntimeIdentity: runtimeIdentity, AppPath: appPath, LaunchGeneration: runtimeIdentity}
	if run, err := d.readRunState(service); err == nil {
		state.OpeningRuleSHA256 = run.OpeningRuleSHA256
		state.ManagedBootstrap = run.ManagedBootstrap
	}
	launch := *service
	launch.RuntimeIdentity = runtimeIdentity
	return writePrivateJSON(d.openSessionPath(&launch), state)
}

func (d *hostScriptDriver) resolveOpenSession(service *pfregistry.ManagedService) (string, error) {
	if service == nil || strings.TrimSpace(service.RuntimeIdentity) == "" {
		return "", serviceError("HOST_OPEN_TARGET_UNAVAILABLE", "The Host service startup URL is unavailable. Retry opening the service.", 409, true, nil)
	}
	if _, running, err := d.recoverPersistedProcess(service); err != nil {
		return "", err
	} else if !running {
		return "", serviceError("SERVICE_NOT_RUNNING", "The service process is not running.", 409, true, nil)
	}
	return d.readOpenSession(service, service.RuntimeIdentity)
}

func (d *hostScriptDriver) readOpenSession(service *pfregistry.ManagedService, runtimeIdentity string) (string, error) {
	return d.readLegacyOpenSession(service, runtimeIdentity)
}
