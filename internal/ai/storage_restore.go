package ai

import (
	"context"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/threadreadstate"
)

var errFlowerChecksum = errors.New("checksum mismatch in Flower storage")

type flowerReplacementItem struct {
	Path        string `json:"path"`
	HadOriginal bool   `json:"had_original"`
	HasPrepared bool   `json:"has_prepared"`
}

// This records file replacement only. Agent lifecycle remains owned by Floret.
type flowerReplacement struct {
	Format         int                     `json:"format"`
	ID             string                  `json:"id"`
	SourceSnapshot string                  `json:"source_snapshot"`
	TargetBuild    string                  `json:"target_build"`
	Step           int                     `json:"step"`
	Items          []flowerReplacementItem `json:"items"`
	Files          []flowerSnapshotFile    `json:"files"`
}

func validateFlowerManifest(manifest flowerSnapshotManifest, id string) error {
	if manifest.Unavailable || manifest.Format != 1 || !validFlowerSnapshotID(id) || manifest.ID != id || manifest.SourceBuild == "" || manifest.CreatedAt.IsZero() || manifest.Kind != "automatic" && manifest.Kind != "before_restore" {
		return errors.New("invalid Flower snapshot manifest")
	}
	roots := make(map[string]bool)
	for _, root := range manifest.Roots {
		if roots[root] || !slices.Contains(flowerStorageRoots, root) {
			return errors.New("invalid Flower snapshot roots")
		}
		roots[root] = true
	}
	var total int64
	files := make(map[string]bool)
	for _, file := range manifest.Files {
		if !validFlowerManifestFile(file, manifest.Kind == "before_restore") || files[file.Path] {
			return errors.New("invalid Flower snapshot file")
		}
		root := file.Path
		for _, tree := range flowerStorageRoots[3:] {
			if strings.HasPrefix(root, tree+"/") {
				root = tree
				break
			}
		}
		for _, suffix := range []string{"-wal", "-shm", "-journal"} {
			root = strings.TrimSuffix(root, suffix)
		}
		if !roots[root] {
			return errors.New("snapshot file has no declared root")
		}
		files[file.Path] = true
		total += file.Size
		if total < 0 {
			return errors.New("snapshot size overflow")
		}
	}
	for root := range roots {
		if !flowerStorageTree(root) && !files[root] {
			return errors.New("snapshot database is missing")
		}
	}
	if total != manifest.Bytes {
		return errors.New("snapshot size mismatch")
	}
	return nil
}

func validFlowerManifestFile(file flowerSnapshotFile, raw bool) bool {
	if file.Size < 0 || filepath.ToSlash(filepath.Clean(file.Path)) != file.Path || strings.Contains(file.Path, "\\") {
		return false
	}
	digest, err := hex.DecodeString(file.SHA256)
	if err != nil || len(digest) != 32 {
		return false
	}
	for _, tree := range flowerStorageRoots[3:] {
		if strings.HasPrefix(file.Path, tree+"/") {
			return true
		}
	}
	for _, root := range flowerStorageRoots[:3] {
		if file.Path == root {
			return true
		}
		if raw {
			for _, suffix := range []string{"-wal", "-shm", "-journal"} {
				if file.Path == root+suffix {
					return true
				}
			}
		}
	}
	return false
}

