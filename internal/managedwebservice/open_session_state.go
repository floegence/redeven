package managedwebservice

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

const serviceOpenSessionSchemaVersion = 2

type serviceOpenSessionState struct {
	SchemaVersion     int    `json:"schema_version"`
	ServiceID         string `json:"service_id"`
	RuntimeSpecSHA256 string `json:"runtime_spec_sha256"`
	RuntimeIdentity   string `json:"runtime_identity"`
	AppPath           string `json:"app_path"`
	LaunchGeneration  string `json:"launch_generation,omitempty"`
	OpeningRuleSHA256 string `json:"opening_rule_sha256,omitempty"`
	ManagedBootstrap  bool   `json:"managed_bootstrap,omitempty"`
	ErrorCode         string `json:"error_code,omitempty"`
	ErrorMessage      string `json:"error_message,omitempty"`
}

func readLegacyHostOpening(path string, service *pfregistry.ManagedService, runtimeIdentity string) (string, error) {
	info, err := os.Lstat(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", serviceError("HOST_OPEN_TARGET_UNAVAILABLE", "The service opening URL is unavailable. Retry opening the service.", 409, true, nil)
		}
		return "", serviceError("HOST_OPEN_TARGET_UNAVAILABLE", "The service opening URL could not be read.", 500, true, err)
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 || info.Size() > 64*1024 {
		return "", serviceError("HOST_OPEN_TARGET_INVALID", "The saved service opening URL identity is invalid.", 409, true, nil)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", serviceError("HOST_OPEN_TARGET_UNAVAILABLE", "The service opening URL could not be read.", 500, true, err)
	}
	var state serviceOpenSessionState
	if err := decodeStrictJSON(raw, &state); err != nil || (state.SchemaVersion != 1 && state.SchemaVersion != serviceOpenSessionSchemaVersion) ||
		state.ServiceID != service.ServiceID || state.RuntimeSpecSHA256 != service.RuntimeSpecSHA256 ||
		state.RuntimeIdentity != strings.TrimSpace(runtimeIdentity) || !validServiceOpeningPath(state.AppPath, true) {
		return "", serviceError("HOST_OPEN_TARGET_INVALID", "The saved service opening URL identity is invalid.", 409, true, nil)
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
