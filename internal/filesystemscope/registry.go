package filesystemscope

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/pathutil"
)

var (
	ErrPathOutsideScope = errors.New("path outside filesystem scope")
	ErrReadDenied       = errors.New("read permission denied")
	ErrWriteDenied      = errors.New("write permission denied")
	ErrPathNotDirectory = errors.New("path is not a directory")
)

type PermissionSet struct {
	Read  bool
	Write bool
}

type RootKind string

const (
	RootKindHome     RootKind = "home"
	RootKindComputer RootKind = "computer"
	RootKindCustom   RootKind = "custom"
)

type Root struct {
	ID          string
	Label       string
	PathAbs     string
	PathReal    string
	Kind        RootKind
	Permissions PermissionSet
	Hidden      bool
	System      bool
}

type PathContext struct {
	HomePathAbs   string
	DefaultRootID string
	Roots         []Root
}

type ResolvedPath struct {
	RootID      string
	RootLabel   string
	InputPath   string
	LogicalAbs  string
	RealAbs     string
	Relative    string
	Permissions PermissionSet
}

type ResolveOptions struct {
	RequireExisting bool
	RequireDir      bool
	ForWrite        bool
}

type Registry struct {
	mu            sync.RWMutex
	homeAbs       string
	defaultRootID string
	roots         []Root
	byID          map[string]Root
}

func NewRegistry(cfg *config.Config) (*Registry, error) {
	snapshot, err := buildSnapshot(cfg)
	if err != nil {
		return nil, err
	}
	return &Registry{
		homeAbs:       snapshot.homeAbs,
		defaultRootID: snapshot.defaultRootID,
		roots:         snapshot.roots,
		byID:          snapshot.byID,
	}, nil
}

func (r *Registry) UpdateFromConfig(cfg *config.Config) error {
	if r == nil {
		return errors.New("nil filesystem scope")
	}
	snapshot, err := buildSnapshot(cfg)
	if err != nil {
		return err
	}
	r.mu.Lock()
	r.homeAbs = snapshot.homeAbs
	r.defaultRootID = snapshot.defaultRootID
	r.roots = snapshot.roots
	r.byID = snapshot.byID
	r.mu.Unlock()
	return nil
}

type registrySnapshot struct {
	homeAbs       string
	defaultRootID string
	roots         []Root
	byID          map[string]Root
}

func buildSnapshot(cfg *config.Config) (registrySnapshot, error) {
	if cfg == nil {
		return registrySnapshot{}, errors.New("nil config")
	}
	homeAbs, err := resolveHomeAbs(cfg.AgentHomeDir)
	if err != nil {
		return registrySnapshot{}, err
	}
	scope := cfg.FilesystemScope
	if scope == nil {
		scope = defaultScope(homeAbs)
	}
	if err := scope.Validate(); err != nil {
		return registrySnapshot{}, err
	}
	roots := make([]Root, 0, len(scope.Roots))
	for _, policy := range scope.Roots {
		root, err := rootFromPolicy(policy, homeAbs)
		if err != nil {
			return registrySnapshot{}, err
		}
		roots = append(roots, root)
	}
	sort.SliceStable(roots, func(i, j int) bool {
		return len(roots[i].PathReal) > len(roots[j].PathReal)
	})
	byID := make(map[string]Root, len(roots))
	for _, root := range roots {
		byID[root.ID] = root
	}
	defaultRootID := strings.TrimSpace(scope.DefaultRootID)
	if defaultRootID == "" {
		defaultRootID = "home"
	}
	if _, ok := byID[defaultRootID]; !ok && len(roots) > 0 {
		defaultRootID = roots[0].ID
	}
	return registrySnapshot{
		homeAbs:       homeAbs,
		defaultRootID: defaultRootID,
		roots:         roots,
		byID:          byID,
	}, nil
}

func NewDefaultRegistry(homeDir string) (*Registry, error) {
	return NewRegistry(&config.Config{AgentHomeDir: homeDir})
}

