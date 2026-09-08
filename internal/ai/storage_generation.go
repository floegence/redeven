package ai

import (
	"errors"
	"os"
	"path/filepath"
)

// ErrFlowerStorageRestored rejects transport retries from an older data set.
// The caller keeps its input and creates a new request after user confirmation.
var ErrFlowerStorageRestored = errors.New("data was restored; submit the preserved input as a new task")

type flowerStorageGeneration struct {
	ID string `json:"id"`
}

func readFlowerStorageGeneration(state string) (string, error) {
	var generation flowerStorageGeneration
	if err := readMaintenanceJSON(filepath.Join(state, flowerMaintenanceDir, "storage-generation.json"), &generation); errors.Is(err, os.ErrNotExist) {
		return "", nil
	} else if err != nil {
		return "", err
	}
	if !validFlowerSnapshotID(generation.ID) {
		return "", errors.New("invalid Flower storage generation")
	}
	return generation.ID, nil
}

// StorageGeneration identifies a restored data set, not an execution or lease.
func (s *Service) StorageGeneration() string {
	if s == nil {
		return ""
	}
	return s.storageGeneration
}
