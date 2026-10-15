package ai

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestSkillActivationCannotReuseDisabledOrRestrictedCache(t *testing.T) {
	root := t.TempDir()
	writeContextTestSkill(t, root, "Current catalog")
	mgr := newSkillManager(root, root)
	mgr.userHome = root
	if _, err := mgr.modelContextCatalog(t.Context(), "full_access"); err != nil {
		t.Fatal(err)
	}
	first, cached, err := mgr.Activate("complete-context", "full_access", false)
	if err != nil || cached {
		t.Fatalf("activation=%+v cached=%v err=%v", first, cached, err)
	}
	if _, err := mgr.PatchToggles([]SkillTogglePatch{{Path: first.ContentRef, Enabled: false}}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := mgr.Activate(first.Name, "full_access", false); err == nil {
		t.Fatal("disabled active cache was reused")
	}
	if len(mgr.Active()) != 0 || containsContextTestSkill(mgr.List("full_access"), first.Name) {
		t.Fatal("disabled catalog entry remained available")
	}
	if _, err := mgr.PatchToggles([]SkillTogglePatch{{Path: first.ContentRef, Enabled: true}}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := mgr.Activate(first.Name, "full_access", false); err != nil {
		t.Fatal(err)
	}
	raw := "---\nname: complete-context\ndescription: Restricted catalog\npermission_hint: [full_access]\n---\nRestricted body.\n"
	if err := os.WriteFile(first.ContentRef, []byte(raw), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := mgr.modelContextCatalog(t.Context(), "full_access"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := mgr.Activate(first.Name, "read_only", false); err == nil {
		t.Fatal("restricted active cache was reused")
	}
	if err := os.RemoveAll(filepath.Dir(first.ContentRef)); err != nil {
		t.Fatal(err)
	}
	if _, err := mgr.modelContextCatalog(t.Context(), "full_access"); err != nil {
		t.Fatal(err)
	}
	if len(mgr.Active()) != 0 {
		t.Fatal("deleted skill remained active after authoritative discovery")
	}
}

func TestSkillDiscoveryFailedSourcesRemainErrorsUntilRepaired(t *testing.T) {
	for _, source := range []string{"state", "sources"} {
		t.Run(source, func(t *testing.T) {
			root := t.TempDir()
			mgr := newSkillManager(root, root)
			mgr.userHome = root
			path := mgr.statePath
			if source == "sources" {
				path = mgr.sourcePath
			}
			if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, []byte("broken-json"), 0600); err != nil {
				t.Fatal(err)
			}
			for range 2 {
				if _, err := mgr.modelContextCatalog(t.Context(), "full_access"); err == nil {
					t.Fatal("invalid source was accepted by the request collector")
				}
				if len(mgr.Catalog().Errors) == 0 {
					t.Fatal("failed source silently became valid on retry")
				}
			}
			if err := os.WriteFile(path, []byte("{}"), 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := mgr.modelContextCatalog(t.Context(), "full_access"); err != nil || len(mgr.Catalog().Errors) != 0 {
				t.Fatalf("repaired source did not recover: %v %+v", err, mgr.Catalog())
			}
			ctx, cancel := context.WithCancel(t.Context())
			cancel()
			version := mgr.Catalog().CatalogVersion
			if _, err := mgr.modelContextCatalog(ctx, "full_access"); err != context.Canceled || mgr.Catalog().CatalogVersion != version {
				t.Fatalf("cancelled discovery mutated catalog: %v", err)
			}
		})
	}
}

func containsContextTestSkill(skills []SkillMeta, name string) bool {
	for _, skill := range skills {
		if skill.Name == name {
			return true
		}
	}
	return false
}

func TestRequestCatalogObservesOtherManagerToggleAndSourceChanges(t *testing.T) {
	root := t.TempDir()
	writeContextTestSkill(t, root, "Shared catalog")
	running := newSkillManager(root, root)
	running.userHome = root
	settings := newSkillManager(root, root)
	settings.userHome = root
	if _, err := running.modelContextCatalog(t.Context(), "full_access"); err != nil {
		t.Fatal(err)
	}
	activation, _, err := running.Activate("complete-context", "full_access", false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := settings.PatchToggles([]SkillTogglePatch{{Path: activation.ContentRef, Enabled: false}}); err != nil {
		t.Fatal(err)
	}
	catalog, err := running.modelContextCatalog(t.Context(), "full_access")
	if err != nil || containsContextTestSkill(catalog, activation.Name) || len(running.Active()) != 0 {
		t.Fatalf("disabled catalog=%+v active=%+v err=%v", catalog, running.Active(), err)
	}
	if _, _, err := running.Activate(activation.Name, "full_access", false); err == nil {
		t.Fatal("disabled skill reactivated from another manager's stale cache")
	}
	if _, err := settings.PatchToggles([]SkillTogglePatch{{Path: activation.ContentRef, Enabled: true}}); err != nil {
		t.Fatal(err)
	}
	catalog, err = running.modelContextCatalog(t.Context(), "full_access")
	if err != nil || !containsContextTestSkill(catalog, activation.Name) {
		t.Fatalf("re-enabled catalog=%+v err=%v", catalog, err)
	}
	if err := os.WriteFile(running.sourcePath, []byte("broken-json"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := running.modelContextCatalog(t.Context(), "full_access"); err == nil {
		t.Fatal("previously valid source cache hid a new source failure")
	}
	if err := os.WriteFile(running.sourcePath, []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := running.modelContextCatalog(t.Context(), "full_access"); err != nil {
		t.Fatal(err)
	}
}