func verifyFlowerSnapshot(ctx context.Context, state, id string) (flowerSnapshotManifest, error) {
	var manifest flowerSnapshotManifest
	if !validFlowerSnapshotID(id) {
		return manifest, errors.New("invalid snapshot ID")
	}
	if err := validateFlowerDestination(state, flowerMaintenanceDir+"/snapshots/"+id+"/manifest.json"); err != nil {
		return manifest, err
	}
	root := filepath.Join(state, flowerMaintenanceDir, "snapshots", id)
	if err := readMaintenanceJSON(filepath.Join(root, "manifest.json"), &manifest); err != nil {
		return manifest, err
	}
	if err := validateFlowerManifest(manifest, id); err != nil {
		return manifest, err
	}
	files, err := hashFlowerFiles(ctx, root)
	if err != nil {
		return manifest, err
	}
	if !reflect.DeepEqual(files, manifest.Files) {
		return manifest, errFlowerChecksum
	}
	for _, relative := range manifest.Roots {
		info, err := os.Lstat(filepath.Join(root, relative))
		if err != nil {
			return manifest, err
		}
		if flowerStorageTree(relative) && !info.IsDir() || !flowerStorageTree(relative) && !info.Mode().IsRegular() {
			return manifest, errors.New("invalid snapshot root type")
		}
	}
	return manifest, nil
}

func flowerReplacementPaths() []string {
	var paths []string
	for _, root := range append(append([]string{}, flowerStorageRoots[:3]...), "gateway/thread_read_state.sqlite") {
		for _, suffix := range []string{"", "-wal", "-shm", "-journal"} {
			paths = append(paths, root+suffix)
		}
	}
	return append(paths, flowerStorageRoots[3:]...)
}

func validateFlowerDestination(state, relative string) error {
	path := state
	for _, part := range strings.Split(relative, "/") {
		path = filepath.Join(path, part)
		info, err := os.Lstat(path)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return errors.New("storage destination contains a symlink")
		}
	}
	return nil
}

func flowerPathExists(path string) (bool, error) {
	_, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	return err == nil, err
}

func recoverFlowerReplacement(ctx context.Context, state string) error {
	return recoverFlowerReplacementWith(ctx, state, nil)
}

