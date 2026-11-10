package ai

// Retired backup writers exist only to reproduce historical recovery fixtures.
// IMPORTANT: No production entry point may create or initiate a full snapshot.
import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"time"

	flstorage "github.com/floegence/floret/v7/storage"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/threadreadstate"
)

func captureFlowerSnapshot(ctx context.Context, state, build, kind string, raw bool) (manifest flowerSnapshotManifest, err error) {
	if err = validateFlowerStoragePaths(state); err != nil {
		return manifest, err
	}
	var nonce [16]byte
	if _, err = rand.Read(nonce[:]); err != nil {
		return manifest, err
	}
	id := hex.EncodeToString(nonce[:])
	parent := filepath.Join(state, flowerMaintenanceDir, "snapshots")
	if err = mkdirFlowerDirectories(parent); err != nil {
		return manifest, err
	}
	stage := filepath.Join(parent, ".pending-"+id)
	if err = os.Mkdir(stage, 0700); err != nil {
		return manifest, err
	}
	defer func() {
		if err != nil {
			_ = os.RemoveAll(stage)
		}
	}()
	manifest = flowerSnapshotManifest{Format: 1, FlowerSnapshotSummary: FlowerSnapshotSummary{ID: id, CreatedAt: time.Now().UTC(), SourceBuild: build, Kind: kind, Protected: raw}}
	readPath, err := threadreadstate.ExistingPath(state)
	if err != nil {
		return manifest, err
	}
	for index, relative := range flowerStorageRoots {
		if err = ctx.Err(); err != nil {
			return manifest, err
		}
		source := filepath.Join(state, relative)
		if relative == flowerReadStateRelative {
			source = readPath
		}
		info, statErr := os.Lstat(source)
		if errors.Is(statErr, os.ErrNotExist) {
			continue
		}
		if statErr != nil {
			return manifest, statErr
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return manifest, errors.New("managed Flower storage contains a symlink")
		}
		manifest.Roots = append(manifest.Roots, relative)
		destination := filepath.Join(stage, relative)
		if flowerStorageTree(relative) {
			if !info.IsDir() {
				return manifest, errors.New("managed Flower resource path is not a directory")
			}
			if err = copyFlowerTree(ctx, source, destination); err != nil {
				return manifest, err
			}
			continue
		}
		if !info.Mode().IsRegular() {
			return manifest, errors.New("managed Flower database is not a regular file")
		}
		if err = os.MkdirAll(filepath.Dir(destination), 0700); err != nil {
			return manifest, err
		}
		if raw {
			for _, suffix := range []string{"", "-wal", "-shm", "-journal"} {
				if _, statErr := os.Lstat(source + suffix); errors.Is(statErr, os.ErrNotExist) {
					continue
				} else if statErr != nil {
					return manifest, statErr
				}
				if err = copyFlowerFile(ctx, source+suffix, destination+suffix); err != nil {
					return manifest, err
				}
			}
		} else {
			switch index {
			case 0:
				err = threadstore.Backup(ctx, source, destination)
			case 1:
				err = flstorage.BackupSQLite(ctx, source, destination)
			case 2:
				err = threadreadstate.Backup(ctx, source, destination)
			}
			if err != nil {
				return manifest, err
			}
		}
	}
	manifest.Files, err = hashFlowerFiles(ctx, stage)
	if err != nil {
		return manifest, err
	}
	for _, file := range manifest.Files {
		manifest.Bytes += file.Size
	}
	if err = writeMaintenanceJSON(filepath.Join(stage, "manifest.json"), manifest); err != nil {
		return manifest, err
	}
	if err = syncFlowerTree(stage); err != nil {
		return manifest, err
	}
	if err = os.Rename(stage, filepath.Join(parent, id)); err != nil {
		return manifest, err
	}
	if err = syncFlowerDirectory(parent); err != nil {
		return manifest, err
	}
	return manifest, nil
}

func ListFlowerSnapshots(ctx context.Context, state string) ([]FlowerSnapshotSummary, error) {
	if err := validateFlowerDestination(state, flowerMaintenanceDir+"/snapshots"); err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(filepath.Join(state, flowerMaintenanceDir, "snapshots"))
	if errors.Is(err, os.ErrNotExist) {
		return []FlowerSnapshotSummary{}, nil
	}
	if err != nil {
		return nil, err
	}
	result := make([]FlowerSnapshotSummary, 0, len(entries))
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if !validFlowerSnapshotID(entry.Name()) {
			continue
		}
		var manifest flowerSnapshotManifest
		path := filepath.Join(flowerMaintenanceDir, "snapshots", entry.Name(), "manifest.json")
		manifestErr := validateFlowerDestination(state, filepath.ToSlash(path))
		if manifestErr == nil {
			manifestErr = readMaintenanceJSON(filepath.Join(state, path), &manifest)
		}
		if manifestErr == nil {
			manifestErr = validateFlowerManifest(manifest, entry.Name())
		}
		if manifestErr != nil {
			// A damaged backup must remain visible without hiding valid recovery choices.
			result = append(result, FlowerSnapshotSummary{ID: entry.Name(), Protected: true, Unavailable: true})
			continue
		}
		summary := manifest.FlowerSnapshotSummary
		summary.Protected = summary.Protected || summary.Kind == "before_restore"
		result = append(result, summary)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].CreatedAt.After(result[j].CreatedAt) })
	return result, nil
}

