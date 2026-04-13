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
	DefaultLocalScopeName = "default"
	stateRootEnvName      = "REDEVEN_STATE_ROOT"
)

var (
	userHomeDir = os.UserHomeDir
	lookupEnv   = os.LookupEnv
)

type ScopeKind string

const (
	ScopeKindLocal        ScopeKind = "local"
	ScopeKindNamed        ScopeKind = "named"
	ScopeKindControlPlane ScopeKind = "controlplane"
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

// DefaultStateLayout returns the default local scope layout rooted under the resolved state root.
func DefaultStateLayout() (StateLayout, error) {
	return LocalStateLayout(DefaultLocalScopeName, "")
}

func LocalStateLayout(name string, stateRoot string) (StateLayout, error) {
	return StateLayoutForScope(ScopeRef{Kind: ScopeKindLocal, Name: name}, stateRoot)
}

func NamedStateLayout(name string, stateRoot string) (StateLayout, error) {
	return StateLayoutForScope(ScopeRef{Kind: ScopeKindNamed, Name: name}, stateRoot)
}

func ControlPlaneStateLayout(controlplaneBaseURL string, envID string, stateRoot string) (StateLayout, error) {
	return StateLayoutForScope(ScopeRef{
		Kind:                ScopeKindControlPlane,
		ControlplaneBaseURL: controlplaneBaseURL,
		EnvironmentID:       envID,
	}, stateRoot)
}

func ParseScopeRef(raw string) (ScopeRef, error) {
	value := strings.TrimSpace(raw)
	switch {
	case value == "":
		return ScopeRef{}, errors.New("missing scope")
	case value == "local":
		return ScopeRef{Kind: ScopeKindLocal, Name: DefaultLocalScopeName}, nil
	case strings.HasPrefix(value, "local/"):
		return ScopeRef{Kind: ScopeKindLocal, Name: strings.TrimSpace(strings.TrimPrefix(value, "local/"))}, nil
	case strings.HasPrefix(value, "named/"):
		return ScopeRef{Kind: ScopeKindNamed, Name: strings.TrimSpace(strings.TrimPrefix(value, "named/"))}, nil
	case strings.HasPrefix(value, "controlplane/"):
		parts := strings.Split(strings.TrimPrefix(value, "controlplane/"), "/")
		if len(parts) != 2 {
			return ScopeRef{}, fmt.Errorf("invalid scope %q (want controlplane/<provider_key>/<env_id>)", value)
		}
		return ScopeRef{
			Kind:          ScopeKindControlPlane,
			ProviderKey:   strings.TrimSpace(parts[0]),
			EnvironmentID: strings.TrimSpace(parts[1]),
		}, nil
	default:
		return ScopeRef{}, fmt.Errorf("invalid scope %q (supported: local, local/<name>, named/<name>, controlplane/<provider_key>/<env_id>)", value)
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
	if err := migrateLegacyStateRoot(root); err != nil {
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
	case ScopeKindLocal:
		scopeKey = fmt.Sprintf("local/%s", normalizeScopeSegment(normalizedScope.Name))
		scopeDir = filepath.Join(stateRoot, "scopes", "local", normalizeScopeSegment(normalizedScope.Name))
	case ScopeKindNamed:
		scopeKey = fmt.Sprintf("named/%s", normalizeScopeSegment(normalizedScope.Name))
		scopeDir = filepath.Join(stateRoot, "scopes", "named", normalizeScopeSegment(normalizedScope.Name))
	case ScopeKindControlPlane:
		envSegment := normalizeScopeSegment(normalizedScope.EnvironmentID)
		scopeKey = fmt.Sprintf("controlplane/%s/%s", normalizedScope.ProviderKey, envSegment)
		scopeDir = filepath.Join(stateRoot, "scopes", "controlplane", normalizedScope.ProviderKey, envSegment)
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
	case ScopeKindLocal:
		name, err := normalizeScopeName(scope.Name, DefaultLocalScopeName)
		if err != nil {
			return ScopeRef{}, err
		}
		return ScopeRef{Kind: ScopeKindLocal, Name: name}, nil
	case ScopeKindNamed:
		name, err := normalizeScopeName(scope.Name, "")
		if err != nil {
			return ScopeRef{}, err
		}
		return ScopeRef{Kind: ScopeKindNamed, Name: name}, nil
	case ScopeKindControlPlane:
		providerKey := normalizeScopeSegment(scope.ProviderKey)
		controlplaneBaseURL := strings.TrimSpace(scope.ControlplaneBaseURL)
		if controlplaneBaseURL != "" {
			var err error
			controlplaneBaseURL, err = normalizeControlplaneBaseURL(controlplaneBaseURL)
			if err != nil {
				return ScopeRef{}, err
			}
			providerKey, err = controlPlaneProviderKey(controlplaneBaseURL)
			if err != nil {
				return ScopeRef{}, err
			}
		}
		if providerKey == "" {
			return ScopeRef{}, errors.New("missing controlplane provider key")
		}
		envID := strings.TrimSpace(scope.EnvironmentID)
		if envID == "" {
			return ScopeRef{}, errors.New("missing environment id")
		}
		return ScopeRef{
			Kind:                ScopeKindControlPlane,
			ProviderKey:         providerKey,
			ControlplaneBaseURL: controlplaneBaseURL,
			EnvironmentID:       envID,
		}, nil
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

var legacyRootStateEntries = []string{
	"config.json",
	"secrets.json",
	"agent.lock",
	"runtime",
	"diagnostics",
	"audit",
	"apps",
	"gateway",
	"ai",
	"skills_state.json",
	"skills_sources.json",
}

func migrateLegacyStateRoot(stateRoot string) error {
	cleanRoot := filepath.Clean(strings.TrimSpace(stateRoot))
	if cleanRoot == "" {
		return nil
	}

	localLayout, err := stateLayoutForScopeResolvedRoot(
		ScopeRef{Kind: ScopeKindLocal, Name: DefaultLocalScopeName},
		cleanRoot,
	)
	if err != nil {
		return err
	}
	for _, name := range legacyRootStateEntries {
		srcPath := filepath.Join(cleanRoot, name)
		dstPath := filepath.Join(localLayout.ScopeDir, name)
		if err := moveLegacyPath(srcPath, dstPath); err != nil {
			return err
		}
	}

	legacyEnvRoot := filepath.Join(cleanRoot, "envs")
	entries, err := os.ReadDir(legacyEnvRoot)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	for _, entry := range entries {
		if entry == nil || !entry.IsDir() {
			continue
		}
		srcDir := filepath.Join(legacyEnvRoot, entry.Name())
		targetLayout, err := legacyEnvTargetLayout(srcDir, cleanRoot)
		if err != nil {
			return err
		}
		if err := moveLegacyDirIntoScope(srcDir, targetLayout.ScopeDir); err != nil {
			return err
		}
	}
	_ = os.Remove(legacyEnvRoot)
	return nil
}

func moveLegacyPath(srcPath string, dstPath string) error {
	if !pathExists(srcPath) || pathExists(dstPath) {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(dstPath), 0o700); err != nil {
		return err
	}
	return os.Rename(srcPath, dstPath)
}

func moveLegacyDirIntoScope(srcDir string, dstDir string) error {
	if !pathExists(srcDir) {
		return nil
	}
	if !pathExists(dstDir) {
		if err := os.MkdirAll(filepath.Dir(dstDir), 0o700); err != nil {
			return err
		}
		return os.Rename(srcDir, dstDir)
	}

	entries, err := os.ReadDir(srcDir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry == nil {
			continue
		}
		srcPath := filepath.Join(srcDir, entry.Name())
		dstPath := filepath.Join(dstDir, entry.Name())
		if err := moveLegacyPath(srcPath, dstPath); err != nil {
			return err
		}
	}
	_ = os.Remove(srcDir)
	return nil
}

func legacyEnvTargetLayout(srcDir string, stateRoot string) (StateLayout, error) {
	cfgPath := filepath.Join(srcDir, "config.json")
	cfg, err := Load(cfgPath)
	if err == nil && strings.TrimSpace(cfg.ControlplaneBaseURL) != "" && strings.TrimSpace(cfg.EnvironmentID) != "" {
		return stateLayoutForScopeResolvedRoot(ScopeRef{
			Kind:                ScopeKindControlPlane,
			ControlplaneBaseURL: cfg.ControlplaneBaseURL,
			EnvironmentID:       cfg.EnvironmentID,
		}, stateRoot)
	}
	return stateLayoutForScopeResolvedRoot(ScopeRef{
		Kind: ScopeKindNamed,
		Name: "legacy-env-" + filepath.Base(srcDir),
	}, stateRoot)
}

func pathExists(path string) bool {
	if _, err := os.Stat(path); err == nil {
		return true
	}
	return false
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
