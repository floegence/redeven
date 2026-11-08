package storagecontract

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOwnerPathsStayInsideEnvironment(t *testing.T) {
	root := t.TempDir()
	if got := PluginRoot(root); got != filepath.Join(root, "apps", "plugins", "platform") {
		t.Fatal(got)
	}
	if got := SkillsRoot(root); got != filepath.Join(root, "apps", "skills") {
		t.Fatal(got)
	}
}

func TestLegacyPluginStateFailsWithoutCreatingReplacement(t *testing.T) {
	root := t.TempDir()
	old := filepath.Join(root, "control.sqlite")
	if err := os.WriteFile(old, []byte("opaque upstream data"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := CheckPluginPlacement(root); err == nil {
		t.Fatal("legacy storage admitted")
	}
	if _, err := os.Stat(PluginRoot(root)); !os.IsNotExist(err) {
		t.Fatal("created replacement", err)
	}
	body, err := os.ReadFile(old)
	if err != nil || string(body) != "opaque upstream data" {
		t.Fatal("changed upstream data")
	}
}

func TestPluginRootRejectsSymlink(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Dir(PluginRoot(root)), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(t.TempDir(), PluginRoot(root)); err != nil {
		t.Fatal(err)
	}
	if err := CheckPluginPlacement(root); err == nil {
		t.Fatal("symlink admitted")
	}
}

func TestSkillsPlacementRejectsAliasesAndWrongTypes(t *testing.T) {
	for _, name := range []string{"apps", "apps/skills", "apps/skills/packages", "apps/skills/state.json", "apps/skills/sources.json", "apps/skills/state.json.tmp", "apps/skills/sources.json.tmp"} {
		for _, link := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/link=%v", name, link), func(t *testing.T) {
				root := t.TempDir()
				target := filepath.Join(root, filepath.FromSlash(name))
				if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
					t.Fatal(err)
				}
				var err error
				if link {
					err = os.Symlink(t.TempDir(), target)
				} else if strings.Contains(name, ".json") {
					err = os.Mkdir(target, 0700)
				} else {
					err = os.WriteFile(target, []byte("wrong type"), 0600)
				}
				if err != nil {
					t.Fatal(err)
				}
				if err := CheckSkillsPlacement(root); err == nil {
					t.Fatal("invalid placement admitted")
				}
			})
		}
	}
}

func TestPlacementFencesPendingJournalAndOrphanedSidecars(t *testing.T) {
	root := t.TempDir()
	journal := filepath.Join(root, "storage-relocation.json")
	if err := os.WriteFile(journal, []byte(`{"version":1,"status":"pending"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if CheckSkillsPlacement(root) == nil || CheckPluginPlacement(root) == nil {
		t.Fatal("incomplete relocation admitted")
	}
	if err := os.Remove(journal); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "control.sqlite-wal"), []byte("retained transaction"), 0600); err != nil {
		t.Fatal(err)
	}
	if CheckPluginPlacement(root) == nil {
		t.Fatal("orphaned sidecar admitted")
	}
}