// RestoreFlowerSnapshot requires the controller to drain and close its current
// generation first. The administrator confirms the exact snapshot in the UI.
func RestoreFlowerSnapshot(ctx context.Context, opts Options, id string) (err error) {
	return flowerStorageError("recovery", "restoring", restoreFlowerSnapshotWith(ctx, opts, id, recoverFlowerReplacement))
}

func restoreFlowerSnapshotWith(ctx context.Context, opts Options, id string, replace func(context.Context, string) error) (err error) {
	if err := validateFlowerStoragePaths(opts.StateDir); err != nil {
		return err
	}
	if ctx == nil {
		return errors.New("restore context is required")
	}
	if err := recoverFlowerReplacement(ctx, opts.StateDir); err != nil {
		return flowerStorageError("recovery", "restoring", err)
	}
	manifest, err := verifyFlowerSnapshot(ctx, opts.StateDir, id)
	if err != nil {
		return flowerStorageError("recovery", "verifying", err)
	}
	build := strings.TrimSpace(opts.BuildVersion)
	if build == "" {
		build = "development"
	}
	if _, err := captureFlowerSnapshot(ctx, opts.StateDir, build, "before_restore", true); err != nil {
		return flowerStorageError("backup", "backing_up", err)
	}
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return err
	}
	operation := flowerReplacement{Format: 1, ID: hex.EncodeToString(nonce[:]), SourceSnapshot: id, TargetBuild: build}
	operationRoot := filepath.Join(opts.StateDir, flowerMaintenanceDir, "restore-"+operation.ID)
	stage := filepath.Join(operationRoot, "prepared")
	if err := os.MkdirAll(stage, 0700); err != nil {
		return err
	}
	journalPublished := false
	defer func() {
		if !journalPublished {
			_ = os.RemoveAll(operationRoot)
		}
	}()
	source := filepath.Join(opts.StateDir, flowerMaintenanceDir, "snapshots", id)
	for _, root := range manifest.Roots {
		if flowerStorageTree(root) {
			if err := copyFlowerTree(ctx, filepath.Join(source, root), filepath.Join(stage, root)); err != nil {
				return err
			}
		}
	}
	for _, file := range manifest.Files {
		if slices.ContainsFunc(flowerStorageRoots[3:], func(root string) bool { return strings.HasPrefix(file.Path, root+"/") }) {
			continue
		}
		if err := copyFlowerFile(ctx, filepath.Join(source, file.Path), filepath.Join(stage, file.Path)); err != nil {
			return err
		}
	}
	// Released snapshots did not include tool media. Preserve their previous
	// restore behavior by carrying the stopped generation's immutable bytes;
	// canonical retention will collect any unowned bytes after activation.
	mediaRoot := "computer/keyframes"
	if !slices.Contains(manifest.Roots, mediaRoot) {
		present, err := flowerPathExists(filepath.Join(opts.StateDir, mediaRoot))
		if err != nil {
			return err
		}
		if present {
			if err := copyFlowerTree(ctx, filepath.Join(opts.StateDir, mediaRoot), filepath.Join(stage, mediaRoot)); err != nil {
				return err
			}
		}
	}
	for _, root := range flowerStorageRoots[3:] {
		if err := os.MkdirAll(filepath.Join(stage, root), 0700); err != nil {
			return err
		}
	}
	// Migrate every owner's staged data and import historical queues while the
	// Host is deferred. Then Floret terminates both imported and existing work.
	stagedOpts := opts
	stagedOpts.StateDir, stagedOpts.DeferExecution, stagedOpts.skipStorageMaintenance = stage, true, true
	service, err := NewServiceContext(ctx, stagedOpts)
	if err != nil {
		if errors.Is(err, ErrFlowerGenerationClose) {
			journalPublished = true
		}
		return flowerStorageError("recovery", "restoring", err)
	}
	_, prepareErr := service.prepareFloretRestore(ctx)
	closeErr := service.Close()
	if closeErr != nil {
		journalPublished = true
	} // Preserve files still potentially owned by the staged generation.
	if err := errors.Join(prepareErr, closeErr); err != nil {
		return flowerStorageError("recovery", "restoring", err)
	}
	if err := verifyPreparedFlowerStorage(ctx, stage); err != nil {
		return err
	}
	operation.Files, err = hashFlowerFiles(ctx, stage)
	if err != nil {
		return err
	}
	for _, file := range operation.Files {
		if !validFlowerManifestFile(file, false) {
			return fmt.Errorf("unexpected staged Flower file %q", file.Path)
		}
	}
	for _, relative := range flowerReplacementPaths() {
		if err := validateFlowerDestination(opts.StateDir, relative); err != nil {
			return err
		}
		old, err := flowerPathExists(filepath.Join(opts.StateDir, relative))
		if err != nil {
			return err
		}
		prepared, err := flowerPathExists(filepath.Join(stage, relative))
		if err != nil {
			return err
		}
		operation.Items = append(operation.Items, flowerReplacementItem{relative, old, prepared})
		// Persist directory entries before publishing the operation journal.
		if err := os.MkdirAll(filepath.Join(operationRoot, "previous", filepath.Dir(relative)), 0700); err != nil {
			return err
		}
		if err := mkdirFlowerDirectories(filepath.Join(opts.StateDir, filepath.Dir(relative))); err != nil {
			return err
		}
	}
	if err := syncFlowerTree(operationRoot); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := writeMaintenanceJSON(filepath.Join(opts.StateDir, flowerMaintenanceDir, "restore.json"), operation); err != nil {
		return err
	}
	journalPublished = true
	return replace(ctx, opts.StateDir)
}
