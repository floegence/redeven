// Package storagecontract owns Redeven's product placement, never upstream formats.
package storagecontract

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const PluginRelative = "apps/plugins/platform"
const SkillsRelative = "apps/skills"

func PluginRoot(stateDir string) string {
	return filepath.Join(stateDir, filepath.FromSlash(PluginRelative))
}
func SkillsRoot(stateDir string) string {
	return filepath.Join(stateDir, filepath.FromSlash(SkillsRelative))
}

// IMPORTANT: Upstream Host data belongs in its own opaque root. Never pass the
// Environment root to ReDevPlugin or silently open an empty replacement beside
// legacy data. The offline pre-release relocation tool is the only old-layout
// writer; normal startup never migrates or interprets upstream bytes.
func CheckPluginPlacement(stateDir string) error {
	if err := CheckRelocation(stateDir); err != nil {
		return err
	}
	for _, name := range []string{"control.sqlite", "control.sqlite-wal", "control.sqlite-shm", "control.sqlite-journal", "plugin-data", "external-inspections", "secrets.sqlite", "secrets.sqlite-wal", "secrets.sqlite-shm", "secrets.sqlite-journal", "observability.sqlite", "observability.sqlite-wal", "observability.sqlite-shm", "observability.sqlite-journal", "assets", "runtime-exec", "author-workspaces", "release-artifacts", "trust"} {
		if _, err := os.Lstat(filepath.Join(stateDir, name)); err == nil {
			return fmt.Errorf("legacy plugin storage %s requires offline relocation with scripts/relocate_prerelease_storage.py; existing data is unchanged", name)
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return checkDirectories(stateDir, []string{"apps", "apps/plugins", PluginRelative})
}

func checkDirectories(stateDir string, names []string) error {
	for _, name := range names {
		info, err := os.Lstat(filepath.Join(stateDir, filepath.FromSlash(name)))
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("storage ancestor %s must be a real directory", name)
		}
	}
	return nil
}

// IMPORTANT: Refuse retired metadata before starting Flower; an empty managed
// catalog must never silently replace retained enablement/source decisions.
func CheckSkillsPlacement(stateDir string) error {
	if err := CheckRelocation(stateDir); err != nil {
		return err
	}
	for _, name := range []string{"skills_state.json", "skills_sources.json"} {
		if _, err := os.Lstat(filepath.Join(stateDir, name)); err == nil {
			return fmt.Errorf("legacy skills storage requires offline relocation with scripts/relocate_prerelease_storage.py")
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	// IMPORTANT: Managed skills and their decisions belong to this Environment.
	// Reject placement aliases before any owner opens a store; user_agents is an
	// explicitly external scope and is not subject to this managed-root gate.
	if err := checkDirectories(stateDir, []string{"apps", SkillsRelative, SkillsRelative + "/packages"}); err != nil {
		return err
	}
	for _, name := range []string{"state.json", "sources.json", "state.json.tmp", "sources.json.tmp"} {
		info, err := os.Lstat(filepath.Join(SkillsRoot(stateDir), name))
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("managed skill metadata %s must be a regular file", name)
		}
	}
	return nil
}

func CheckRelocation(stateDir string) error {
	path := filepath.Join(stateDir, "storage-relocation.json")
	if info, err := os.Lstat(path); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	} else if !info.Mode().IsRegular() {
		return errors.New("invalid storage relocation journal")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var record struct {
		Version int    `json:"version"`
		Status  string `json:"status"`
	}
	if json.Unmarshal(raw, &record) != nil || record.Version != 1 || record.Status != "complete" {
		return errors.New("storage relocation is incomplete; resume the offline relocation before opening feature stores")
	}
	return nil
}
