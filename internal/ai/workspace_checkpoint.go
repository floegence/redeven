package ai

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	workspaceCheckpointBackendTar     = "tar"
	workspaceCheckpointSkippedPathCap = 128
)

type workspaceCheckpointMeta struct {
	Backend         string `json:"backend"`
	Root            string `json:"root"`
	CreatedAtUnixMs int64  `json:"created_at_unix_ms"`

	Tar *workspaceCheckpointTar `json:"tar,omitempty"`
}

type workspaceCheckpointSkippedPath struct {
	Path   string `json:"path"`
	Reason string `json:"reason"`
}

type workspaceCheckpointTar struct {
	ArchivePath  string                           `json:"archive_path"`
	ManifestPath string                           `json:"manifest_path"`
	Excludes     []string                         `json:"excludes"`
	Skipped      []workspaceCheckpointSkippedPath `json:"skipped,omitempty"`
}

type tarCheckpointManifest struct {
	Version  int                              `json:"version"`
	Root     string                           `json:"root"`
	Excludes []string                         `json:"excludes"`
	Files    []string                         `json:"files"`
	Skipped  []workspaceCheckpointSkippedPath `json:"skipped,omitempty"`
}

func checkpointArtifactsDir(stateDir string, checkpointID string) string {
	return filepath.Join(strings.TrimSpace(stateDir), "ai", "workspace_checkpoints", strings.TrimSpace(checkpointID))
}

func workspaceCheckpointArtifactsRoot(stateDir string) string {
	return filepath.Join(strings.TrimSpace(stateDir), "ai", "workspace_checkpoints")
}

func listWorkspaceCheckpointArtifactIDs(stateDir string) ([]string, error) {
	root := workspaceCheckpointArtifactsRoot(stateDir)
	if strings.TrimSpace(root) == "" {
		return nil, nil
	}
	entries, err := os.ReadDir(root)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry == nil || !entry.IsDir() {
			continue
		}
		name := strings.TrimSpace(entry.Name())
		if name == "" {
			continue
		}
		out = append(out, name)
	}
	sort.Strings(out)
	return out, nil
}

func removeWorkspaceCheckpointArtifacts(stateDir string, checkpointID string) error {
	checkpointID = strings.TrimSpace(checkpointID)
	if checkpointID == "" {
		return nil
	}
	dir := checkpointArtifactsDir(stateDir, checkpointID)
	if strings.TrimSpace(dir) == "" {
		return nil
	}
	if err := os.RemoveAll(dir); err != nil {
		return err
	}
	return nil
}

func defaultWorkspaceTarExcludes() []string {
	return []string{
		".git",
		"node_modules",
		".pnpm-store",
		"dist",
		"build",
		"out",
		"coverage",
		"target",
		".venv",
		"venv",
		".cache",
		".next",
		".turbo",
	}
}

func isExcludedDirName(name string, excludes []string) bool {
	name = strings.TrimSpace(name)
	if name == "" {
		return false
	}
	for _, ex := range excludes {
		if name == ex {
			return true
		}
	}
	return false
}

func isPermissionDeniedError(err error) bool {
	if err == nil {
		return false
	}
	return errors.Is(err, fs.ErrPermission) || errors.Is(err, os.ErrPermission)
}

func appendSkippedCheckpointPath(skipped []workspaceCheckpointSkippedPath, rootAbs string, targetPath string, reason string) []workspaceCheckpointSkippedPath {
	if len(skipped) >= workspaceCheckpointSkippedPathCap {
		return skipped
	}
	rootAbs = filepath.Clean(strings.TrimSpace(rootAbs))
	targetPath = filepath.Clean(strings.TrimSpace(targetPath))
	reason = strings.TrimSpace(reason)
	if rootAbs == "" || targetPath == "" || reason == "" {
		return skipped
	}
	rel, err := filepath.Rel(rootAbs, targetPath)
	if err != nil {
		return skipped
	}
	rel = filepath.ToSlash(strings.TrimSpace(rel))
	rel = strings.TrimPrefix(rel, "./")
	rel = strings.TrimPrefix(rel, "/")
	if rel == "" || rel == "." || strings.HasPrefix(rel, "../") {
		return skipped
	}
	for _, item := range skipped {
		if item.Path == rel && item.Reason == reason {
			return skipped
		}
	}
	return append(skipped, workspaceCheckpointSkippedPath{Path: rel, Reason: reason})
}

