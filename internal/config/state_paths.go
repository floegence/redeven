package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

var ErrHomeDirUnavailable = errors.New("user home directory is unavailable")

var userHomeDir = os.UserHomeDir

type StateLayout struct {
	ConfigPath       string
	StateDir         string
	RuntimeStatePath string
	DiagnosticsDir   string
}

func DefaultConfigPath() (string, error) {
	layout, err := DefaultStateLayout()
	if err != nil {
		return "", err
	}
	return layout.ConfigPath, nil
}

// DefaultStateLayout returns the default state layout rooted under ~/.redeven.
func DefaultStateLayout() (StateLayout, error) {
	stateRoot, err := defaultStateRoot()
	if err != nil {
		return StateLayout{}, err
	}
	return StateLayoutForConfigPath(filepath.Join(stateRoot, "config.json"))
}

func EnvConfigPath(envID string) (string, error) {
	layout, err := EnvStateLayout(envID)
	if err != nil {
		return "", err
	}
	return layout.ConfigPath, nil
}

// EnvStateLayout returns a per-environment state layout rooted under ~/.redeven/envs/<env_public_id>.
func EnvStateLayout(envID string) (StateLayout, error) {
	id := strings.TrimSpace(envID)
	if id == "" {
		return DefaultStateLayout()
	}

	stateRoot, err := defaultStateRoot()
	if err != nil {
		return StateLayout{}, err
	}
	return StateLayoutForConfigPath(filepath.Join(stateRoot, "envs", sanitizeStateScopeID(id), "config.json"))
}

// StateLayoutForConfigPath normalizes an explicit config path and derives the matching state layout.
func StateLayoutForConfigPath(configPath string) (StateLayout, error) {
	cleanPath := strings.TrimSpace(configPath)
	if cleanPath == "" {
		return StateLayout{}, errors.New("missing config path")
	}

	absPath, err := filepath.Abs(cleanPath)
	if err != nil {
		return StateLayout{}, fmt.Errorf("resolve config path %q: %w", cleanPath, err)
	}
	stateDir := filepath.Dir(absPath)
	return StateLayout{
		ConfigPath:       absPath,
		StateDir:         stateDir,
		RuntimeStatePath: filepath.Join(stateDir, "runtime", "local-ui.json"),
		DiagnosticsDir:   filepath.Join(stateDir, "diagnostics"),
	}, nil
}

func defaultStateRoot() (string, error) {
	home, err := userHomeDir()
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrHomeDirUnavailable, err)
	}
	cleanHome := strings.TrimSpace(home)
	if cleanHome == "" {
		return "", ErrHomeDirUnavailable
	}
	return filepath.Join(cleanHome, ".redeven"), nil
}

func sanitizeStateScopeID(raw string) string {
	id := strings.TrimSpace(raw)
	if id == "" {
		return ""
	}

	var b strings.Builder
	b.Grow(len(id))
	for i := 0; i < len(id); i++ {
		c := id[i]
		switch {
		case c >= 'a' && c <= 'z':
			b.WriteByte(c)
		case c >= 'A' && c <= 'Z':
			b.WriteByte(c)
		case c >= '0' && c <= '9':
			b.WriteByte(c)
		case c == '_' || c == '-' || c == '.':
			b.WriteByte(c)
		default:
			b.WriteByte('_')
		}
	}
	return b.String()
}
