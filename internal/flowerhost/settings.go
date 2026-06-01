package flowerhost

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/floegence/redeven/internal/config"
)

const (
	stateDirName     = "flower"
	configFileName   = "config.json"
	targetCacheName  = "target-cache.json"
	identityFileName = "identity.json"
	lockFileName     = "flower-host.lock"
)

type Paths struct {
	StateRoot       string
	StateDir        string
	ConfigPath      string
	TargetCachePath string
	IdentityPath    string
	LockPath        string
	ThreadstorePath string
}

type SecretResolver interface {
	ResolveProviderAPIKey(ctx context.Context, providerID string) (string, bool, error)
	ResolveWebSearchProviderAPIKey(ctx context.Context, providerID string) (string, bool, error)
	ResolveControlPlaneAccessToken(ctx context.Context, providerOrigin string) (string, bool, error)
}

type ConfigStore struct {
	paths Paths
}

func DefaultPaths(stateRoot string) (Paths, error) {
	root, err := config.ResolveStateRoot(stateRoot)
	if err != nil {
		return Paths{}, err
	}
	stateDir := filepath.Join(root, stateDirName)
	return Paths{
		StateRoot:       root,
		StateDir:        stateDir,
		ConfigPath:      filepath.Join(stateDir, configFileName),
		TargetCachePath: filepath.Join(stateDir, targetCacheName),
		IdentityPath:    filepath.Join(stateDir, identityFileName),
		LockPath:        filepath.Join(stateDir, lockFileName),
		ThreadstorePath: filepath.Join(stateDir, "ai", "threads.sqlite"),
	}, nil
}

func NewConfigStore(paths Paths) *ConfigStore {
	return &ConfigStore{paths: paths}
}

func DefaultConfigDocument() ConfigDocument {
	return ConfigDocument{
		SchemaVersion: SchemaVersion,
		Enabled:       false,
		Providers:     []config.AIProvider{},
		ExecutionPolicy: &config.AIExecutionPolicy{
			RequireUserApproval:    true,
			BlockDangerousCommands: true,
		},
		TerminalExecPolicy: &config.AITerminalExecPolicy{
			DefaultTimeoutMS: ptrInt(120_000),
			MaxTimeoutMS:     ptrInt(600_000),
		},
	}
}

func ptrInt(v int) *int {
	return &v
}

func (s *ConfigStore) LoadConfig(ctx context.Context) (ConfigDocument, error) {
	if s == nil {
		return ConfigDocument{}, errors.New("nil config store")
	}
	var doc ConfigDocument
	if err := readJSON(s.paths.ConfigPath, &doc); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return DefaultConfigDocument(), nil
		}
		return ConfigDocument{}, err
	}
	return normalizeConfigDocument(doc)
}

func (s *ConfigStore) SaveConfig(ctx context.Context, doc ConfigDocument) (ConfigDocument, error) {
	if s == nil {
		return ConfigDocument{}, errors.New("nil config store")
	}
	next, err := normalizeConfigDocument(doc)
	if err != nil {
		return ConfigDocument{}, err
	}
	if _, err := next.AIConfig(); err != nil {
		return ConfigDocument{}, err
	}
	if err := writeJSON(s.paths.ConfigPath, next); err != nil {
		return ConfigDocument{}, err
	}
	return next, nil
}

func (s *ConfigStore) LoadTargetCache(ctx context.Context) (TargetCache, error) {
	if s == nil {
		return TargetCache{}, errors.New("nil config store")
	}
	var cache TargetCache
	if err := readJSON(s.paths.TargetCachePath, &cache); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return TargetCache{Version: 1, Entries: []TargetCacheEntry{}}, nil
		}
		return TargetCache{}, err
	}
	cache.Version = 1
	if cache.Entries == nil {
		cache.Entries = []TargetCacheEntry{}
	}
	for i := range cache.Entries {
		cache.Entries[i].TargetID = strings.TrimSpace(cache.Entries[i].TargetID)
		cache.Entries[i].Label = strings.TrimSpace(cache.Entries[i].Label)
		cache.Entries[i].TargetURL = strings.TrimSpace(cache.Entries[i].TargetURL)
	}
	return cache, nil
}

func (s *ConfigStore) SaveTargetCache(ctx context.Context, cache TargetCache) error {
	if s == nil {
		return errors.New("nil config store")
	}
	cache.Version = 1
	if cache.Entries == nil {
		cache.Entries = []TargetCacheEntry{}
	}
	for i := range cache.Entries {
		cache.Entries[i].TargetID = strings.TrimSpace(cache.Entries[i].TargetID)
		cache.Entries[i].Label = strings.TrimSpace(cache.Entries[i].Label)
		cache.Entries[i].TargetURL = strings.TrimSpace(cache.Entries[i].TargetURL)
	}
	return writeJSON(s.paths.TargetCachePath, cache)
}

