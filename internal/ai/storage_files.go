package ai

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
)

// Validate only paths owned by Flower beneath the configured state directory.
// The state directory itself may be a user-selected mount or symlink.
func validateFlowerStoragePaths(state string) error {
	for _, path := range append(flowerReplacementPaths(), flowerMaintenanceDir+"/restore.json", flowerMaintenanceDir+"/upgrade.json", flowerMaintenanceDir+"/storage-generation.json", flowerMaintenanceDir+"/snapshots") {
		if err := validateFlowerDestination(state, path); err != nil {
			return err
		}
	}
	return nil
}

// Newly created ancestor entries must be durable before a journal can refer to
// them. Syncing just the final directory does not persist its parent's entry.
func mkdirFlowerDirectories(path string) error {
	if info, err := os.Stat(path); err == nil {
		if !info.IsDir() {
			return errors.New("storage directory path is occupied")
		}
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	parent := filepath.Dir(path)
	if parent == path {
		return errors.New("storage directory has no parent")
	}
	if err := mkdirFlowerDirectories(parent); err != nil {
		return err
	}
	if err := os.Mkdir(path, 0700); err != nil && !errors.Is(err, os.ErrExist) {
		return err
	}
	return syncFlowerDirectory(parent)
}

// Called only after any durable replacement has finished and before opening a
// generation. A failed Close fences this path at the readiness controller.
func cleanupFlowerStaging(state string) error {
	parent := filepath.Join(state, flowerMaintenanceDir)
	for _, spec := range []struct{ path, prefix string }{{parent, "restore-"}, {filepath.Join(parent, "snapshots"), ".pending-"}} {
		entries, err := os.ReadDir(spec.path)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		for _, entry := range entries {
			id, matched := strings.CutPrefix(entry.Name(), spec.prefix)
			if !matched || !validFlowerSnapshotID(id) {
				continue
			}
			if !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
				return errors.New("invalid Flower staging directory")
			}
			if err := os.RemoveAll(filepath.Join(spec.path, entry.Name())); err != nil {
				return err
			}
		}
		if err := syncFlowerDirectory(spec.path); err != nil {
			return err
		}
	}
	return nil
}

// CheckFlowerSnapshot validates immutable backup bytes without opening any
// live store. The controller checks before draining and restore checks again.
func CheckFlowerSnapshot(ctx context.Context, state, id string) error {
	_, err := verifyFlowerSnapshot(ctx, state, id)
	return flowerStorageError("recovery", "verifying", err)
}

// Before resuming any rename, verify the complete new collection at its current
// staged/live locations. A damaged operation remains blocked with both sets
// preserved; no database may open until the whole replacement is verified.
func verifyFlowerReplacementFiles(ctx context.Context, state, root string, operation flowerReplacement) error {
	for _, relative := range flowerStorageRoots {
		prepared := filepath.Join(root, "prepared", relative)
		if err := validateFlowerDestination(root, "prepared/"+relative); err != nil {
			return err
		}
		if err := validateFlowerDestination(root, "previous/"+relative); err != nil {
			return err
		}
		pending, err := flowerPathExists(prepared)
		if err != nil {
			return err
		}
		base := filepath.Join(root, "prepared")
		if !pending {
			base = state
			for _, item := range operation.Items {
				if item.Path != relative || !item.HadOriginal {
					continue
				}
				moved, err := flowerPathExists(filepath.Join(root, "previous", relative))
				if err != nil {
					return err
				}
				if !moved {
					return errors.New("prepared Flower collection disappeared before replacement")
				}
			}
		}
		var expected []flowerSnapshotFile
		for _, file := range operation.Files {
			if file.Path != relative && !strings.HasPrefix(file.Path, relative+"/") {
				continue
			}
			if err := validateFlowerDestination(base, file.Path); err != nil {
				return err
			}
			actual, err := hashFlowerFile(ctx, filepath.Join(base, file.Path), file.Path)
			if err != nil {
				return err
			}
			if actual != file {
				return errFlowerChecksum
			}
			if relative == "ai/uploads" {
				file.Path = strings.TrimPrefix(file.Path, relative+"/")
				expected = append(expected, file)
			}
		}
		if relative == "ai/uploads" {
			actual, err := hashFlowerFiles(ctx, filepath.Join(base, relative))
			if err != nil {
				return err
			}
			if !reflect.DeepEqual(actual, expected) {
				return errFlowerChecksum
			}
		}
	}
	return nil
}
