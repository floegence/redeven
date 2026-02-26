package ai

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	workspaceCheckpointBackendGitTree = "git_tree"
	workspaceCheckpointBackendTar     = "tar"
)

type workspaceCheckpointMeta struct {
	Backend         string `json:"backend"`
	Root            string `json:"root"`
	CreatedAtUnixMs int64  `json:"created_at_unix_ms"`

	Git *workspaceCheckpointGit `json:"git,omitempty"`
	Tar *workspaceCheckpointTar `json:"tar,omitempty"`
}

type workspaceCheckpointGit struct {
	RepoRoot  string   `json:"repo_root"`
	Tree      string   `json:"tree"`
	Untracked []string `json:"untracked"`
}

type workspaceCheckpointTar struct {
	ArchivePath  string   `json:"archive_path"`
	ManifestPath string   `json:"manifest_path"`
	Excludes     []string `json:"excludes"`
}

type tarCheckpointManifest struct {
	Version  int      `json:"version"`
	Root     string   `json:"root"`
	Excludes []string `json:"excludes"`
	Files    []string `json:"files"`
}

func checkpointArtifactsDir(stateDir string, checkpointID string) string {
	return filepath.Join(strings.TrimSpace(stateDir), "ai", "workspace_checkpoints", strings.TrimSpace(checkpointID))
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

func ensureAbsPathWithinRoot(rootAbs string, targetAbs string) (string, error) {
	rootAbs = filepath.Clean(strings.TrimSpace(rootAbs))
	targetAbs = filepath.Clean(strings.TrimSpace(targetAbs))
	if rootAbs == "" || targetAbs == "" {
		return "", errors.New("invalid path")
	}
	if rootAbs == targetAbs {
		return targetAbs, nil
	}
	prefix := rootAbs + string(os.PathSeparator)
	if !strings.HasPrefix(targetAbs, prefix) {
		return "", errors.New("path escapes root")
	}
	return targetAbs, nil
}

func runGitCombinedOutput(ctx context.Context, repoRoot string, env []string, args ...string) ([]byte, error) {
	repoRoot = strings.TrimSpace(repoRoot)
	if repoRoot == "" {
		return nil, errors.New("missing repo root")
	}
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", repoRoot}, args...)...)
	if len(env) > 0 {
		cmd.Env = append([]string(nil), env...)
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			msg = err.Error()
		}
		return nil, fmt.Errorf("git %s failed: %s", strings.Join(args, " "), msg)
	}
	return out, nil
}

func gitShowTopLevel(ctx context.Context, dir string) (string, bool) {
	out, err := runGitCombinedOutput(ctx, dir, nil, "rev-parse", "--show-toplevel")
	if err != nil {
		return "", false
	}
	root := strings.TrimSpace(string(out))
	if root == "" {
		return "", false
	}
	return filepath.Clean(root), true
}

func parseZList(b []byte) []string {
	if len(b) == 0 {
		return nil
	}
	parts := strings.Split(string(b), "\x00")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		out = append(out, p)
	}
	return out
}

func createWorkspaceCheckpoint(ctx context.Context, stateDir string, checkpointID string, workingDirAbs string) (workspaceCheckpointMeta, error) {
	meta := workspaceCheckpointMeta{}
	if ctx == nil {
		ctx = context.Background()
	}
	stateDir = strings.TrimSpace(stateDir)
	checkpointID = strings.TrimSpace(checkpointID)
	workingDirAbs = filepath.Clean(strings.TrimSpace(workingDirAbs))
	if stateDir == "" || checkpointID == "" || workingDirAbs == "" || !filepath.IsAbs(workingDirAbs) {
		return meta, errors.New("invalid workspace checkpoint request")
	}

	now := time.Now().UnixMilli()
	if now <= 0 {
		now = 1
	}

	if repoRoot, ok := gitShowTopLevel(ctx, workingDirAbs); ok {
		cp, err := createGitTreeCheckpoint(ctx, stateDir, checkpointID, repoRoot, now)
		if err == nil {
			return cp, nil
		}
		// Fall back to tar on git failures to keep rewind available for non-standard repos.
	}
	return createTarCheckpoint(ctx, stateDir, checkpointID, workingDirAbs, now)
}

