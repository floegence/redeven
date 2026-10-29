package filesystemscope

import (
	"os"
	"path/filepath"
	"testing"
)

func TestOpenReadRejectsChangedCanonicalPath(t *testing.T) {
	for _, swapParent := range []bool{false, true} {
		t.Run(map[bool]string{false: "file", true: "parent"}[swapParent], func(t *testing.T) {
			home, outside := t.TempDir(), t.TempDir()
			parent := filepath.Join(home, "project")
			if err := os.Mkdir(parent, 0700); err != nil {
				t.Fatal(err)
			}
			file := filepath.Join(parent, "AGENTS.md")
			if err := os.WriteFile(file, []byte("authorized"), 0600); err != nil {
				t.Fatal(err)
			}
			other := filepath.Join(outside, "AGENTS.md")
			if err := os.WriteFile(other, []byte("outside"), 0600); err != nil {
				t.Fatal(err)
			}
			registry, err := NewDefaultRegistry(home)
			if err != nil {
				t.Fatal(err)
			}
			resolved, err := registry.Resolve(file, ResolveOptions{RequireExisting: true})
			if err != nil {
				t.Fatal(err)
			}
			from, to := file, other
			if swapParent {
				from, to = parent, outside
			}
			if err := os.Rename(from, from+".old"); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(to, from); err != nil {
				t.Fatal(err)
			}
			if handle, err := registry.openResolvedRead(resolved); err == nil {
				handle.Close()
				t.Fatal("read escaped the resolved path")
			}
		})
	}
}

func TestOpenReadRetainsDirectoryAndSymlinkPolicy(t *testing.T) {
	home := t.TempDir()
	registry, err := NewDefaultRegistry(home)
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(home, "AGENTS.md")
	if err := os.WriteFile(file, []byte("rules"), 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(home, "rules-link")
	if err := os.Symlink(file, link); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{home, file, link} {
		handle, err := registry.OpenRead(name)
		if err != nil {
			t.Fatal(err)
		}
		handle.Close()
	}
}

func TestOpenReadRejectsReplacedConfiguredRoot(t *testing.T) {
	home, outside := t.TempDir(), t.TempDir()
	for _, dir := range []string{home, outside} {
		if err := os.WriteFile(filepath.Join(dir, "AGENTS.md"), []byte("rules"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	registry, err := NewDefaultRegistry(home)
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := registry.Resolve(filepath.Join(home, "AGENTS.md"), ResolveOptions{RequireExisting: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(home, home+".old"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(home + ".old") })
	if err := os.Symlink(outside, home); err != nil {
		t.Fatal(err)
	}
	if handle, err := registry.openResolvedRead(resolved); err == nil {
		handle.Close()
		t.Fatal("replaced configured root accepted")
	}
}
