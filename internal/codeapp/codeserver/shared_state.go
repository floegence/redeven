package codeserver

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"github.com/floegence/redeven/internal/lockfile"
)

const (
	localEnvironmentStateSchemaVersion = 1
)

type localEnvironmentRuntimeState struct {
	SchemaVersion   int                                       `json:"schema_version"`
	SelectedVersion string                                    `json:"selected_version,omitempty"`
	UpdatedAtUnixMs int64                                     `json:"updated_at_unix_ms,omitempty"`
	Versions        map[string]localEnvironmentRuntimeVersion `json:"versions,omitempty"`
}

type localEnvironmentRuntimeVersion struct {
	InstalledAtUnixMs int64  `json:"installed_at_unix_ms,omitempty"`
	BinaryRelPath     string `json:"binary_rel_path,omitempty"`
}

func normalizeLocalEnvironmentRuntimeState(state localEnvironmentRuntimeState) localEnvironmentRuntimeState {
	if state.SchemaVersion == 0 {
		state.SchemaVersion = localEnvironmentStateSchemaVersion
	}
	if state.Versions == nil {
		state.Versions = make(map[string]localEnvironmentRuntimeVersion)
	}
	for version, record := range state.Versions {
		cleanVersion := strings.TrimSpace(version)
		if cleanVersion == "" {
			delete(state.Versions, version)
			continue
		}
		record.BinaryRelPath = strings.TrimSpace(record.BinaryRelPath)
		if record.BinaryRelPath == "" {
			record.BinaryRelPath = filepath.Join("bin", codeServerBinaryName())
		}
		if cleanVersion != version {
			delete(state.Versions, version)
		}
		state.Versions[cleanVersion] = record
	}
	state.SelectedVersion = strings.TrimSpace(state.SelectedVersion)
	if state.SelectedVersion != "" {
		if _, ok := state.Versions[state.SelectedVersion]; !ok {
			state.SelectedVersion = ""
			state.UpdatedAtUnixMs = 0
		}
	}
	return state
}

func platformRuntimeSegment() string {
	return runtime.GOOS + "-" + runtime.GOARCH
}

func sharedRuntimeRoot(stateRoot string) string {
	return filepath.Join(strings.TrimSpace(stateRoot), "shared", "code-server", platformRuntimeSegment())
}

func sharedRuntimeLockPath(stateRoot string) string {
	return filepath.Join(sharedRuntimeRoot(stateRoot), "lock")
}

func sharedVersionsRoot(stateRoot string) string {
	return filepath.Join(sharedRuntimeRoot(stateRoot), "versions")
}

func sharedVersionRoot(stateRoot string, version string) string {
	return filepath.Join(sharedVersionsRoot(stateRoot), strings.TrimSpace(version))
}

func sharedStagingRoot(stateRoot string) string {
	return filepath.Join(sharedRuntimeRoot(stateRoot), "staging")
}

func sharedDownloadsRoot(stateRoot string) string {
	return filepath.Join(sharedRuntimeRoot(stateRoot), "downloads")
}

func sharedInstallerScriptPath(stateRoot string) string {
	return filepath.Join(sharedDownloadsRoot(stateRoot), "install.sh")
}

func managedRuntimePrefix(stateDir string) string {
	return filepath.Join(runtimeRoot(stateDir), "managed")
}

func ensureSharedRuntimeDirs(stateRoot string) error {
	root := strings.TrimSpace(stateRoot)
	if root == "" {
		return errors.New("missing state root")
	}
	for _, dir := range []string{
		sharedRuntimeRoot(root),
		sharedVersionsRoot(root),
		sharedStagingRoot(root),
		sharedDownloadsRoot(root),
	} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return err
		}
	}
	return nil
}

func loadLocalEnvironmentRuntimeState(stateRoot string) (localEnvironmentRuntimeState, error) {
	path := filepath.Join(sharedRuntimeRoot(stateRoot), "local-environment.json")
	body, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return normalizeLocalEnvironmentRuntimeState(localEnvironmentRuntimeState{}), nil
		}
		return localEnvironmentRuntimeState{}, err
	}
	var state localEnvironmentRuntimeState
	if err := json.Unmarshal(body, &state); err != nil {
		return localEnvironmentRuntimeState{}, err
	}
	return normalizeLocalEnvironmentRuntimeState(state), nil
}

func saveLocalEnvironmentRuntimeState(stateRoot string, state localEnvironmentRuntimeState) error {
	if err := ensureSharedRuntimeDirs(stateRoot); err != nil {
		return err
	}
	state = normalizeLocalEnvironmentRuntimeState(state)
	body, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(sharedRuntimeRoot(stateRoot), "local-environment.json")
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(body, '\n'), 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func withLocalEnvironmentRuntimeStateLock(stateRoot string, fn func(state *localEnvironmentRuntimeState) error) error {
	if err := ensureSharedRuntimeDirs(stateRoot); err != nil {
		return err
	}
	lockPath := sharedRuntimeLockPath(stateRoot)
	lk, err := lockfile.Acquire(lockPath)
	if err != nil {
		return err
	}
	defer func() { _ = lk.Release() }()

	state, err := loadLocalEnvironmentRuntimeState(stateRoot)
	if err != nil {
		return err
	}
	if fn != nil {
		if err := fn(&state); err != nil {
			return err
		}
	}
	return saveLocalEnvironmentRuntimeState(stateRoot, state)
}

func repairManagedRuntimeLink(stateDir string, stateRoot string, version string) error {
	linkPath := managedRuntimePrefix(stateDir)
	if err := os.MkdirAll(runtimeRoot(stateDir), 0o700); err != nil {
		return err
	}
	if err := removeIfExists(linkPath); err != nil {
		return err
	}
	version = strings.TrimSpace(version)
	if version == "" {
		return nil
	}
	target := sharedVersionRoot(stateRoot, version)
	if fi, err := os.Stat(target); err != nil || !fi.IsDir() {
		if err == nil {
			err = fmt.Errorf("%s is not a directory", target)
		}
		return err
	}
	return os.Symlink(target, linkPath)
}

func sortedInstalledVersions(state localEnvironmentRuntimeState) []string {
	out := make([]string, 0, len(state.Versions))
	for version := range state.Versions {
		if strings.TrimSpace(version) == "" {
			continue
		}
		out = append(out, version)
	}
	sort.Slice(out, func(i, j int) bool {
		return compareCodeServerVersions(out[i], out[j]) > 0
	})
	return out
}

func compareCodeServerVersions(left string, right string) int {
	leftParts := versionNumericParts(left)
	rightParts := versionNumericParts(right)
	maxLen := len(leftParts)
	if len(rightParts) > maxLen {
		maxLen = len(rightParts)
	}
	for i := 0; i < maxLen; i++ {
		var lv int
		if i < len(leftParts) {
			lv = leftParts[i]
		}
		var rv int
		if i < len(rightParts) {
			rv = rightParts[i]
		}
		switch {
		case lv > rv:
			return 1
		case lv < rv:
			return -1
		}
	}
	if left > right {
		return 1
	}
	if left < right {
		return -1
	}
	return 0
}

func versionNumericParts(raw string) []int {
	parts := strings.Split(strings.TrimSpace(raw), ".")
	out := make([]int, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			out = append(out, 0)
			continue
		}
		value := 0
		for _, r := range part {
			if r < '0' || r > '9' {
				break
			}
			value = value*10 + int(r-'0')
		}
		out = append(out, value)
	}
	return out
}