func createGitTreeCheckpoint(ctx context.Context, stateDir string, checkpointID string, repoRoot string, createdAtUnixMs int64) (workspaceCheckpointMeta, error) {
	repoRoot = filepath.Clean(strings.TrimSpace(repoRoot))
	if repoRoot == "" || !filepath.IsAbs(repoRoot) {
		return workspaceCheckpointMeta{}, errors.New("invalid git repo root")
	}

	dir := checkpointArtifactsDir(stateDir, checkpointID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return workspaceCheckpointMeta{}, err
	}
	indexPath := filepath.Join(dir, "git.index")

	untrackedRaw, err := runGitCombinedOutput(ctx, repoRoot, nil, "ls-files", "--others", "--exclude-standard", "-z")
	if err != nil {
		return workspaceCheckpointMeta{}, err
	}
	untracked := parseZList(untrackedRaw)

	env := append([]string(nil), os.Environ()...)
	env = append(env, "GIT_INDEX_FILE="+indexPath)

	if _, err := runGitCombinedOutput(ctx, repoRoot, env, "add", "-A"); err != nil {
		return workspaceCheckpointMeta{}, err
	}
	treeRaw, err := runGitCombinedOutput(ctx, repoRoot, env, "write-tree")
	if err != nil {
		return workspaceCheckpointMeta{}, err
	}
	tree := strings.TrimSpace(string(treeRaw))
	if tree == "" {
		return workspaceCheckpointMeta{}, errors.New("git write-tree returned empty tree")
	}

	return workspaceCheckpointMeta{
		Backend:         workspaceCheckpointBackendGitTree,
		Root:            repoRoot,
		CreatedAtUnixMs: createdAtUnixMs,
		Git: &workspaceCheckpointGit{
			RepoRoot:  repoRoot,
			Tree:      tree,
			Untracked: untracked,
		},
	}, nil
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
	walkErr := filepath.WalkDir(rootAbs, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
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
			return err
		}
		mode := info.Mode()

		switch {
		case mode&os.ModeSymlink != 0:
			target, err := os.Readlink(path)
			if err != nil {
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
			hdr := &tar.Header{
				Name:    rel,
				Mode:    int64(mode.Perm()),
				Size:    info.Size(),
				ModTime: info.ModTime(),
			}
			if err := tw.WriteHeader(hdr); err != nil {
				return err
			}
			r, err := os.Open(path)
			if err != nil {
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
		Version:  1,
		Root:     rootAbs,
		Excludes: excludes,
		Files:    files,
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
		},
	}, nil
}

func restoreWorkspaceCheckpoint(ctx context.Context, stateDir string, checkpointID string, meta workspaceCheckpointMeta) error {
	if ctx == nil {
		ctx = context.Background()
	}
	stateDir = strings.TrimSpace(stateDir)
	checkpointID = strings.TrimSpace(checkpointID)
	if stateDir == "" || checkpointID == "" {
		return errors.New("invalid restore request")
	}

	switch strings.TrimSpace(meta.Backend) {
	case workspaceCheckpointBackendGitTree:
		if meta.Git == nil {
			return errors.New("missing git checkpoint payload")
		}
		return restoreGitTreeCheckpoint(ctx, stateDir, checkpointID, meta)
	case workspaceCheckpointBackendTar:
		if meta.Tar == nil {
			return errors.New("missing tar checkpoint payload")
		}
		return restoreTarCheckpoint(ctx, meta)
	default:
		return fmt.Errorf("unknown workspace checkpoint backend: %q", strings.TrimSpace(meta.Backend))
	}
}

func restoreGitTreeCheckpoint(ctx context.Context, stateDir string, checkpointID string, meta workspaceCheckpointMeta) error {
	repoRoot := filepath.Clean(strings.TrimSpace(meta.Root))
	if repoRoot == "" || !filepath.IsAbs(repoRoot) {
		repoRoot = filepath.Clean(strings.TrimSpace(meta.Git.RepoRoot))
	}
	if repoRoot == "" || !filepath.IsAbs(repoRoot) {
		return errors.New("invalid git repo root")
	}
	tree := strings.TrimSpace(meta.Git.Tree)
	if tree == "" {
		return errors.New("missing git tree")
	}

	dir := checkpointArtifactsDir(stateDir, checkpointID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	indexPath := filepath.Join(dir, "restore.index")

	env := append([]string(nil), os.Environ()...)
	env = append(env, "GIT_INDEX_FILE="+indexPath)

	if _, err := runGitCombinedOutput(ctx, repoRoot, env, "read-tree", tree); err != nil {
		return err
	}
	if _, err := runGitCombinedOutput(ctx, repoRoot, env, "checkout-index", "-a", "-f"); err != nil {
		return err
	}

	snapshotFilesRaw, err := runGitCombinedOutput(ctx, repoRoot, nil, "ls-tree", "-r", "-z", "--name-only", tree)
	if err != nil {
		return err
	}
	snapshotFiles := make(map[string]struct{}, 1024)
	for _, p := range parseZList(snapshotFilesRaw) {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		snapshotFiles[p] = struct{}{}
	}

	trackedRaw, err := runGitCombinedOutput(ctx, repoRoot, nil, "ls-files", "-z")
	if err != nil {
		return err
	}
	for _, p := range parseZList(trackedRaw) {
		if _, ok := snapshotFiles[p]; ok {
			continue
		}
		abs := filepath.Clean(filepath.Join(repoRoot, filepath.FromSlash(p)))
		if _, err := ensureAbsPathWithinRoot(repoRoot, abs); err != nil {
			continue
		}
		_ = os.Remove(abs)
	}

	untrackedKeep := map[string]struct{}{}
	for _, p := range meta.Git.Untracked {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		untrackedKeep[p] = struct{}{}
	}
	untrackedNowRaw, err := runGitCombinedOutput(ctx, repoRoot, nil, "ls-files", "--others", "--exclude-standard", "-z")
	if err != nil {
		return err
	}
	for _, p := range parseZList(untrackedNowRaw) {
		if _, ok := untrackedKeep[p]; ok {
			continue
		}
		abs := filepath.Clean(filepath.Join(repoRoot, filepath.FromSlash(p)))
		if _, err := ensureAbsPathWithinRoot(repoRoot, abs); err != nil {
			continue
		}
		_ = os.Remove(abs)
	}

	return nil
}

func restoreTarCheckpoint(ctx context.Context, meta workspaceCheckpointMeta) error {
	rootAbs := filepath.Clean(strings.TrimSpace(meta.Root))
	if rootAbs == "" || !filepath.IsAbs(rootAbs) {
		return errors.New("invalid tar root")
	}
	archivePath := filepath.Clean(strings.TrimSpace(meta.Tar.ArchivePath))
	manifestPath := filepath.Clean(strings.TrimSpace(meta.Tar.ManifestPath))
	if archivePath == "" || manifestPath == "" {
		return errors.New("missing tar artifacts")
	}

	mb, err := os.ReadFile(manifestPath)
	if err != nil {
		return err
	}
	var manifest tarCheckpointManifest
	if err := json.Unmarshal(mb, &manifest); err != nil {
		return err
	}
	excludes := manifest.Excludes
	if len(excludes) == 0 {
		excludes = meta.Tar.Excludes
	}
	if len(excludes) == 0 {
		excludes = defaultWorkspaceTarExcludes()
	}

	keep := make(map[string]struct{}, len(manifest.Files))
	for _, p := range manifest.Files {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		keep[p] = struct{}{}
	}

	// Delete files that are not present in the checkpoint manifest (excluding large/ignored dirs).
	var removePaths []string
	_ = filepath.WalkDir(rootAbs, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
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
		if _, ok := keep[rel]; ok {
			return nil
		}
		removePaths = append(removePaths, path)
		return nil
	})
	sort.Slice(removePaths, func(i, j int) bool { return len(removePaths[i]) > len(removePaths[j]) })
	for _, p := range removePaths {
		_ = os.Remove(p)
	}

	af, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer func() { _ = af.Close() }()

	gr, err := gzip.NewReader(af)
	if err != nil {
		return err
	}
	defer func() { _ = gr.Close() }()
	tr := tar.NewReader(gr)

	for {
		hdr, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return err
		}
		name := strings.TrimSpace(hdr.Name)
		if name == "" {
			continue
		}
		target := filepath.Clean(filepath.Join(rootAbs, filepath.FromSlash(name)))
		if _, err := ensureAbsPathWithinRoot(rootAbs, target); err != nil {
			return err
		}

		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, fs.FileMode(hdr.Mode)&0o777); err != nil {
				return err
			}
		case tar.TypeSymlink:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			_ = os.Remove(target)
			if err := os.Symlink(hdr.Linkname, target); err != nil {
				return err
			}
		case tar.TypeReg, '\x00':
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			f, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, fs.FileMode(hdr.Mode)&0o777)
			if err != nil {
				return err
			}
			if _, err := io.Copy(f, tr); err != nil {
				_ = f.Close()
				return err
			}
			_ = f.Close()
			_ = os.Chtimes(target, time.Now(), hdr.ModTime)
		default:
			// ignore
		}
	}
	return nil
}
