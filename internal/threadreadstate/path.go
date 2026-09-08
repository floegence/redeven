package threadreadstate

import (
	"context"
	"errors"
	"os"
	"path/filepath"
)

// ExistingPath selects the existing authoritative store without changing paths.
func ExistingPath(stateDir string) (string, error) {
	current := filepath.Join(stateDir, "apps", "appserver", "thread_read_state.sqlite")
	if _, err := os.Stat(current); err == nil {
		return current, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	legacy := filepath.Join(stateDir, "gateway", "thread_read_state.sqlite")
	if _, err := os.Stat(legacy); err == nil {
		return legacy, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	return current, nil
}

// PreparePath moves the selected legacy store only after the caller has saved
// its upgrade snapshot. Publishing one complete database avoids split WAL moves.
func PreparePath(ctx context.Context, stateDir string) (string, error) {
	source, err := ExistingPath(stateDir)
	if err != nil {
		return "", err
	}
	current := filepath.Join(stateDir, "apps", "appserver", "thread_read_state.sqlite")
	if source == current {
		return current, nil
	}
	if err := os.MkdirAll(filepath.Dir(current), 0700); err != nil {
		return "", err
	}
	// Persist newly created ancestors before publishing the database and
	// removing the former path. A child-directory sync alone is insufficient.
	for _, directory := range []string{filepath.Dir(current), filepath.Join(stateDir, "apps"), stateDir} {
		dir, err := os.Open(directory)
		if err != nil {
			return "", err
		}
		if err := errors.Join(dir.Sync(), dir.Close()); err != nil {
			return "", err
		}
	}
	stage, err := os.MkdirTemp(filepath.Dir(current), ".read-state-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(stage)
	staged := filepath.Join(stage, "state.sqlite")
	if err := Backup(ctx, source, staged); err != nil {
		return "", err
	}
	if err := os.Rename(staged, current); err != nil {
		return "", err
	}
	dir, err := os.Open(filepath.Dir(current))
	if err != nil {
		return "", err
	}
	if err := errors.Join(dir.Sync(), dir.Close()); err != nil {
		return "", err
	}
	for _, suffix := range []string{"", "-wal", "-shm", "-journal"} {
		if err := os.Remove(source + suffix); err != nil && !errors.Is(err, os.ErrNotExist) {
			return "", err
		}
	}
	return current, nil
}
