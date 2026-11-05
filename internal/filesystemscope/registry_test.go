package filesystemscope

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/config"
)

func TestDefaultRegistryExposesHomeAndComputer(t *testing.T) {
	home := t.TempDir()
	reg, err := NewDefaultRegistry(home)
	if err != nil {
		t.Fatalf("NewDefaultRegistry: %v", err)
	}
	ctx := reg.PathContext()
	if ctx.HomePathAbs == "" || ctx.DefaultRootID != "home" {
		t.Fatalf("context = %#v", ctx)
	}
	if len(ctx.Roots) != 2 {
		t.Fatalf("roots len = %d, want 2", len(ctx.Roots))
	}
	for _, root := range ctx.Roots {
		if !root.Permissions.Read || !root.Permissions.Write {
			t.Fatalf("default root %s must allow read/write: %#v", root.ID, root.Permissions)
		}
	}
	if got, err := reg.Resolve("/", ResolveOptions{RequireExisting: true, RequireDir: true, ForWrite: true}); err != nil || got.RootID != "computer" {
		t.Fatalf("Resolve(/) = %#v, %v; want computer", got, err)
	}
}

func TestRegistryRevisionAdvancesOnlyAfterSuccessfulUpdate(t *testing.T) {
	home := t.TempDir()
	reg, err := NewDefaultRegistry(home)
	if err != nil {
		t.Fatalf("NewDefaultRegistry: %v", err)
	}
	if got := reg.Revision(); got != 1 {
		t.Fatalf("initial revision = %d, want 1", got)
	}
	if err := reg.UpdateFromConfig(&config.Config{AgentHomeDir: home}); err != nil {
		t.Fatalf("UpdateFromConfig: %v", err)
	}
	if got := reg.Revision(); got != 2 {
		t.Fatalf("updated revision = %d, want 2", got)
	}
	if err := reg.UpdateFromConfig(nil); err == nil {
		t.Fatal("nil config update succeeded")
	}
	if got := reg.Revision(); got != 2 {
		t.Fatalf("failed update revision = %d, want 2", got)
	}
}

func TestRegistryUsesLongestRootMatch(t *testing.T) {
	home := t.TempDir()
	project := filepath.Join(home, "project")
	if err := os.MkdirAll(project, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	reg, err := NewRegistry(&config.Config{
		AgentHomeDir: home,
		FilesystemScope: &config.FilesystemScope{
			SchemaVersion: config.FilesystemScopeSchemaVersionV1,
			DefaultRootID: "home",
			Roots: []config.FilesystemRootPolicy{
				{
					ID: "computer", Label: "Computer", Path: "/", Kind: config.FilesystemRootComputer,
					Permissions: config.FilesystemPermissionSet{Read: true},
				},
				{
					ID: "project", Label: "Project", Path: project, Kind: config.FilesystemRootCustom,
					Permissions: config.FilesystemPermissionSet{Read: true, Write: true},
				},
				{
					ID: "home", Label: "Home", Path: home, Kind: config.FilesystemRootHome,
					Permissions: config.FilesystemPermissionSet{Read: true, Write: true},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	resolved, err := reg.Resolve(project, ResolveOptions{RequireExisting: true, RequireDir: true, ForWrite: true})
	if err != nil {
		t.Fatalf("Resolve(project write): %v", err)
	}
	if resolved.RootID != "project" {
		t.Fatalf("RootID = %q, want project", resolved.RootID)
	}
}

func TestRegistryPreservesExplicitReadOnlyComputer(t *testing.T) {
	home := t.TempDir()
	scope := defaultScope(home)
	scope.Roots[1].Permissions.Write = false
	reg, err := NewRegistry(&config.Config{AgentHomeDir: home, FilesystemScope: scope})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := reg.Resolve(computerRootPath(), ResolveOptions{ForWrite: true, RequireExisting: true, RequireDir: true}); !errors.Is(err, ErrWriteDenied) {
		t.Fatalf("explicit read-only Computer write error = %v, want %v", err, ErrWriteDenied)
	}
	if _, err := reg.Resolve(home, ResolveOptions{ForWrite: true, RequireExisting: true, RequireDir: true}); err != nil {
		t.Fatalf("writable Home must remain writable: %v", err)
	}
}

func TestRegistryRejectsSymlinkEscape(t *testing.T) {
	home := t.TempDir()
	outside := t.TempDir()
	link := filepath.Join(home, "escape")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatalf("Symlink: %v", err)
	}
	reg, err := NewRegistry(&config.Config{
		AgentHomeDir: home,
		FilesystemScope: &config.FilesystemScope{
			SchemaVersion: config.FilesystemScopeSchemaVersionV1,
			DefaultRootID: "home",
			Roots: []config.FilesystemRootPolicy{
				{
					ID: "home", Label: "Home", Path: home, Kind: config.FilesystemRootHome,
					Permissions: config.FilesystemPermissionSet{Read: true, Write: true},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	if _, err := reg.Resolve(link, ResolveOptions{RequireExisting: true, RequireDir: true}); !errors.Is(err, ErrPathOutsideScope) {
		t.Fatalf("Resolve(symlink escape) error = %v, want %v", err, ErrPathOutsideScope)
	}
}

func TestPrivateRootsComposeWithoutLosingTaskIsolation(t *testing.T) {
	home := t.TempDir()
	tasks, projects := filepath.Join(t.TempDir(), "tasks"), filepath.Join(t.TempDir(), "projects")
	tasksParent, err := filepath.EvalSymlinks(filepath.Dir(tasks))
	if err != nil {
		t.Fatal(err)
	}
	tasks = filepath.Join(tasksParent, "tasks")
	projectsParent, err := filepath.EvalSymlinks(filepath.Dir(projects))
	if err != nil {
		t.Fatal(err)
	}
	projects = filepath.Join(projectsParent, "projects")
	ownTask, otherTask := filepath.Join(tasks, "current"), filepath.Join(tasks, "other")
	ownSource, otherSource := filepath.Join(projects, "current", "source"), filepath.Join(projects, "other", "source")
	for _, p := range []string{ownTask, otherTask, ownSource, otherSource} {
		if err := os.MkdirAll(p, 0700); err != nil {
			t.Fatal(err)
		}
	}
	registry, err := NewDefaultRegistry(home)
	if err != nil {
		t.Fatal(err)
	}
	registry, err = registry.WithPrivateRoot(tasks, ownTask)
	if err != nil {
		t.Fatal(err)
	}
	registry, err = registry.WithPrivateRoot(projects, ownSource)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{ownTask, ownSource, home} {
		if _, err := registry.Resolve(p, ResolveOptions{RequireDir: true, ForWrite: true}); err != nil {
			t.Fatalf("authorized path %s: %v", p, err)
		}
	}
	// The logical path must remain private even if its target is otherwise allowed.
	escape := filepath.Join(otherTask, "escape")
	if err := os.Symlink(home, escape); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{otherTask, otherSource, filepath.Dir(ownSource), tasks, projects, escape} {
		if _, err := registry.Resolve(p, ResolveOptions{RequireDir: true}); !errors.Is(err, ErrPathOutsideScope) {
			t.Fatalf("private path %s: %v", p, err)
		}
	}
}
