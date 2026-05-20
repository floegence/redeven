package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
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
	DesktopOwnerID           string `json:"desktop_owner_id,omitempty"`
	LocalUIEnabled           bool   `json:"local_ui_enabled"`
	ConfigPath               string `json:"config_path,omitempty"`
	StateRoot                string `json:"state_root,omitempty"`
	StateDir                 string `json:"state_dir,omitempty"`
	RuntimeControlSocketPath string `json:"runtime_control_socket_path,omitempty"`
}

func newAgentLockMetadata(mode string, instanceID string, desktopManaged bool, desktopOwnerID string, localUIEnabled bool, layout config.StateLayout) agentLockMetadata {
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
		DesktopOwnerID:           strings.TrimSpace(desktopOwnerID),
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
	trimmedBody := strings.TrimSpace(string(body))
	if trimmedBody == "" {
		return nil, errors.New("runtime lock has no active lease metadata")
	}
	var metadata agentLockMetadata
	if err := json.Unmarshal(body, &metadata); err != nil {
		pid, parseErr := strconv.Atoi(trimmedBody)
		if parseErr != nil || pid <= 0 {
			return nil, err
		}
		return &agentLockMetadata{PID: pid}, nil
	}
	metadata.Mode = strings.TrimSpace(metadata.Mode)
	metadata.InstanceID = strings.TrimSpace(metadata.InstanceID)
	metadata.RuntimeVersion = strings.TrimSpace(metadata.RuntimeVersion)
	metadata.RuntimeCommit = strings.TrimSpace(metadata.RuntimeCommit)
	metadata.BinaryPath = strings.TrimSpace(metadata.BinaryPath)
	metadata.DesktopOwnerID = strings.TrimSpace(metadata.DesktopOwnerID)
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
		DesktopOwnerID:           metadata.DesktopOwnerID,
		LocalUIEnabled:           metadata.LocalUIEnabled,
		ConfigPath:               metadata.ConfigPath,
		StateRoot:                metadata.StateRoot,
		StateDir:                 metadata.StateDir,
		RuntimeControlSocketPath: metadata.RuntimeControlSocketPath,
	}
}
