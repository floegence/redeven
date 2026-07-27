package gitruntime

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// ResolveRepositoryIdentity resolves and admits an identity before exposing it.
// A successful identity remains in the bounded inactive registry after this
// call; operations and snapshots retain their own explicit leases.
func (r *Runtime) ResolveRepositoryIdentity(ctx context.Context, path string) (RepositoryIdentity, bool, error) {
	if r == nil {
		return RepositoryIdentity{}, false, ErrResourceLimit
	}
	if topologyLeaseHeld(ctx) {
		return r.resolveRepositoryIdentityLocked(ctx, path)
	}
	releaseTopology, err := r.topology.acquire(ctx, false)
	if err != nil {
		return RepositoryIdentity{}, false, err
	}
	defer releaseTopology()
	return r.resolveRepositoryIdentityLocked(ctx, path)
}

// resolveRepositoryIdentityLocked requires the caller to hold either side of
// the topology gate. It exists for filesystem coordination, whose exclusive
// topology lease must cover both overlap scans and the final effect.
func (r *Runtime) resolveRepositoryIdentityLocked(ctx context.Context, path string) (RepositoryIdentity, bool, error) {
	if r == nil || path == "" || !filepath.IsAbs(path) {
		return RepositoryIdentity{}, false, errors.New("repository lookup path must be absolute")
	}
	lookup, err := nearestExistingDirectory(filepath.Clean(path))
	if err != nil {
		return RepositoryIdentity{}, false, err
	}
	root, ok, err := r.revParsePath(ctx, lookup, "--show-toplevel")
	if err != nil || !ok {
		return RepositoryIdentity{}, false, err
	}
	commonDir, ok, err := r.revParsePath(ctx, root, "--path-format=absolute", "--git-common-dir")
	if err != nil || !ok {
		return RepositoryIdentity{}, false, err
	}
	gitDir, ok, err := r.revParsePath(ctx, root, "--path-format=absolute", "--git-dir")
	if err != nil || !ok {
		return RepositoryIdentity{}, false, err
	}
	root, rootFSID, err := canonicalPathIdentity(root)
	if err != nil {
		return RepositoryIdentity{}, false, err
	}
	commonDir, commonFSID, err := canonicalPathIdentity(commonDir)
	if err != nil {
		return RepositoryIdentity{}, false, err
	}
	gitDir, gitFSID, err := canonicalPathIdentity(gitDir)
	if err != nil {
		return RepositoryIdentity{}, false, err
	}
	id := RepositoryIdentity{
		CommonRepoKey: identityDigest(commonDir, commonFSID),
		WorktreeKey:   identityDigest(root, rootFSID, gitDir, gitFSID),
		WorktreeRoot:  root,
		CommonDir:     commonDir,
		GitDir:        gitDir,
	}
	coord, err := r.retainIdentity(id)
	if err != nil {
		return RepositoryIdentity{}, false, err
	}
	_ = coord
	r.releaseIdentity(id)
	return id, true, nil
}

func repositoryIdentityCurrent(id RepositoryIdentity) bool {
	root, rootFSID, rootErr := canonicalPathIdentity(id.WorktreeRoot)
	commonDir, commonFSID, commonErr := canonicalPathIdentity(id.CommonDir)
	gitDir, gitFSID, gitErr := canonicalPathIdentity(id.GitDir)
	return rootErr == nil && commonErr == nil && gitErr == nil &&
		root == id.WorktreeRoot && commonDir == id.CommonDir && gitDir == id.GitDir &&
		identityDigest(commonDir, commonFSID) == id.CommonRepoKey &&
		identityDigest(root, rootFSID, gitDir, gitFSID) == id.WorktreeKey
}

// RepositoryIdentityCurrent verifies that every filesystem object bound into
// an admitted repository identity still resolves to the same stable identity.
// Callers that already hold a topology lease may use this without reacquiring
// the topology gate.
func (r *Runtime) RepositoryIdentityCurrent(id RepositoryIdentity) bool {
	return r != nil && id.validate() == nil && repositoryIdentityCurrent(id)
}

func (r *Runtime) revParsePath(ctx context.Context, dir string, args ...string) (string, bool, error) {
	result, err := r.RunRead(ctx, dir, nil, append([]string{"rev-parse"}, args...)...)
	if err != nil {
		var executableErr *exec.Error
		if errors.Is(err, exec.ErrNotFound) || (errors.As(err, &executableErr) && errors.Is(executableErr.Err, exec.ErrNotFound)) {
			return "", false, err
		}
		var commandErr *CommandError
		if errors.As(err, &commandErr) && !commandErr.BudgetExceeded && !commandErr.UnknownOutcome {
			message := strings.ToLower(string(result.Stderr))
			if strings.Contains(message, "not a git repository") || strings.Contains(message, "must be run in a work tree") {
				return "", false, nil
			}
		}
		return "", false, err
	}
	value := trimOneLineEnding(result.Stdout)
	if value == "" || !filepath.IsAbs(value) {
		return "", false, errors.New("git returned a non-absolute identity path")
	}
	return filepath.Clean(value), true, nil
}

func trimOneLineEnding(value []byte) string {
	if len(value) > 0 && value[len(value)-1] == '\n' {
		value = value[:len(value)-1]
		if len(value) > 0 && value[len(value)-1] == '\r' {
			value = value[:len(value)-1]
		}
	}
	return string(value)
}

func nearestExistingDirectory(path string) (string, error) {
	for {
		info, err := os.Lstat(path)
		if err == nil {
			if info.IsDir() {
				return path, nil
			}
			return filepath.Dir(path), nil
		}
		if !os.IsNotExist(err) {
			return "", err
		}
		parent := filepath.Dir(path)
		if parent == path {
			return "", os.ErrNotExist
		}
		path = parent
	}
}

func canonicalPathIdentity(path string) (string, string, error) {
	canonical, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", "", err
	}
	canonical = filepath.Clean(canonical)
	info, err := os.Stat(canonical)
	if err != nil {
		return "", "", err
	}
	identity, err := stableFileIdentity(info)
	if err != nil {
		return "", "", err
	}
	return canonical, identity, nil
}

func identityDigest(parts ...string) string {
	h := sha256.New()
	for _, part := range parts {
		h.Write([]byte(part))
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))
}

func isPathWithin(path, root string) bool {
	rel, err := filepath.Rel(root, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