func recoverFlowerReplacementWith(ctx context.Context, state string, afterRename func() error) error {
	if err := validateFlowerStoragePaths(state); err != nil {
		return err
	}
	journal := filepath.Join(state, flowerMaintenanceDir, "restore.json")
	var operation flowerReplacement
	if err := readMaintenanceJSON(journal, &operation); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	paths := flowerReplacementPaths()
	// A released in-flight restore has the exact original path list and leaves
	// tool media untouched. Finish that operation before any new generation.
	if len(operation.Items) == len(paths)-1 {
		paths = paths[:len(paths)-1]
	}
	if operation.Format != 1 || !validFlowerSnapshotID(operation.ID) || !validFlowerSnapshotID(operation.SourceSnapshot) || operation.TargetBuild == "" || operation.Step < 0 || operation.Step > len(paths) || len(operation.Items) != len(paths) {
		return errors.New("invalid Flower replacement operation")
	}
	for i, item := range operation.Items {
		if item.Path != paths[i] {
			return errors.New("unexpected Flower replacement path")
		}
		if item.HasPrepared != slices.Contains(flowerStorageRoots, item.Path) {
			return errors.New("incomplete prepared Flower collection")
		}
	}
	seenFiles := make(map[string]bool)
	for _, file := range operation.Files {
		if !validFlowerManifestFile(file, false) || seenFiles[file.Path] {
			return errors.New("invalid prepared Flower checksum")
		}
		if !slices.ContainsFunc(operation.Items, func(item flowerReplacementItem) bool {
			return item.HasPrepared && (file.Path == item.Path || flowerStorageTree(item.Path) && strings.HasPrefix(file.Path, item.Path+"/"))
		}) {
			return errors.New("prepared Flower file has no replacement owner")
		}
		seenFiles[file.Path] = true
	}
	for _, path := range flowerStorageRoots[:3] {
		if !seenFiles[path] {
			return errors.New("prepared Flower database checksum is missing")
		}
	}
	root := filepath.Join(state, flowerMaintenanceDir, "restore-"+operation.ID)
	if err := validateFlowerDestination(state, flowerMaintenanceDir+"/restore-"+operation.ID); err != nil {
		return err
	}
	if err := verifyFlowerReplacementFiles(ctx, state, root, operation); err != nil {
		return err
	}
	for operation.Step < len(operation.Items) {
		if err := ctx.Err(); err != nil {
			return err
		}
		item := operation.Items[operation.Step]
		if err := validateFlowerDestination(state, item.Path); err != nil {
			return err
		}
		live := filepath.Join(state, item.Path)
		previous := filepath.Join(root, "previous", item.Path)
		prepared := filepath.Join(root, "prepared", item.Path)
		if item.HadOriginal {
			moved, err := flowerPathExists(previous)
			if err != nil {
				return err
			}
			if !moved {
				if err := os.MkdirAll(filepath.Dir(previous), 0700); err != nil {
					return err
				}
				if err := os.Rename(live, previous); err != nil {
					return err
				}
				if afterRename != nil {
					if err := afterRename(); err != nil {
						return err
					}
				}
				if err := syncFlowerDirectory(filepath.Dir(previous)); err != nil {
					return err
				}
				if err := syncFlowerDirectory(filepath.Dir(live)); err != nil {
					return err
				}
			}
		}
		if item.HasPrepared {
			pending, err := flowerPathExists(prepared)
			if err != nil {
				return err
			}
			if pending {
				if exists, err := flowerPathExists(live); err != nil {
					return err
				} else if exists {
					return errors.New("managed Flower replacement destination is occupied")
				}
				if err := os.MkdirAll(filepath.Dir(live), 0700); err != nil {
					return err
				}
				if err := os.Rename(prepared, live); err != nil {
					return err
				}
				if afterRename != nil {
					if err := afterRename(); err != nil {
						return err
					}
				}
				if err := syncFlowerDirectory(filepath.Dir(prepared)); err != nil {
					return err
				}
				if err := syncFlowerDirectory(filepath.Dir(live)); err != nil {
					return err
				}
			} else if exists, err := flowerPathExists(live); err != nil {
				return err
			} else if !exists {
				return errors.New("prepared Flower data is missing")
			}
		}
		operation.Step++
		if err := writeMaintenanceJSON(journal, operation); err != nil {
			return err
		}
	}
	// Verify the installed set before any database can be opened by a generation.
	for _, file := range operation.Files {
		if err := validateFlowerDestination(state, file.Path); err != nil {
			return err
		}
		actual, err := hashFlowerFile(ctx, filepath.Join(state, file.Path), file.Path)
		if err != nil {
			return err
		}
		if actual != file {
			return errFlowerChecksum
		}
	}
	if err := verifyPreparedFlowerStorage(ctx, state); err != nil {
		return err
	}
	if err := writeMaintenanceJSON(filepath.Join(state, flowerMaintenanceDir, "storage-generation.json"), flowerStorageGeneration{ID: operation.ID}); err != nil {
		return err
	}
	if err := os.Remove(journal); err != nil {
		return err
	}
	if err := syncFlowerDirectory(filepath.Dir(journal)); err != nil {
		return err
	}
	return os.RemoveAll(root)
}

func verifyPreparedFlowerStorage(ctx context.Context, state string) error {
	product, err := threadstore.Inspect(filepath.Join(state, flowerStorageRoots[0]))
	if err == nil && (!product.Exists || product.MigrationRequired) {
		err = errors.New("prepared product database is not current")
	}
	if err != nil {
		return flowerStorageError("product", "verifying", err)
	}
	floret, err := flruntime.InspectSQLite(ctx, filepath.Join(state, flowerStorageRoots[1]))
	if err == nil && (!floret.Exists || floret.MigrationRequired) {
		err = errors.New("prepared Floret database is not current")
	}
	if err != nil {
		return flowerStorageError("floret", "verifying", err)
	}
	reads, err := threadreadstate.Inspect(filepath.Join(state, flowerReadStateRelative))
	if err == nil && (!reads.Exists || reads.MigrationRequired) {
		err = errors.New("prepared read-state database is not current")
	}
	if err != nil {
		return flowerStorageError("read_state", "verifying", err)
	}
	return ctx.Err()
}