func (s *ConfigStore) LoadIdentity(ctx context.Context) (HostIdentity, error) {
	if s == nil {
		return HostIdentity{}, errors.New("nil config store")
	}
	var identity HostIdentity
	if err := readJSON(s.paths.IdentityPath, &identity); err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return HostIdentity{}, err
		}
		now := unixMs()
		id, err := newHostID()
		if err != nil {
			return HostIdentity{}, err
		}
		identity = HostIdentity{
			SchemaVersion:    SchemaVersion,
			HostID:           id,
			HostKind:         HostKindGlobal,
			CarrierKind:      CarrierKindDesktop,
			CreatedAtUnixMs:  now,
			LastSeenAtUnixMs: now,
		}
	}
	identity = normalizeIdentity(identity)
	identity.LastSeenAtUnixMs = unixMs()
	if err := writeJSON(s.paths.IdentityPath, identity); err != nil {
		return HostIdentity{}, err
	}
	return identity, nil
}

func normalizeIdentity(in HostIdentity) HostIdentity {
	now := unixMs()
	in.SchemaVersion = SchemaVersion
	in.HostID = strings.TrimSpace(in.HostID)
	if in.HostID == "" {
		if id, err := newHostID(); err == nil {
			in.HostID = id
		}
	}
	in.HostKind = strings.TrimSpace(in.HostKind)
	if in.HostKind == "" {
		in.HostKind = HostKindGlobal
	}
	in.CarrierKind = strings.TrimSpace(in.CarrierKind)
	if in.CarrierKind == "" {
		in.CarrierKind = CarrierKindDesktop
	}
	if in.CreatedAtUnixMs <= 0 {
		in.CreatedAtUnixMs = now
	}
	return in
}

func normalizeConfigDocument(in ConfigDocument) (ConfigDocument, error) {
	out := in
	out.SchemaVersion = SchemaVersion
	out.CurrentModelID = strings.TrimSpace(out.CurrentModelID)
	if out.Providers == nil {
		out.Providers = []config.AIProvider{}
	}
	for i := range out.Providers {
		out.Providers[i].ID = strings.TrimSpace(out.Providers[i].ID)
		out.Providers[i].Name = strings.TrimSpace(out.Providers[i].Name)
		out.Providers[i].Type = strings.TrimSpace(strings.ToLower(out.Providers[i].Type))
		out.Providers[i].BaseURL = strings.TrimSpace(out.Providers[i].BaseURL)
		for j := range out.Providers[i].Models {
			out.Providers[i].Models[j].ModelName = strings.TrimSpace(out.Providers[i].Models[j].ModelName)
		}
	}
	if out.ExecutionPolicy == nil {
		def := DefaultConfigDocument()
		out.ExecutionPolicy = def.ExecutionPolicy
	}
	if out.TerminalExecPolicy == nil {
		def := DefaultConfigDocument()
		out.TerminalExecPolicy = def.TerminalExecPolicy
	}
	if !out.Enabled && len(out.Providers) == 0 {
		out.CurrentModelID = ""
	}
	if _, err := out.AIConfig(); err != nil {
		return ConfigDocument{}, err
	}
	return out, nil
}

func (d ConfigDocument) AIConfig() (*config.AIConfig, error) {
	if !d.Enabled && len(d.Providers) == 0 {
		return nil, nil
	}
	cfg := &config.AIConfig{
		Providers:          append([]config.AIProvider(nil), d.Providers...),
		CurrentModelID:     strings.TrimSpace(d.CurrentModelID),
		ExecutionPolicy:    d.ExecutionPolicy,
		TerminalExecPolicy: d.TerminalExecPolicy,
	}
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

func ProviderSecretStates(ctx context.Context, providers []config.AIProvider, resolver SecretResolver) ([]ProviderSecretState, error) {
	out := make([]ProviderSecretState, 0, len(providers))
	for _, provider := range providers {
		providerID := strings.TrimSpace(provider.ID)
		if providerID == "" {
			continue
		}
		state := ProviderSecretState{ProviderID: providerID}
		if resolver != nil {
			_, ok, err := resolver.ResolveProviderAPIKey(ctx, providerID)
			if err != nil {
				return nil, err
			}
			state.ProviderAPIKeyConfigured = ok
			_, webOK, err := resolver.ResolveWebSearchProviderAPIKey(ctx, providerID)
			if err != nil {
				return nil, err
			}
			state.WebSearchAPIKeyConfigured = webOK
		}
		out = append(out, state)
	}
	return out, nil
}

func readJSON(path string, out any) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return errors.New("missing json path")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("invalid json file %s: %w", path, err)
	}
	return nil
}

func writeJSON(path string, value any) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return errors.New("missing json path")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	body, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	body = append(body, '\n')
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, body, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