func createTarCheckpoint(ctx context.Context, stateDir string, checkpointID string, rootAbs string, createdAtUnixMs int64) (workspaceCheckpointMeta, error) {
	rootAbs = filepath.Clean(strings.TrimSpace(rootAbs))
	if rootAbs == "" || !filepath.IsAbs(rootAbs) {
		return workspaceCheckpointMeta{}, errors.New("invalid tar root")
	}

	dir := checkpointArtifactsDir(stateDir, checkpointID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return workspaceCheckpointMeta{}, err
	}

	excludes := defaultWorkspaceTarExcludes()
	archivePath := filepath.Join(dir, "snapshot.tar.gz")
	manifestPath := filepath.Join(dir, "manifest.json")

	f, err := os.OpenFile(archivePath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return workspaceCheckpointMeta{}, err
	}
	defer func() { _ = f.Close() }()

	gw := gzip.NewWriter(f)
	defer func() { _ = gw.Close() }()
	tw := tar.NewWriter(gw)
	defer func() { _ = tw.Close() }()

	files := make([]string, 0, 256)
	skipped := make([]workspaceCheckpointSkippedPath, 0, 8)
	walkErr := filepath.WalkDir(rootAbs, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			if isPermissionDeniedError(walkErr) {
				skipped = appendSkippedCheckpointPath(skipped, rootAbs, path, "walk_permission_denied")
				if d != nil && d.IsDir() {
					return fs.SkipDir
				}
				return nil
			}
			return walkErr
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if filepath.Clean(path) == rootAbs {
			return nil
		}
		if d.IsDir() {
			if isExcludedDirName(d.Name(), excludes) {
				return fs.SkipDir
			}
			return nil
		}

		rel, err := filepath.Rel(rootAbs, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		rel = strings.TrimPrefix(rel, "/")
		rel = strings.TrimSpace(rel)
		if rel == "" {
			return nil
		}

		info, err := os.Lstat(path)
		if err != nil {
			if isPermissionDeniedError(err) {
				skipped = appendSkippedCheckpointPath(skipped, rootAbs, path, "lstat_permission_denied")
				if d != nil && d.IsDir() {
					return fs.SkipDir
				}
				return nil
			}
			return err
		}
		mode := info.Mode()

		switch {
		case mode&os.ModeSymlink != 0:
			target, err := os.Readlink(path)
			if err != nil {
				if isPermissionDeniedError(err) {
					skipped = appendSkippedCheckpointPath(skipped, rootAbs, path, "readlink_permission_denied")
					return nil
				}
				return err
			}
			hdr := &tar.Header{
				Name:     rel,
				Typeflag: tar.TypeSymlink,
				Linkname: target,
				Mode:     int64(mode.Perm()),
				ModTime:  info.ModTime(),
			}
			if err := tw.WriteHeader(hdr); err != nil {
				return err
			}
			files = append(files, rel)
			return nil
		case mode.IsRegular():
			r, err := os.Open(path)
			if err != nil {
				if isPermissionDeniedError(err) {
					skipped = appendSkippedCheckpointPath(skipped, rootAbs, path, "open_permission_denied")
					return nil
				}
				return err
			}
			hdr := &tar.Header{
				Name:    rel,
				Mode:    int64(mode.Perm()),
				Size:    info.Size(),
				ModTime: info.ModTime(),
			}
			if err := tw.WriteHeader(hdr); err != nil {
				_ = r.Close()
				return err
			}
			_, copyErr := io.Copy(tw, r)
			_ = r.Close()
			if copyErr != nil {
				return copyErr
			}
			files = append(files, rel)
			return nil
		default:
			// Skip non-regular files.
			return nil
		}
	})
	if walkErr != nil {
		return workspaceCheckpointMeta{}, walkErr
	}

	sort.Strings(files)
	manifest := tarCheckpointManifest{
		Version:  2,
		Root:     rootAbs,
		Excludes: excludes,
		Files:    files,
		Skipped:  append([]workspaceCheckpointSkippedPath(nil), skipped...),
	}
	mb, err := json.Marshal(manifest)
	if err != nil {
		return workspaceCheckpointMeta{}, err
	}
	if err := os.WriteFile(manifestPath, mb, 0o600); err != nil {
		return workspaceCheckpointMeta{}, err
	}

	return workspaceCheckpointMeta{
		Backend:         workspaceCheckpointBackendTar,
		Root:            rootAbs,
		CreatedAtUnixMs: createdAtUnixMs,
		Tar: &workspaceCheckpointTar{
			ArchivePath:  archivePath,
			ManifestPath: manifestPath,
			Excludes:     excludes,
			Skipped:      append([]workspaceCheckpointSkippedPath(nil), skipped...),
		},
	}, nil
}
