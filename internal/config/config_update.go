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
	return saveConnectionConfigMode(path, next, persistence, false, false)
}

func saveEnrollmentConnectionConfig(path string, next *Config, bootstrap bool) error {
	if next != nil && next.bootstrapDeliveryAttemptPath != "" {
		attempt, err := readPendingCloudEnrollment(path)
		if err != nil {
			return err
		}
		if attempt.Suspended || attempt.BootstrapDeliveryRequestIDB64u != next.bootstrapDeliveryRequestIDB64u {
			return errors.New("cloud enrollment was cancelled or replaced")
		}
	}
	return saveConnectionConfigMode(path, next, defaultConfigPersistence(), true, bootstrap)
}

func saveConnectionConfigMode(path string, next *Config, persistence configPersistence, enrollment, bootstrap bool) error {
	if next == nil {
		return errors.New("nil config")
	}
	current, err := loadConfig(path, persistence)
	if errors.Is(err, os.ErrNotExist) {
		initial := *next
		if enrollment {
			initial.CloudAssociation, initial.CloudRoute = nil, nil
		}
		current = &initial
	} else if err != nil {
		return err
	}
	if current.CloudRoute != nil && (next.CloudRoute == nil || current.CloudRoute.Revision != next.CloudRoute.Revision) {
		return ErrCloudRouteConflict
	}
	if enrollment {
		associationRevision, routeRevision := int64(0), int64(0)
		if current.CloudAssociation != nil {
			associationRevision = current.CloudAssociation.Revision
		}
		if current.CloudRoute != nil {
			routeRevision = current.CloudRoute.Revision
		}
		alreadyCommitted := current.CloudAssociation != nil && next.CloudAssociation != nil && current.CloudAssociation.EnrollmentOperationID == next.CloudAssociation.EnrollmentOperationID && associationRevision == next.CloudAssociation.Revision
		if !alreadyCommitted && (associationRevision != next.cloudEnrollmentExpectedAssociationRevision || routeRevision != next.cloudEnrollmentExpectedRouteRevision || next.CloudAssociation == nil || next.CloudAssociation.Revision != associationRevision+1) {
			return errors.New("cloud enrollment owner changed")
		}
	} else if current.CloudAssociation != nil && (next.CloudAssociation == nil || current.CloudAssociation.Revision != next.CloudAssociation.Revision || current.CloudAssociation.CloudOrigin != next.CloudAssociation.CloudOrigin || current.CloudAssociation.NamespacePublicID != next.CloudAssociation.NamespacePublicID || current.CloudAssociation.PublicKeyB64u != next.CloudAssociation.PublicKeyB64u) {
		return errors.New("cloud association changed")
	}
	if current.CloudAssociation != nil && next.CloudAssociation != nil && current.CloudAssociation.Binding != nil && next.CloudAssociation.Binding != nil && current.CloudAssociation.Binding.PublicID == next.CloudAssociation.Binding.PublicID && current.CloudAssociation.Binding.Generation > next.CloudAssociation.Binding.Generation {
		return errors.New("cloud binding generation regressed")
	}
	if bootstrap {
		current.AgentHomeDir, current.Shell, current.LogLevel, current.LogFormat, current.PermissionPolicy = next.AgentHomeDir, next.Shell, next.LogLevel, next.LogFormat, next.PermissionPolicy
	}
	current.CloudAssociation = next.CloudAssociation
	current.CloudRoute = next.CloudRoute
	current.GatewayRemovalOutbox = next.GatewayRemovalOutbox
	current.Gateways = next.Gateways
	current.CloudOrigin = next.CloudOrigin
	current.AccessPointOrigin = next.AccessPointOrigin
	current.CloudID = next.CloudID
	current.EnvironmentID = next.EnvironmentID
	current.LocalEnvironmentPublicID = next.LocalEnvironmentPublicID
	current.BindingGeneration = next.BindingGeneration
	current.AgentInstanceID = next.AgentInstanceID
	current.ControlArtifactPool = next.ControlArtifactPool
	current.bootstrapDeliveryAttemptPath = next.bootstrapDeliveryAttemptPath
	current.bootstrapDeliveryRequestIDB64u = next.bootstrapDeliveryRequestIDB64u
	if err := saveConfig(path, current, persistence); err != nil {
		return err
	}
	*next = *current
	return nil
}
