package ai

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	flstorage "github.com/floegence/floret/v7/storage"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/threadreadstate"
)

const flowerMaintenanceDir = "flower-maintenance"
const flowerReadStateRelative = "apps/appserver/thread_read_state.sqlite"

var flowerStorageRoots = []string{"ai/threads.sqlite", "ai/floret_threads.sqlite", flowerReadStateRelative, "ai/uploads"}

// FlowerSnapshotSummary contains no conversation, database, or credential data.
type FlowerSnapshotSummary struct {
	ID          string    `json:"id"`
	CreatedAt   time.Time `json:"created_at"`
	SourceBuild string    `json:"source_build"`
	Bytes       int64     `json:"bytes"`
	Kind        string    `json:"kind"`
	Protected   bool      `json:"protected"`
	Unavailable bool      `json:"unavailable,omitempty"`
}

type flowerSnapshotFile struct {
	Path   string `json:"path"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

type flowerSnapshotManifest struct {
	Format int `json:"format"`
	FlowerSnapshotSummary
	Roots []string             `json:"roots"`
	Files []flowerSnapshotFile `json:"files"`
}

type flowerUpgradeOperation struct {
	Format           int    `json:"format"`
	TargetBuild      string `json:"target_build"`
	OriginalSnapshot string `json:"original_snapshot"`
	Complete         bool   `json:"complete"`
}

var flowerExecutableBuild = sync.OnceValues(func() (string, error) {
	path, err := os.Executable()
	if err != nil {
		return "", err
	}
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
})

func flowerBuildID(version string) (string, error) {
	hash, err := flowerExecutableBuild()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(version) + ":" + hash, nil
}

func flowerOperationPath(state string) string {
	return filepath.Join(state, flowerMaintenanceDir, "upgrade.json")
}

func readFlowerUpgrade(state string) (*flowerUpgradeOperation, error) {
	var operation flowerUpgradeOperation
	err := readMaintenanceJSON(flowerOperationPath(state), &operation)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if operation.Format != 1 || operation.TargetBuild == "" || operation.OriginalSnapshot != "" && !validFlowerSnapshotID(operation.OriginalSnapshot) {
		return nil, errors.New("unsupported Flower upgrade operation")
	}
	return &operation, nil
}

// prepareFlowerStorage runs while no service generation owns any Flower file.
func prepareFlowerStorage(ctx context.Context, opts Options) error {
	if err := validateFlowerStoragePaths(opts.StateDir); err != nil {
		return flowerStorageError("recovery", "inspecting", err)
	}
	if err := recoverFlowerReplacement(ctx, opts.StateDir); err != nil {
		return flowerStorageError("recovery", "restoring", err)
	}
	if err := cleanupFlowerStaging(opts.StateDir); err != nil {
		return flowerStorageError("backup", "inspecting", err)
	}
	reportFloretStorePhase(opts.StoreStartupProgress, FloretStoreStartupInspecting)
	readPath, err := threadreadstate.ExistingPath(opts.StateDir)
	if err != nil {
		return flowerStorageError("read_state", "inspecting", err)
	}
	product, err := threadstore.Inspect(filepath.Join(opts.StateDir, flowerStorageRoots[0]))
	if err != nil {
		return flowerStorageError("product", "inspecting", err)
	}
	floret, err := flruntime.InspectSQLite(ctx, filepath.Join(opts.StateDir, flowerStorageRoots[1]))
	if err != nil {
		return flowerStorageError("floret", "inspecting", err)
	}
	reads, err := threadreadstate.Inspect(readPath)
	if err != nil {
		return flowerStorageError("read_state", "inspecting", err)
	}
	build, err := flowerBuildID(opts.BuildVersion)
	if err != nil {
		return flowerStorageError("backup", "backing_up", err)
	}
	operation, err := readFlowerUpgrade(opts.StateDir)
	if err != nil {
		return flowerStorageError("backup", "inspecting", err)
	}
	if operation != nil && !operation.Complete {
		// A changed binary may repair a failed migration. Preserve the first
		// source snapshot even when this attempt targets that newer build.
		if operation.OriginalSnapshot != "" {
			if _, err := verifyFlowerSnapshot(ctx, opts.StateDir, operation.OriginalSnapshot); err != nil {
				return flowerStorageError("backup", "verifying", err)
			}
		}
		operation.TargetBuild = build
		return writeMaintenanceJSON(flowerOperationPath(opts.StateDir), operation)
	}
	migration := product.MigrationRequired || floret.MigrationRequired || reads.MigrationRequired
	if operation != nil && operation.TargetBuild == build && !migration {
		return nil
	}
	next := &flowerUpgradeOperation{Format: 1, TargetBuild: build}
	existing := product.Exists || floret.Exists || reads.Exists
	if info, err := os.Stat(filepath.Join(opts.StateDir, "ai", "uploads")); err == nil {
		existing = existing || info.IsDir()
	} else if !errors.Is(err, os.ErrNotExist) {
		return flowerStorageError("uploads", "inspecting", err)
	}
	if existing {
		reportFloretStorePhase(opts.StoreStartupProgress, FloretStoreStartupBackingUp)
		sourceBuild := "before-maintenance-baseline"
		if operation != nil {
			sourceBuild = operation.TargetBuild
		}
		snapshot, err := captureFlowerSnapshot(ctx, opts.StateDir, sourceBuild, "automatic", false)
		if err != nil {
			return flowerStorageError("backup", "backing_up", err)
		}
		next.OriginalSnapshot = snapshot.ID
	}
	if err := writeMaintenanceJSON(flowerOperationPath(opts.StateDir), next); err != nil {
		return flowerStorageError("backup", "backing_up", err)
	}
	return nil
}

func completeFlowerUpgrade(state string) error {
	operation, err := readFlowerUpgrade(state)
	if err != nil || operation == nil || operation.Complete {
		return err
	}
	operation.Complete = true
	return writeMaintenanceJSON(flowerOperationPath(state), operation)
}

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
		if index == 3 {
			if !info.IsDir() {
				return manifest, errors.New("managed Flower uploads path is not a directory")
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
	operation, operationErr := readFlowerUpgrade(state)
	// Damaged operation metadata must not hide recovery choices. Retention
	// protects all snapshots until the operation can be understood or replaced.
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
		summary.Protected = operationErr != nil || summary.Kind == "before_restore" || operation != nil && !operation.Complete && operation.OriginalSnapshot == summary.ID
		result = append(result, summary)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].CreatedAt.After(result[j].CreatedAt) })
	return result, nil
}

func pruneFlowerSnapshots(ctx context.Context, state string) error {
	snapshots, err := ListFlowerSnapshots(ctx, state)
	if err != nil {
		return err
	}
	count := 0
	for _, snapshot := range snapshots {
		if snapshot.Unavailable || snapshot.Kind != "automatic" {
			continue
		}
		count++
		if count <= 3 || snapshot.Protected {
			continue
		}
		if err := os.RemoveAll(filepath.Join(state, flowerMaintenanceDir, "snapshots", snapshot.ID)); err != nil {
			return err
		}
	}
	return nil
}

func validFlowerSnapshotID(id string) bool {
	decoded, err := hex.DecodeString(id)
	return err == nil && len(decoded) == 16 && strings.ToLower(id) == id
}

func readMaintenanceJSON(path string, out any) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() > 32<<20 {
		return errors.New("invalid maintenance JSON file")
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	decoder := json.NewDecoder(file)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return errors.New("unexpected maintenance JSON data")
	}
	return nil
}

func writeMaintenanceJSON(path string, value any) (err error) {
	if err = mkdirFlowerDirectories(filepath.Dir(path)); err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".write-")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if err = json.NewEncoder(file).Encode(value); err != nil {
		_ = file.Close()
		return err
	}
	if err = errors.Join(file.Sync(), file.Close()); err != nil {
		return err
	}
	if err = os.Rename(file.Name(), path); err != nil {
		return err
	}
	return syncFlowerDirectory(filepath.Dir(path))
}

type flowerContextReader struct {
	ctx context.Context
	io.Reader
}

func (r flowerContextReader) Read(bytes []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.Reader.Read(bytes)
}

func copyFlowerFile(ctx context.Context, source, destination string) (err error) {
	info, err := os.Lstat(source)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("managed Flower snapshot contains a non-regular file")
	}
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	if err = os.MkdirAll(filepath.Dir(destination), 0700); err != nil {
		return err
	}
	out, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	hash := sha256.New()
	size, copyErr := io.Copy(out, io.TeeReader(flowerContextReader{ctx, in}, hash))
	if err := errors.Join(copyErr, out.Sync(), out.Close()); err != nil {
		return err
	}
	verified, err := hashFlowerFile(ctx, destination, "")
	if err != nil {
		return err
	}
	if verified.Size != size || verified.SHA256 != hex.EncodeToString(hash.Sum(nil)) {
		return errors.New("copied Flower file checksum mismatch")
	}
	return nil
}

func hashFlowerFile(ctx context.Context, path, relative string) (flowerSnapshotFile, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return flowerSnapshotFile{}, err
	}
	if !info.Mode().IsRegular() {
		return flowerSnapshotFile{}, errors.New("snapshot contains a non-regular file")
	}
	file, err := os.Open(path)
	if err != nil {
		return flowerSnapshotFile{}, err
	}
	hash := sha256.New()
	size, copyErr := io.Copy(hash, flowerContextReader{ctx, file})
	if err := errors.Join(copyErr, file.Close()); err != nil {
		return flowerSnapshotFile{}, err
	}
	return flowerSnapshotFile{relative, size, hex.EncodeToString(hash.Sum(nil))}, nil
}

func copyFlowerTree(ctx context.Context, source, destination string) error {
	return filepath.WalkDir(source, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		target := filepath.Join(destination, relative)
		if entry.IsDir() {
			return os.MkdirAll(target, 0700)
		}
		return copyFlowerFile(ctx, path, target)
	})
}

func hashFlowerFiles(ctx context.Context, root string) ([]flowerSnapshotFile, error) {
	var result []flowerSnapshotFile
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		if relative == "manifest.json" {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return errors.New("snapshot contains a non-regular file")
		}
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		hash := sha256.New()
		size, copyErr := io.Copy(hash, flowerContextReader{ctx, file})
		if err := errors.Join(copyErr, file.Close()); err != nil {
			return err
		}
		result = append(result, flowerSnapshotFile{filepath.ToSlash(relative), size, hex.EncodeToString(hash.Sum(nil))})
		return nil
	})
	return result, err
}

func syncFlowerDirectory(path string) error {
	dir, err := os.Open(path)
	if err != nil {
		return err
	}
	return errors.Join(dir.Sync(), dir.Close())
}

func syncFlowerTree(root string) error {
	var dirs []string
	if err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err == nil && entry.IsDir() {
			dirs = append(dirs, path)
		}
		return err
	}); err != nil {
		return err
	}
	for i := len(dirs) - 1; i >= 0; i-- {
		if err := syncFlowerDirectory(dirs[i]); err != nil {
			return fmt.Errorf("sync snapshot directory: %w", err)
		}
	}
	return nil
}
