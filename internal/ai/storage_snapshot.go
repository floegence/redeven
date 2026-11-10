package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const flowerMaintenanceDir = "flower-maintenance"
const flowerReadStateRelative = "apps/appserver/thread_read_state.sqlite"

var flowerStorageRoots = []string{"ai/threads.sqlite", "ai/floret_threads.sqlite", flowerReadStateRelative, "ai/uploads", "computer/keyframes"}

func flowerStorageTree(root string) bool {
	for _, tree := range flowerStorageRoots[3:] {
		if root == tree {
			return true
		}
	}
	return false
}

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

// prepareFlowerStorage runs while no service generation owns any Flower file.
// Owners validate and migrate their databases once when they open them.
func prepareFlowerStorage(ctx context.Context, opts Options) error {
	if err := validateFlowerStoragePaths(opts.StateDir); err != nil {
		return flowerStorageError("recovery", "inspecting", err)
	}
	if err := recoverFlowerReplacement(ctx, opts.StateDir); err != nil {
		return flowerStorageError("recovery", "restoring", err)
	}
	if err := cleanupFlowerStaging(opts.StateDir); err != nil {
		return flowerStorageError("recovery", "inspecting", err)
	}
	return ctx.Err()
}

// Retire obsolete build-driven bookkeeping only after the current data activates.
func removeObsoleteFlowerUpgrade(state string) error {
	path := filepath.Join(state, flowerMaintenanceDir, "upgrade.json")
	if err := os.Remove(path); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	return syncFlowerDirectory(filepath.Dir(path))
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
