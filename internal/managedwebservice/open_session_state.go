package managedwebservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

const serviceOpenSessionSchemaVersion = 1

type serviceOpenSessionState struct {
	SchemaVersion     int    `json:"schema_version"`
	ServiceID         string `json:"service_id"`
	RuntimeSpecSHA256 string `json:"runtime_spec_sha256"`
	RuntimeIdentity   string `json:"runtime_identity"`
	AppPath           string `json:"app_path"`
}

func readServiceOpening(path string, service *pfregistry.ManagedService, runtimeIdentity, prefix string) (string, error) {
	info, err := os.Lstat(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", serviceError(prefix+"_OPEN_TARGET_UNAVAILABLE", "The service opening URL is unavailable. Retry opening the service.", 409, true, nil)
		}
		return "", serviceError(prefix+"_OPEN_TARGET_UNAVAILABLE", "The service opening URL could not be read.", 500, true, err)
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 || info.Size() > 64*1024 {
		return "", serviceError(prefix+"_OPEN_TARGET_INVALID", "The saved service opening URL identity is invalid.", 409, true, nil)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", serviceError(prefix+"_OPEN_TARGET_UNAVAILABLE", "The service opening URL could not be read.", 500, true, err)
	}
	var state serviceOpenSessionState
	if err := decodeStrictJSON(raw, &state); err != nil || state.SchemaVersion != serviceOpenSessionSchemaVersion ||
		state.ServiceID != service.ServiceID || state.RuntimeSpecSHA256 != service.RuntimeSpecSHA256 ||
		state.RuntimeIdentity != strings.TrimSpace(runtimeIdentity) || !validServiceOpeningPath(state.AppPath, true) {
		return "", serviceError(prefix+"_OPEN_TARGET_INVALID", "The saved service opening URL identity is invalid.", 409, true, nil)
	}
	return state.AppPath, nil
}

func (m *Manager) staticOpeningDirectory(service *pfregistry.ManagedService) string {
	if m.stateDir == "" {
		return ""
	}
	owner := sha256.Sum256([]byte(service.ServiceID))
	return filepath.Join(m.stateDir, "apps", "managed-open-sessions", hex.EncodeToString(owner[:]))
}
func (m *Manager) staticOpeningPath(service *pfregistry.ManagedService) string {
	if m.staticOpeningDirectory(service) == "" {
		return ""
	}
	identity := sha256.Sum256([]byte(service.RuntimeIdentity + "\n" + service.RuntimeSpecSHA256))
	return filepath.Join(m.staticOpeningDirectory(service), hex.EncodeToString(identity[:])+".json")
}
func (m *Manager) saveStaticOpening(ctx context.Context, service *pfregistry.ManagedService) (string, error) {
	resolved, err := m.resolveCurrentRuntime(ctx, service)
	if err != nil {
		return "", err
	}
	appPath := resolved.Spec.Endpoint.Path
	if appPath == "" {
		appPath = "/"
	}
	if !validServiceOpeningPath(appPath, true) {
		return "", serviceError("SERVICE_OPEN_TARGET_INVALID", "The service opening path is invalid.", 409, true, nil)
	}
	directory := m.staticOpeningDirectory(service)
	if err := os.MkdirAll(directory, 0700); err != nil {
		return "", err
	}
	if err := privateDirectory(directory); err != nil {
		return "", err
	}
	state := serviceOpenSessionState{SchemaVersion: serviceOpenSessionSchemaVersion, ServiceID: service.ServiceID, RuntimeIdentity: service.RuntimeIdentity, RuntimeSpecSHA256: service.RuntimeSpecSHA256, AppPath: appPath}
	if err := writePrivateJSON(m.staticOpeningPath(service), state); err != nil {
		return "", serviceError("SERVICE_OPEN_TARGET_UNAVAILABLE", "The service opening path could not be saved.", 500, true, nil)
	}
	return appPath, nil
}
func (m *Manager) resolveStaticOpening(ctx context.Context, service *pfregistry.ManagedService) (string, error) {
	path := m.staticOpeningPath(service)
	if _, err := os.Lstat(path); errors.Is(err, os.ErrNotExist) {
		// Existing Container/Compose instances retain their historical static-template
		// opening behavior on first observation, then keep that verified entrance.
		return m.saveStaticOpening(ctx, service)
	}
	return readServiceOpening(path, service, service.RuntimeIdentity, "SERVICE")
}
