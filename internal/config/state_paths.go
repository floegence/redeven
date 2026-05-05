package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

var ErrHomeDirUnavailable = errors.New("user home directory is unavailable")

const (
	DefaultLocalEnvironmentID = "local"
	localEnvironmentDirName   = "local-environment"
	stateRootEnvName          = "REDEVEN_STATE_ROOT"
)

var (
	userHomeDir = os.UserHomeDir
	lookupEnv   = os.LookupEnv
)

type StateLayout struct {
	StateRoot        string
	ConfigPath       string
	SecretsPath      string
	LockPath         string
	StateDir         string
	RuntimeStatePath string
	DiagnosticsDir   string
	AuditDir         string
	AppsDir          string
	GatewayDir       string
}

func DefaultConfigPath() (string, error) {
	layout, err := DefaultStateLayout()
	if err != nil {
		return "", err
	}
	return layout.ConfigPath, nil
}

// DefaultStateLayout returns the single Local Environment layout rooted under the resolved state root.
func DefaultStateLayout() (StateLayout, error) {
	return LocalEnvironmentStateLayout("")
}

func LocalEnvironmentStateLayout(stateRoot string) (StateLayout, error) {
	root, err := ResolveStateRoot(stateRoot)
	if err != nil {
		return StateLayout{}, err
	}
	return stateLayoutForResolvedRoot(root), nil
}

func ResolveStateRoot(override string) (string, error) {
	cleanOverride := strings.TrimSpace(override)
	if cleanOverride == "" {
		if value, ok := lookupEnv(stateRootEnvName); ok {
			cleanOverride = strings.TrimSpace(value)
		}
	}
	if cleanOverride != "" {
		absPath, err := filepath.Abs(cleanOverride)
		if err != nil {
			return "", fmt.Errorf("resolve state root %q: %w", cleanOverride, err)
		}
		return filepath.Clean(absPath), nil
	}

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

func stateLayoutForResolvedRoot(stateRoot string) StateLayout {
	stateDir := filepath.Join(stateRoot, localEnvironmentDirName)
	return StateLayout{
		StateRoot:        stateRoot,
		ConfigPath:       filepath.Join(stateDir, "config.json"),
		SecretsPath:      filepath.Join(stateDir, "secrets.json"),
		LockPath:         filepath.Join(stateDir, "agent.lock"),
		StateDir:         stateDir,
		RuntimeStatePath: filepath.Join(stateDir, "runtime", "local-ui.json"),
		DiagnosticsDir:   filepath.Join(stateDir, "diagnostics"),
		AuditDir:         filepath.Join(stateDir, "audit"),
		AppsDir:          filepath.Join(stateDir, "apps"),
		GatewayDir:       filepath.Join(stateDir, "gateway"),
	}
}

func normalizeControlplaneBaseURL(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", errors.New("missing controlplane url")
	}
	parsedURL, err := url.Parse(value)
	if err != nil {
		return "", fmt.Errorf("invalid controlplane url: %w", err)
	}
	if strings.TrimSpace(parsedURL.Scheme) == "" || strings.TrimSpace(parsedURL.Host) == "" {
		return "", errors.New("invalid controlplane url: missing scheme or host")
	}
	parsedURL.Scheme = strings.ToLower(strings.TrimSpace(parsedURL.Scheme))
	parsedURL.Host = strings.ToLower(strings.TrimSpace(parsedURL.Host))
	parsedURL.Path = ""
	parsedURL.RawPath = ""
	parsedURL.RawQuery = ""
	parsedURL.Fragment = ""
	parsedURL.User = nil
	return parsedURL.String(), nil
}
