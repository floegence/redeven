package config

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// PendingCloudEnrollment exposes operation coordinates, never recovery secrets.
type PendingCloudEnrollment struct {
	OperationID   string `json:"operation_id"`
	CloudOrigin   string `json:"cloud_origin"`
	EnvironmentID string `json:"env_public_id"`
	Suspended     bool   `json:"suspended"`
}

func readPendingCloudEnrollment(path string) (bootstrapDeliveryAttempt, error) {
	var attempt bootstrapDeliveryAttempt
	raw, err := os.ReadFile(filepath.Clean(path) + ".cloud-enrollment-v5.json")
	if err != nil {
		return attempt, err
	}
	err = decodeExactBootstrapDeliveryAttempt(raw, &attempt)
	return attempt, err
}

func InspectPendingCloudEnrollment(path string) (*PendingCloudEnrollment, error) {
	unlock := lockConfig(path)
	defer unlock()
	attempt, err := readPendingCloudEnrollment(path)
	if err != nil {
		return nil, err
	}
	return &PendingCloudEnrollment{OperationID: attempt.BootstrapDeliveryRequestIDB64u, CloudOrigin: attempt.CloudOrigin, EnvironmentID: attempt.EnvPublicID, Suspended: attempt.Suspended}, nil
}

// Suspension preserves the original machine key and unknown remote result.
// Resuming never authorizes a new enrollment or changes its operation ID.
func SetPendingCloudEnrollmentSuspended(path, id string, suspended bool) error {
	unlock := lockConfig(path)
	defer unlock()
	attempt, err := readPendingCloudEnrollment(path)
	if err != nil {
		return err
	}
	if attempt.BootstrapDeliveryRequestIDB64u != id {
		return errors.New("cloud enrollment operation changed")
	}
	if current, err := loadConfig(path, defaultConfigPersistence()); err == nil && current.CloudAssociation != nil && current.CloudAssociation.EnrollmentOperationID == id {
		if !suspended {
			return nil
		}
		return errors.New("cloud enrollment is already committed; manage the current Cloud connection")
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	attempt.Suspended = suspended
	return writeBootstrapDeliveryAttemptAtomic(filepath.Clean(path)+".cloud-enrollment-v5.json", attempt)
}

func updateBootstrapDeliveryAttempt(journal string, next bootstrapDeliveryAttempt) error {
	path := strings.TrimSuffix(journal, ".cloud-enrollment-v5.json")
	unlock := lockConfig(path)
	defer unlock()
	current, err := readPendingCloudEnrollment(path)
	if err != nil {
		return err
	}
	if current.Suspended || current.BootstrapDeliveryRequestIDB64u != next.BootstrapDeliveryRequestIDB64u || current.PublicKeyB64u != next.PublicKeyB64u || current.ExpectedAssociationRevision != next.ExpectedAssociationRevision {
		return errors.New("cloud enrollment was cancelled or replaced")
	}
	return writeBootstrapDeliveryAttemptAtomic(journal, next)
}
