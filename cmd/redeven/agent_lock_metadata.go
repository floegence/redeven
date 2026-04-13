package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/lockfile"
)

type agentLockMetadata struct {
	PID              int    `json:"pid,omitempty"`
	Mode             string `json:"mode,omitempty"`
	ScopeKey         string `json:"scope_key,omitempty"`
	DesktopManaged   bool   `json:"desktop_managed"`
	LocalUIEnabled   bool   `json:"local_ui_enabled"`
	ConfigPath       string `json:"config_path,omitempty"`
	StateDir         string `json:"state_dir,omitempty"`
	RuntimeStatePath string `json:"runtime_state_path,omitempty"`
}

func newAgentLockMetadata(mode string, desktopManaged bool, localUIEnabled bool, layout config.StateLayout) agentLockMetadata {
	cleanConfigPath := filepath.Clean(strings.TrimSpace(layout.ConfigPath))
	cleanRuntimeStatePath := filepath.Clean(strings.TrimSpace(layout.RuntimeStatePath))
	return agentLockMetadata{
		PID:              os.Getpid(),
		Mode:             strings.TrimSpace(mode),
		ScopeKey:         strings.TrimSpace(layout.ScopeKey),
		DesktopManaged:   desktopManaged,
		LocalUIEnabled:   localUIEnabled,
		ConfigPath:       cleanConfigPath,
		StateDir:         filepath.Dir(cleanConfigPath),
		RuntimeStatePath: cleanRuntimeStatePath,
	}
}

func writeAgentLockMetadata(lk *lockfile.Lock, metadata agentLockMetadata) error {
	if lk == nil {
		return errors.New("lock is nil")
	}
	body, err := json.MarshalIndent(metadata, "", "  ")
	if err != nil {
		return err
	}
	body = append(body, '\n')
	return lk.SetContent(body)
}

func readAgentLockMetadata(path string) (*agentLockMetadata, error) {
	body, err := lockfile.ReadContent(path)
	if err != nil {
		return nil, err
	}
	var metadata agentLockMetadata
	if err := json.Unmarshal(body, &metadata); err != nil {
		return nil, err
	}
	metadata.Mode = strings.TrimSpace(metadata.Mode)
	metadata.ScopeKey = strings.TrimSpace(metadata.ScopeKey)
	metadata.ConfigPath = strings.TrimSpace(metadata.ConfigPath)
	metadata.StateDir = strings.TrimSpace(metadata.StateDir)
	metadata.RuntimeStatePath = strings.TrimSpace(metadata.RuntimeStatePath)
	return &metadata, nil
}

func lockOwnerFromMetadata(metadata *agentLockMetadata) *desktopLaunchLockOwner {
	if metadata == nil {
		return nil
	}
	return &desktopLaunchLockOwner{
		PID:              metadata.PID,
		Mode:             metadata.Mode,
		ScopeKey:         metadata.ScopeKey,
		DesktopManaged:   metadata.DesktopManaged,
		LocalUIEnabled:   metadata.LocalUIEnabled,
		ConfigPath:       metadata.ConfigPath,
		StateDir:         metadata.StateDir,
		RuntimeStatePath: metadata.RuntimeStatePath,
	}
}
