package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/floegence/redeven/internal/settings"
)

type runtimeDirectSecretStore interface {
	GetRuntimeDirectPSK(channelID string) (string, bool, error)
	SetRuntimeDirectPSK(channelID string, psk string) error
	RetainRuntimeDirectPSK(channelID string) error
}

type configPersistence struct {
	readFile       func(string) ([]byte, error)
	writeConfig    func(string, *Config) error
	newSecretStore func(string) runtimeDirectSecretStore
}

func defaultConfigPersistence() configPersistence {
	return configPersistence{
		readFile:    os.ReadFile,
		writeConfig: writeConfigAtomic,
		newSecretStore: func(path string) runtimeDirectSecretStore {
			return settings.NewSecretsStore(path)
		},
	}
}

func loadConfig(path string, persistence configPersistence) (*Config, error) {
	if strings.TrimSpace(path) == "" {
		return nil, errors.New("missing config path")
	}
	b, err := persistence.readFile(path)
	if err != nil {
		return nil, err
	}
	var cfg Config
	if err := json.Unmarshal(b, &cfg); err != nil {
		return nil, err
	}
	if err := cfg.ValidateLocalMinimal(); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}

	direct := cfg.Direct
	if direct == nil {
		return &cfg, nil
	}
	channelID := strings.TrimSpace(direct.ChannelId)
	legacyPSK := strings.TrimSpace(direct.E2eePskB64u)
	if channelID == "" || (!cfg.directPSKSet && legacyPSK == "") {
		direct.E2eePskB64u = ""
		return &cfg, nil
	}

	store := persistence.newSecretStore(secretsPathFromConfigPath(path))
	if legacyPSK != "" {
		if err := store.SetRuntimeDirectPSK(channelID, legacyPSK); err != nil {
			return nil, fmt.Errorf("migrate direct psk to secrets store: %w", err)
		}
		persistedPSK, ok, err := store.GetRuntimeDirectPSK(channelID)
		if err != nil {
			return nil, fmt.Errorf("verify migrated direct psk: %w", err)
		}
		if !ok || persistedPSK != legacyPSK {
			return nil, errors.New("verify migrated direct psk: stored value mismatch")
		}
		cfg.directPSKSet = true
		if err := persistence.writeConfig(path, &cfg); err != nil {
			return nil, fmt.Errorf("rewrite config after direct psk migration: %w", err)
		}
		if err := store.RetainRuntimeDirectPSK(channelID); err != nil {
			return nil, fmt.Errorf("remove stale direct psks after migration: %w", err)
		}
		return &cfg, nil
	}

	persistedPSK, ok, err := store.GetRuntimeDirectPSK(channelID)
	if err != nil {
		cfg.directPSKErr = err
		direct.E2eePskB64u = ""
		return &cfg, nil
	}
	if !ok {
		cfg.directPSKErr = errors.New("direct psk is marked as set but is missing from secrets.json")
		direct.E2eePskB64u = ""
		return &cfg, nil
	}
	direct.E2eePskB64u = persistedPSK
	return &cfg, nil
}

func saveConfig(path string, cfg *Config, persistence configPersistence) error {
	if strings.TrimSpace(path) == "" {
		return errors.New("missing config path")
	}
	if cfg == nil {
		return errors.New("nil config")
	}
	if err := cfg.ValidateLocalMinimal(); err != nil {
		return err
	}

	next := *cfg
	if cfg.Direct != nil {
		directCopy := *cfg.Direct
		next.Direct = &directCopy
	}
	next.directPSKErr = nil

	store := persistence.newSecretStore(secretsPathFromConfigPath(path))
	retainedChannelID := ""
	if next.Direct != nil {
		channelID := strings.TrimSpace(next.Direct.ChannelId)
		psk := strings.TrimSpace(next.Direct.E2eePskB64u)
		if psk != "" {
			if channelID == "" {
				return errors.New("missing direct channel id")
			}
			if err := store.SetRuntimeDirectPSK(channelID, psk); err != nil {
				return fmt.Errorf("persist direct psk: %w", err)
			}
			persistedPSK, ok, err := store.GetRuntimeDirectPSK(channelID)
			if err != nil {
				return fmt.Errorf("verify persisted direct psk: %w", err)
			}
			if !ok || persistedPSK != psk {
				return errors.New("verify persisted direct psk: stored value mismatch")
			}
			next.directPSKSet = true
			retainedChannelID = channelID
		} else if next.directPSKSet {
			persistedPSK, ok, err := store.GetRuntimeDirectPSK(channelID)
			if err != nil {
				return fmt.Errorf("load direct psk before config save: %w", err)
			}
			if !ok {
				return errors.New("direct psk is marked as set but is missing from secrets.json")
			}
			next.Direct.E2eePskB64u = persistedPSK
			retainedChannelID = channelID
		} else {
			next.Direct.E2eePskB64u = ""
		}
	} else {
		next.directPSKSet = false
	}

	if err := persistence.writeConfig(path, &next); err != nil {
		return err
	}
	if err := store.RetainRuntimeDirectPSK(retainedChannelID); err != nil {
		return fmt.Errorf("config saved but stale direct psk cleanup failed: %w", err)
	}
	cfg.directPSKSet = next.directPSKSet
	cfg.directPSKErr = nil
	return nil
}

func secretsPathFromConfigPath(configPath string) string {
	return filepath.Join(filepath.Dir(filepath.Clean(strings.TrimSpace(configPath))), "secrets.json")
}

func writeConfigAtomic(path string, cfg *Config) error {
	if cfg == nil {
		return errors.New("nil config")
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	b = append(b, '\n')

	tmp, err := os.CreateTemp(dir, ".config-*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer func() { _ = os.Remove(tmpPath) }()
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(b); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}
