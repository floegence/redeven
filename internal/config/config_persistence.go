package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type configPersistence struct {
	readFile    func(string) ([]byte, error)
	writeConfig func(string, *Config) error
}

func defaultConfigPersistence() configPersistence {
	return configPersistence{
		readFile:    os.ReadFile,
		writeConfig: writeConfigAtomic,
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
	if err := persistence.writeConfig(path, &next); err != nil {
		return err
	}
	return nil
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
