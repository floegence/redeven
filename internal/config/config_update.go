package config

import (
	"errors"
	"os"
	"path/filepath"
	"sync"
)

// Runtime's process lock excludes other writers. This per-path lock coordinates
// its connection owner and settings server, including settings read-modify-write.
var configLocks sync.Map

func lockConfig(path string) func() {
	key, err := filepath.Abs(path)
	if err != nil {
		key = filepath.Clean(path)
	}
	value, _ := configLocks.LoadOrStore(key, &sync.Mutex{})
	lock := value.(*sync.Mutex)
	lock.Lock()
	return lock.Unlock
}

// Update reads current settings and atomically persists a mutation under the
// same lock used by connection maintenance. Callbacks must not call config APIs.
func Update(path string, mutate func(*Config) error) (*Config, error) {
	if mutate == nil {
		return nil, errors.New("missing config mutation")
	}
	unlock := lockConfig(path)
	defer unlock()
	persistence := defaultConfigPersistence()
	cfg, err := loadConfig(path, persistence)
	if err != nil {
		return nil, err
	}
	if err := mutate(cfg); err != nil {
		return nil, err
	}
	if err := saveConfig(path, cfg, persistence); err != nil {
		return nil, err
	}
	return cfg, nil
}

// SaveConnection persists only the connection owner's fields. Its cached
// configuration must never replace newer Flower bindings or local settings.
// On success, next also receives the current local settings for observation.
func SaveConnection(path string, next *Config) error {
	unlock := lockConfig(path)
	defer unlock()
	return saveConnectionConfig(path, next, defaultConfigPersistence())
}

func saveConnectionConfig(path string, next *Config, persistence configPersistence) error {
	if next == nil {
		return errors.New("nil config")
	}
	current, err := loadConfig(path, persistence)
	if errors.Is(err, os.ErrNotExist) {
		initial := *next
		current = &initial
	} else if err != nil {
		return err
	}
	current.GatewayRemovalOutbox = next.GatewayRemovalOutbox
	current.GatewayClosureOutbox = next.GatewayClosureOutbox
	current.Gateways = next.Gateways
	current.GatewayCloudMemberID = next.GatewayCloudMemberID
	current.GatewayMigrationEvidence = next.GatewayMigrationEvidence
	current.GatewayEnvironmentChoice = next.GatewayEnvironmentChoice
	current.GatewayRejoinRequired = next.GatewayRejoinRequired
	current.GatewayPublication = next.GatewayPublication
	current.CloudOrigin = next.CloudOrigin
	current.AccessPointOrigin = next.AccessPointOrigin
	current.CloudID = next.CloudID
	current.EnvironmentID = next.EnvironmentID
	current.LocalEnvironmentPublicID = next.LocalEnvironmentPublicID
	current.BindingGeneration = next.BindingGeneration
	current.AgentInstanceID = next.AgentInstanceID
	current.Direct = next.Direct
	current.ControlArtifactPool = next.ControlArtifactPool
	current.bootstrapDeliveryAttemptPath = next.bootstrapDeliveryAttemptPath
	current.bootstrapDeliveryRequestIDB64u = next.bootstrapDeliveryRequestIDB64u
	if err := saveConfig(path, current, persistence); err != nil {
		return err
	}
	*next = *current
	return nil
}
