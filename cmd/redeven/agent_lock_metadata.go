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
	PID                      int    `json:"pid,omitempty"`
	Mode                     string `json:"mode,omitempty"`
	InstanceID               string `json:"instance_id,omitempty"`
	StartedAtUnixMS          int64  `json:"started_at_unix_ms,omitempty"`
	RuntimeVersion           string `json:"runtime_version,omitempty"`
	RuntimeCommit            string `json:"runtime_commit,omitempty"`
	BinaryPath               string `json:"binary_path,omitempty"`
	DesktopManaged           bool   `json:"desktop_managed"`
	LocalUIEnabled           bool   `json:"local_ui_enabled"`
	ConfigPath               string `json:"config_path,omitempty"`
	StateRoot                string `json:"state_root,omitempty"`
	StateDir                 string `json:"state_dir,omitempty"`
	RuntimeControlSocketPath string `json:"runtime_control_socket_path,omitempty"`
}

func newAgentLockMetadata(mode string, instanceID string, desktopManaged bool, localUIEnabled bool, layout config.StateLayout) agentLockMetadata {
	cleanConfigPath := filepath.Clean(strings.TrimSpace(layout.ConfigPath))
	return agentLockMetadata{
		PID:                      os.Getpid(),
		Mode:                     strings.TrimSpace(mode),
		InstanceID:               strings.TrimSpace(instanceID),
		StartedAtUnixMS:          timeNowUnixMS(),
		RuntimeVersion:           Version,
		RuntimeCommit:            Commit,
		BinaryPath:               currentExecutablePathForCLI(),
		DesktopManaged:           desktopManaged,
		LocalUIEnabled:           localUIEnabled,
		ConfigPath:               cleanConfigPath,
		StateRoot:                filepath.Clean(strings.TrimSpace(layout.StateRoot)),
		StateDir:                 filepath.Dir(cleanConfigPath),
		RuntimeControlSocketPath: filepath.Clean(strings.TrimSpace(layout.RuntimeControlSocketPath)),
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
	metadata.InstanceID = strings.TrimSpace(metadata.InstanceID)
	metadata.RuntimeVersion = strings.TrimSpace(metadata.RuntimeVersion)
	metadata.RuntimeCommit = strings.TrimSpace(metadata.RuntimeCommit)
	metadata.BinaryPath = strings.TrimSpace(metadata.BinaryPath)
	metadata.ConfigPath = strings.TrimSpace(metadata.ConfigPath)
	metadata.StateRoot = strings.TrimSpace(metadata.StateRoot)
	metadata.StateDir = strings.TrimSpace(metadata.StateDir)
	metadata.RuntimeControlSocketPath = strings.TrimSpace(metadata.RuntimeControlSocketPath)
	return &metadata, nil
}

func lockOwnerFromMetadata(metadata *agentLockMetadata) *desktopLaunchLockOwner {
	if metadata == nil {
		return nil
	}
	return &desktopLaunchLockOwner{
		PID:                      metadata.PID,
		Mode:                     metadata.Mode,
		InstanceID:               metadata.InstanceID,
		StartedAtUnixMS:          metadata.StartedAtUnixMS,
		RuntimeVersion:           metadata.RuntimeVersion,
		RuntimeCommit:            metadata.RuntimeCommit,
		BinaryPath:               metadata.BinaryPath,
		DesktopManaged:           metadata.DesktopManaged,
		LocalUIEnabled:           metadata.LocalUIEnabled,
		ConfigPath:               metadata.ConfigPath,
		StateRoot:                metadata.StateRoot,
		StateDir:                 metadata.StateDir,
		RuntimeControlSocketPath: metadata.RuntimeControlSocketPath,
	}
}
