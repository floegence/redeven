package ai

import (
	"context"
	"errors"
	"os"
	"path/filepath"
)

// IMPORTANT: Automatic snapshots are retired. Cleanup runs only after healthy
// activation, never before migration or while a durable replacement is pending.
// Only checksum-verified, unprotected automatic snapshots are disposable;
// unknown, damaged, linked and before-restore records remain untouched.
func removeObsoleteFlowerSnapshots(ctx context.Context, state string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := validateFlowerDestination(state, flowerMaintenanceDir+"/snapshots"); err != nil {
		return err
	}
	if _, err := os.Lstat(filepath.Join(state, flowerMaintenanceDir, "restore.json")); !errors.Is(err, os.ErrNotExist) {
		if err != nil {
			return err
		}
		return errors.New("Flower replacement is pending")
	}
	parent := filepath.Join(state, flowerMaintenanceDir, "snapshots")
	entries, err := os.ReadDir(parent)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	root, err := os.OpenRoot(parent)
	if err != nil {
		return err
	}
	defer root.Close()
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return err
		}
		if !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 || !validFlowerSnapshotID(entry.Name()) {
			continue
		}
		manifest, err := verifyFlowerSnapshot(ctx, state, entry.Name())
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			continue
		}
		if manifest.Kind != "automatic" || manifest.Protected {
			continue
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := root.RemoveAll(entry.Name()); err != nil {
			return err
		}
	}
	return syncFlowerDirectory(parent)
}