func (r *Registry) HomePathAbs() string {
	if r == nil {
		return ""
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.homeAbs
}

func (r *Registry) DefaultRootPath() string {
	if r == nil {
		return ""
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if root, ok := r.byID[r.defaultRootID]; ok {
		return root.PathAbs
	}
	if len(r.roots) > 0 {
		return r.roots[0].PathAbs
	}
	return r.homeAbs
}

func (r *Registry) PathContext() PathContext {
	if r == nil {
		return PathContext{}
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	roots := make([]Root, len(r.roots))
	copy(roots, r.roots)
	return PathContext{
		HomePathAbs:   r.homeAbs,
		DefaultRootID: r.defaultRootID,
		Roots:         roots,
	}
}

func (r *Registry) Resolve(path string, opts ResolveOptions) (ResolvedPath, error) {
	if r == nil {
		return ResolvedPath{}, errors.New("nil filesystem scope")
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	input := strings.TrimSpace(path)
	if input == "" {
		input = r.defaultRootPathLocked()
	}
	logicalAbs, err := r.normalizeInputLocked(input)
	if err != nil {
		return ResolvedPath{}, err
	}
	var realAbs string
	if opts.RequireExisting || opts.RequireDir {
		realAbs, err = pathutil.CanonicalizeExistingPathAbs(logicalAbs)
	} else {
		realAbs, err = resolvePathViaExistingAncestor(logicalAbs)
	}
	if err != nil {
		return ResolvedPath{}, err
	}
	resolved, err := r.resolveRealLocked(input, logicalAbs, realAbs)
	if err != nil {
		return ResolvedPath{}, err
	}
	if opts.RequireDir {
		info, err := os.Stat(resolved.RealAbs)
		if err != nil {
			return ResolvedPath{}, err
		}
		if !info.IsDir() {
			return ResolvedPath{}, ErrPathNotDirectory
		}
	}
	if opts.ForWrite {
		if !resolved.Permissions.Write {
			return ResolvedPath{}, ErrWriteDenied
		}
	} else if !resolved.Permissions.Read {
		return ResolvedPath{}, ErrReadDenied
	}
	return resolved, nil
}

func (r *Registry) ResolveTarget(path string, opts ResolveOptions) (ResolvedPath, error) {
	opts.RequireExisting = false
	return r.Resolve(path, opts)
}

func (r *Registry) Contains(path string) (ResolvedPath, bool) {
	resolved, err := r.Resolve(path, ResolveOptions{})
	return resolved, err == nil
}

func (r *Registry) NormalizeInput(path string) (string, error) {
	if r == nil {
		return "", errors.New("nil filesystem scope")
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.normalizeInputLocked(path)
}

func (r *Registry) defaultRootPathLocked() string {
	if root, ok := r.byID[r.defaultRootID]; ok {
		return root.PathAbs
	}
	if len(r.roots) > 0 {
		return r.roots[0].PathAbs
	}
	return r.homeAbs
}

func (r *Registry) normalizeInputLocked(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "~" || strings.HasPrefix(path, "~/") {
		if r.homeAbs == "" {
			return "", errors.New("missing runtime home directory")
		}
		if path == "~" {
			return r.homeAbs, nil
		}
		return filepath.Clean(filepath.Join(r.homeAbs, strings.TrimPrefix(path, "~/"))), nil
	}
	if !filepath.IsAbs(path) {
		return "", errors.New("path must be absolute")
	}
	return filepath.Clean(path), nil
}

func (r *Registry) resolveRealLocked(input string, logicalAbs string, realAbs string) (ResolvedPath, error) {
	realAbs = filepath.Clean(strings.TrimSpace(realAbs))
	if realAbs == "" {
		return ResolvedPath{}, errors.New("invalid path")
	}
	for _, root := range r.roots {
		if !pathWithin(realAbs, root.PathReal) {
			continue
		}
		rel, err := filepath.Rel(root.PathReal, realAbs)
		if err != nil {
			return ResolvedPath{}, err
		}
		rel = filepath.Clean(rel)
		if rel == "." {
			rel = ""
		}
		return ResolvedPath{
			RootID:      root.ID,
			RootLabel:   root.Label,
			InputPath:   input,
			LogicalAbs:  filepath.Clean(logicalAbs),
			RealAbs:     realAbs,
			Relative:    rel,
			Permissions: root.Permissions,
		}, nil
	}
	return ResolvedPath{}, ErrPathOutsideScope
}

func resolveHomeAbs(homeDir string) (string, error) {
	homeDir = strings.TrimSpace(homeDir)
	if homeDir == "" {
		home, _ := os.UserHomeDir()
		homeDir = strings.TrimSpace(home)
	}
	if homeDir == "" {
		return "", errors.New("missing runtime home dir")
	}
	return pathutil.CanonicalizeExistingDirAbs(homeDir)
}

func defaultScope(homeAbs string) *config.FilesystemScope {
	return &config.FilesystemScope{
		SchemaVersion: config.FilesystemScopeSchemaVersionV1,
		DefaultRootID: "home",
		Roots: []config.FilesystemRootPolicy{
			{
				ID:    "home",
				Label: "Home",
				Path:  homeAbs,
				Kind:  config.FilesystemRootHome,
				Permissions: config.FilesystemPermissionSet{
					Read:  true,
					Write: true,
				},
				System: true,
			},
			{
				ID:    "computer",
				Label: "Computer",
				Path:  computerRootPath(),
				Kind:  config.FilesystemRootComputer,
				Permissions: config.FilesystemPermissionSet{
					Read:  true,
					Write: false,
				},
				System: true,
			},
		},
	}
}

func rootFromPolicy(policy config.FilesystemRootPolicy, homeAbs string) (Root, error) {
	path := strings.TrimSpace(policy.Path)
	if path == "~" || strings.HasPrefix(path, "~/") {
		if path == "~" {
			path = homeAbs
		} else {
			path = filepath.Join(homeAbs, strings.TrimPrefix(path, "~/"))
		}
	}
	pathAbs, err := pathutil.CanonicalizeExistingDirAbs(path)
	if err != nil {
		return Root{}, fmt.Errorf("invalid root %s: %w", strings.TrimSpace(policy.ID), err)
	}
	return Root{
		ID:       strings.TrimSpace(policy.ID),
		Label:    strings.TrimSpace(policy.Label),
		PathAbs:  pathAbs,
		PathReal: pathAbs,
		Kind:     RootKind(policy.Kind),
		Permissions: PermissionSet{
			Read:  policy.Permissions.Read,
			Write: policy.Permissions.Write,
		},
		Hidden: policy.Hidden,
		System: policy.System,
	}, nil
}

func pathWithin(pathAbs string, rootAbs string) bool {
	pathAbs = filepath.Clean(strings.TrimSpace(pathAbs))
	rootAbs = filepath.Clean(strings.TrimSpace(rootAbs))
	if pathAbs == "" || rootAbs == "" {
		return false
	}
	if pathAbs == rootAbs {
		return true
	}
	rel, err := filepath.Rel(rootAbs, pathAbs)
	if err != nil {
		return false
	}
	rel = filepath.Clean(rel)
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator))
}

func resolvePathViaExistingAncestor(path string) (string, error) {
	path = filepath.Clean(strings.TrimSpace(path))
	if path == "" {
		return "", errors.New("missing path")
	}
	if !filepath.IsAbs(path) {
		return "", errors.New("path must be absolute")
	}

	current := path
	tail := make([]string, 0, 4)
	for {
		if _, err := os.Lstat(current); err == nil {
			resolved, err := filepath.EvalSymlinks(current)
			if err != nil {
				return "", err
			}
			resolved = filepath.Clean(resolved)
			for i := len(tail) - 1; i >= 0; i-- {
				resolved = filepath.Join(resolved, tail[i])
			}
			return filepath.Clean(resolved), nil
		} else if !errors.Is(err, os.ErrNotExist) {
			return "", err
		}

		parent := filepath.Dir(current)
		if parent == current {
			return "", fmt.Errorf("failed to resolve existing ancestor for %q", path)
		}
		tail = append(tail, filepath.Base(current))
		current = parent
	}
}
