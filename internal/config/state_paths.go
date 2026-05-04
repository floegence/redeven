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
	DefaultLocalEnvironmentScopeName = "local"
	localEnvironmentScopeKey         = "local_environment"
	localEnvironmentScopeDirName     = "local-environment"
	stateRootEnvName                 = "REDEVEN_STATE_ROOT"
)

var (
	userHomeDir = os.UserHomeDir
	lookupEnv   = os.LookupEnv
)

type ScopeKind string

const (
	ScopeKindLocalEnvironment ScopeKind = "local_environment"
)

type ScopeRef struct {
	Kind                ScopeKind
	Name                string
	ProviderKey         string
	ControlplaneBaseURL string
	EnvironmentID       string
}

type StateLayout struct {
	StateRoot         string
	Scope             ScopeRef
	ScopeKey          string
	ScopeDir          string
	ScopeMetadataPath string
	ConfigPath        string
	SecretsPath       string
	LockPath          string
	StateDir          string
	RuntimeStatePath  string
	DiagnosticsDir    string
	AuditDir          string
	AppsDir           string
	GatewayDir        string
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
	return StateLayoutForScope(ScopeRef{Kind: ScopeKindLocalEnvironment, Name: DefaultLocalEnvironmentScopeName}, stateRoot)
}

func ControlPlaneStateLayout(controlplaneBaseURL string, envID string, stateRoot string) (StateLayout, error) {
	_ = controlplaneBaseURL
	_ = envID
	return LocalEnvironmentStateLayout(stateRoot)
}

func ParseScopeRef(raw string) (ScopeRef, error) {
	value := strings.TrimSpace(raw)
	switch {
	case value == "":
		return ScopeRef{}, errors.New("missing scope")
	case value == string(ScopeKindLocalEnvironment):
		return ScopeRef{Kind: ScopeKindLocalEnvironment, Name: DefaultLocalEnvironmentScopeName}, nil
	default:
		return ScopeRef{}, fmt.Errorf("invalid scope %q (supported: local_environment)", value)
	}
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

func StateLayoutForScope(scope ScopeRef, stateRoot string) (StateLayout, error) {
	root, err := ResolveStateRoot(stateRoot)
	if err != nil {
		return StateLayout{}, err
	}
	return stateLayoutForScopeResolvedRoot(scope, root)
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
		ConfigPath:        absPath,
		SecretsPath:       filepath.Join(stateDir, "secrets.json"),
		LockPath:          filepath.Join(stateDir, "agent.lock"),
		StateDir:          stateDir,
		ScopeDir:          stateDir,
		ScopeMetadataPath: filepath.Join(stateDir, "scope.json"),
		RuntimeStatePath:  filepath.Join(stateDir, "runtime", "local-ui.json"),
		DiagnosticsDir:    filepath.Join(stateDir, "diagnostics"),
		AuditDir:          filepath.Join(stateDir, "audit"),
		AppsDir:           filepath.Join(stateDir, "apps"),
		GatewayDir:        filepath.Join(stateDir, "gateway"),
	}, nil
}

func stateLayoutForScopeResolvedRoot(scope ScopeRef, stateRoot string) (StateLayout, error) {
	normalizedScope, err := normalizeScopeRef(scope)
	if err != nil {
		return StateLayout{}, err
	}

	var scopeKey string
	var scopeDir string
	switch normalizedScope.Kind {
	case ScopeKindLocalEnvironment:
		scopeKey = localEnvironmentScopeKey
		scopeDir = filepath.Join(stateRoot, localEnvironmentScopeDirName)
	default:
		return StateLayout{}, fmt.Errorf("unsupported scope kind %q", normalizedScope.Kind)
	}

	return StateLayout{
		StateRoot:         stateRoot,
		Scope:             normalizedScope,
		ScopeKey:          scopeKey,
		ScopeDir:          scopeDir,
		ScopeMetadataPath: filepath.Join(scopeDir, "scope.json"),
		ConfigPath:        filepath.Join(scopeDir, "config.json"),
		SecretsPath:       filepath.Join(scopeDir, "secrets.json"),
		LockPath:          filepath.Join(scopeDir, "agent.lock"),
		StateDir:          scopeDir,
		RuntimeStatePath:  filepath.Join(scopeDir, "runtime", "local-ui.json"),
		DiagnosticsDir:    filepath.Join(scopeDir, "diagnostics"),
		AuditDir:          filepath.Join(scopeDir, "audit"),
		AppsDir:           filepath.Join(scopeDir, "apps"),
		GatewayDir:        filepath.Join(scopeDir, "gateway"),
	}, nil
}

func normalizeScopeRef(scope ScopeRef) (ScopeRef, error) {
	switch scope.Kind {
	case ScopeKindLocalEnvironment, "":
		name, err := normalizeScopeName(scope.Name, DefaultLocalEnvironmentScopeName)
		if err != nil {
			return ScopeRef{}, err
		}
		return ScopeRef{Kind: ScopeKindLocalEnvironment, Name: name}, nil
	default:
		return ScopeRef{}, fmt.Errorf("unsupported scope kind %q", scope.Kind)
	}
}

func normalizeScopeName(raw string, fallback string) (string, error) {
	name := strings.TrimSpace(raw)
	if name == "" {
		name = strings.TrimSpace(fallback)
	}
	name = normalizeScopeSegment(name)
	if name == "" {
		return "", errors.New("missing scope name")
	}
	return name, nil
}

func normalizeScopeSegment(raw string) string {
	return sanitizeStateScopeID(strings.TrimSpace(raw))
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

func controlPlaneProviderKey(controlplaneBaseURL string) (string, error) {
	normalizedBaseURL, err := normalizeControlplaneBaseURL(controlplaneBaseURL)
	if err != nil {
		return "", err
	}
	parsedURL, err := url.Parse(normalizedBaseURL)
	if err != nil {
		return "", err
	}
	return sanitizeStateScopeID(strings.ToLower(parsedURL.Scheme + "__" + parsedURL.Host)), nil
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
