package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/floegence/redeven/internal/gatewaystate"
	"github.com/floegence/redeven/internal/lockfile"
	gatewaytrust "github.com/floegence/redeven/internal/runtimegateway/trust"
)

// Configuration recovery is an explicit host operation, never a startup fallback.
// Keep device identity and revocations; retain replaced configuration for recovery.
func (c *cli) configurationResetCmd(args []string) int {
	fs := newFlagSet("configuration-reset")
	root := fs.String("state-root", "", "Existing Gateway state root.")
	confirmed := fs.Bool("confirm", false, "Confirm rebuilding configuration and removing Runtime connections.")
	if err := parseFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, "redeven-gateway configuration-reset --state-root <path> --confirm\n")
			return 0
		}
		writeError(c.stderr, err.Error())
		return 2
	}
	if strings.TrimSpace(*root) == "" || !*confirmed {
		writeError(c.stderr, "configuration-reset requires an explicit state root and --confirm")
		return 2
	}
	resolved, err := filepath.Abs(*root)
	if err != nil {
		writeError(c.stderr, "invalid Gateway state root")
		return 2
	}
	archive, err := resetGatewayConfiguration(resolved)
	if err != nil {
		writeError(c.stderr, err.Error())
		return 1
	}
	if err := json.NewEncoder(c.stdout).Encode(map[string]any{"status": "configuration_reset", "state_root": resolved, "archive_path": archive, "identity_preserved": true}); err != nil {
		writeError(c.stderr, err.Error())
		return 1
	}
	return 0
}

func resetGatewayConfiguration(root string) (string, error) {
	info, err := os.Lstat(root)
	if err != nil {
		return "", err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("Gateway state root must be an existing directory")
	}
	// Refuse to create a new identity as a side effect of configuration recovery.
	identity, err := os.Lstat(filepath.Join(root, "gateway-trust.json"))
	if err != nil {
		return "", fmt.Errorf("existing Gateway identity is required: %w", err)
	}
	if !identity.Mode().IsRegular() || identity.Mode().Perm()&0077 != 0 {
		return "", errors.New("Gateway identity must be a private regular file")
	}
	serviceLock, err := lockfile.Acquire(filepath.Join(root, "gateway-service.lock"))
	if err != nil {
		return "", fmt.Errorf("stop Gateway before rebuilding configuration: %w", err)
	}
	defer serviceLock.Release()
	pending := filepath.Join(root, "configuration-reset.json")
	if _, err := os.Lstat(pending); err == nil {
		return "", errors.New("an interrupted configuration reset requires host inspection; consult configuration-reset.json before another reset")
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	if _, _, err := gatewaytrust.NewStore(filepath.Join(root, "gateway-trust.json")).GatewayMetadata(""); err != nil {
		return "", fmt.Errorf("existing Gateway identity is invalid; configuration was not changed: %w", err)
	}
	names := []string{"members.json", "environments.json", "membership-migration.json", "cloud-access.json", "host-operations.json", "policy-hooks.json"}
	present := []string{}
	for _, name := range names {
		entry, err := os.Lstat(filepath.Join(root, name))
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return "", err
		}
		if !entry.Mode().IsRegular() {
			return "", fmt.Errorf("%s must be a regular file; configuration was not changed", name)
		}
		present = append(present, name)
	}
	if len(present) == 0 {
		return "", errors.New("no Gateway configuration exists to rebuild")
	}
	history := filepath.Join(root, "configuration-history")
	if err := os.Mkdir(history, 0700); err != nil && !errors.Is(err, os.ErrExist) {
		return "", err
	}
	info, err = os.Lstat(history)
	if err != nil {
		return "", err
	}
	if !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return "", errors.New("configuration history must be a private directory")
	}
	archive, err := os.MkdirTemp(history, "reset-")
	if err != nil {
		return "", err
	}
	// Fence startup before the first move. A killed process must never expose a
	// partially reset configuration or silently replay an uncertain reset.
	if err := gatewaystate.Write(pending, map[string]any{"schema_version": 1, "archive_path": archive, "files": present}); err != nil {
		return "", fmt.Errorf("could not record configuration reset; inspect %s: %w", pending, err)
	}
	moved := []string{}
	for _, name := range present {
		if err := os.Rename(filepath.Join(root, name), filepath.Join(archive, name)); err != nil {
			failures := []error{err}
			for i := len(moved) - 1; i >= 0; i-- {
				if restore := os.Rename(filepath.Join(archive, moved[i]), filepath.Join(root, moved[i])); restore != nil {
					failures = append(failures, restore)
				}
			}
			if len(failures) == 1 {
				if restoreErr := syncConfigurationResetDirectories(root, archive); restoreErr == nil {
					if clearErr := os.Remove(pending); clearErr == nil {
						_ = os.Remove(archive)
						return "", fmt.Errorf("configuration reset failed; original configuration was restored: %w", err)
					}
				}
			}
			return "", fmt.Errorf("configuration reset failed; retained files are in %s: %w", archive, errors.Join(failures...))
		}
		moved = append(moved, name)
	}
	if err := syncConfigurationResetDirectories(archive, history, root); err != nil {
		return "", fmt.Errorf("configuration retained in %s; reset remains fenced for host inspection: %w", archive, err)
	}
	if err := os.Remove(pending); err != nil {
		return "", err
	}
	if err := syncConfigurationResetDirectories(root); err != nil {
		return "", fmt.Errorf("configuration retained in %s; reset completion durability could not be verified: %w", archive, err)
	}
	return archive, nil
}

func syncConfigurationResetDirectories(paths ...string) error {
	for _, dir := range paths {
		file, err := os.Open(dir)
		if err != nil {
			return err
		}
		if err := errors.Join(file.Sync(), file.Close()); err != nil {
			return err
		}
	}
	return nil
}
