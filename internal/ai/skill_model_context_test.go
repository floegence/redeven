package ai

import (
	"context"
	"os"
	"path/filepath"
	"strings"
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
	first, cached, err := mgr.Activate(t.Context(), "complete-context", "full_access", false)
	if err != nil || cached {
		t.Fatalf("activation=%+v cached=%v err=%v", first, cached, err)
	}
	if _, err := mgr.PatchToggles([]SkillTogglePatch{{Path: first.ContentRef, Enabled: false}}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := mgr.Activate(t.Context(), first.Name, "full_access", false); err == nil {
		t.Fatal("disabled active cache was reused")
	}
	if len(mgr.active) != 0 || containsContextTestSkill(mgr.List("full_access"), first.Name) {
		t.Fatal("disabled catalog entry remained available")
	}
	if _, err := mgr.PatchToggles([]SkillTogglePatch{{Path: first.ContentRef, Enabled: true}}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := mgr.Activate(t.Context(), first.Name, "full_access", false); err != nil {
		t.Fatal(err)
	}
	raw := "---\nname: complete-context\ndescription: Restricted catalog\npermission_hint: [full_access]\n---\nRestricted body.\n"
	if err := os.WriteFile(first.ContentRef, []byte(raw), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := mgr.modelContextCatalog(t.Context(), "full_access"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := mgr.Activate(t.Context(), first.Name, "readonly", false); err == nil {
		t.Fatal("restricted active cache was reused")
	}
	if err := os.RemoveAll(filepath.Dir(first.ContentRef)); err != nil {
		t.Fatal(err)
	}
	if _, err := mgr.modelContextCatalog(t.Context(), "full_access"); err != nil {
		t.Fatal(err)
	}
	if len(mgr.active) != 0 {
		t.Fatal("deleted skill remained active after authoritative discovery")
	}
}

func TestSkillActivationRechecksCurrentAuthorityWithoutCatalogRefresh(t *testing.T) {
	for _, change := range []string{"body", "disabled", "deleted", "restricted", "renamed", "read_failure", "parse_failure", "state_failure", "source_failure", "cancelled"} {
		t.Run(change, func(t *testing.T) {
			root := t.TempDir()
			path := writeSkillReadFixture(t, root, "Current catalog", "BODY_A")
			mgr := newSkillManager(root, root)
			mgr.userHome = root
			r := newRun(runOptions{AgentHomeDir: root, WorkingDir: root, SkillManager: mgr})
			ctx := contextWithToolAuthorizationSnapshot(t.Context(), PermissionSnapshot{SnapshotID: "skill-test", PermissionType: FlowerPermissionApprovalRequired})
			first, active, err := r.activateSkill(ctx, "complete-context")
			if err != nil || active || first.Content != "BODY_A" {
				t.Fatalf("first activation=%+v active=%v err=%v", first, active, err)
			}
			switch change {
			case "cancelled":
				cancelled, cancel := context.WithCancel(ctx)
				cancel()
				ctx = cancelled
			case "body":
				writeSkillReadFixture(t, root, "Current catalog", "BODY_B")
			case "disabled":
				settings := newSkillManager(root, root)
				settings.userHome = root
				if _, err := settings.PatchToggles([]SkillTogglePatch{{Path: path, Enabled: false}}); err != nil {
					t.Fatal(err)
				}
			case "deleted":
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
			case "read_failure":
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
				// A directory fails ReadFile deterministically, including for privileged users.
				if err := os.Mkdir(path, 0700); err != nil {
					t.Fatal(err)
				}
			default:
				target, raw := path, "not a skill"
				switch change {
				case "restricted":
					raw = "---\nname: complete-context\ndescription: Current catalog\npermission_hint: [full_access]\n---\nBODY_B"
				case "renamed":
					raw = "---\nname: different-skill\ndescription: Current catalog\n---\nBODY_B"
				case "state_failure":
					target = mgr.statePath
				case "source_failure":
					target = mgr.sourcePath
				}
				if err := os.WriteFile(target, []byte(raw), 0600); err != nil {
					t.Fatal(err)
				}
			}
			next, active, err := r.activateSkill(ctx, first.Name)
			if change == "body" {
				if err != nil || !active || next.Content != "BODY_B" || next.ActivationID != first.ActivationID || next.ActivatedAt != first.ActivatedAt {
					t.Fatalf("fresh read=%+v active=%v err=%v", next, active, err)
				}
			} else if err == nil || next.Content != "" || active {
				t.Fatalf("unavailable skill returned cached instructions: %+v active=%v err=%v", next, active, err)
			}
			if first.Content != "BODY_A" {
				t.Fatal("previously returned instructions changed")
			}
		})
	}
}

func TestSkillActivationRefreshesMetadataAndEmbeddedInstructions(t *testing.T) {
	root := t.TempDir()
	path := writeSkillReadFixture(t, root, "Current catalog", "BODY_A")
	mgr := newSkillManager(root, root)
	mgr.userHome = root
	first, _, err := mgr.Activate(t.Context(), "complete-context", "full_access", false)
	if err != nil {
		t.Fatal(err)
	}
	raw := "---\nname: complete-context\ndescription: Current catalog\npriority: 42\npermission_hint: [full_access]\npolicy:\n  allow_implicit_invocation: false\ndependencies:\n  mcp_servers:\n    - name: current-server\n---\nBODY_B"
	if err := os.WriteFile(path, []byte(raw), 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := mgr.Activate(t.Context(), first.Name, "full_access", true); err == nil {
		t.Fatal("current implicit-invocation policy was ignored")
	}
	next, active, err := mgr.Activate(t.Context(), first.Name, "full_access", false)
	if err != nil || !active || next.Content != "BODY_B" || next.Priority != 42 || len(next.PermissionHints) != 1 || next.PermissionHints[0] != "full_access" || len(next.Dependencies) != 1 || next.Dependencies[0].Name != "current-server" {
		t.Fatalf("current metadata=%+v active=%v err=%v", next, active, err)
	}
	if len(first.PermissionHints) != 0 || len(first.Dependencies) != 0 {
		t.Fatal("historical metadata changed")
	}
	for i := range 2 {
		embedded, active, err := mgr.Activate(t.Context(), "redeven-environment", "full_access", false)
		if err != nil || embedded.Content == "" || active != (i > 0) {
			t.Fatalf("embedded read=%+v active=%v err=%v", embedded, active, err)
		}
	}
}

func TestSkillCatalogRepeatedDiscoveryKeepsStableOrderAndText(t *testing.T) {
	root := t.TempDir()
	mgr := newSkillManager(root, root)
	mgr.userHome = root
	for _, source := range []string{".agents", ".redeven"} {
		for _, name := range []string{"zeta", "alpha", "middle"} {
			dir := filepath.Join(root, source, "skills", name)
			if err := os.MkdirAll(dir, 0700); err != nil {
				t.Fatal(err)
			}
			priority := "0"
			if name == "middle" {
				priority = "100"
			}
			raw := "---\nname: " + name + "\ndescription: From " + source + "\npriority: " + priority + "\n---\nBody."
			if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte(raw), 0600); err != nil {
				t.Fatal(err)
			}
		}
	}
	var first string
	for range 8 {
		catalog, err := mgr.modelContextCatalog(t.Context(), "full_access")
		if err != nil {
			t.Fatal(err)
		}
		text := buildSkillCatalogPrompt(catalog)
		if first == "" {
			first = text
		} else if text != first {
			t.Fatal("unchanged discovery altered model-visible catalog")
		}
		if !strings.Contains(text, "- middle: From .redeven\n- alpha: From .redeven") || strings.Contains(text, "From .agents") || strings.Index(text, "- zeta:") < strings.Index(text, "- alpha:") {
			t.Fatalf("precedence or order changed: %s", text)
		}
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
	activation, _, err := running.Activate(t.Context(), "complete-context", "full_access", false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := settings.PatchToggles([]SkillTogglePatch{{Path: activation.ContentRef, Enabled: false}}); err != nil {
		t.Fatal(err)
	}
	catalog, err := running.modelContextCatalog(t.Context(), "full_access")
	if err != nil || containsContextTestSkill(catalog, activation.Name) || len(running.active) != 0 {
		t.Fatalf("disabled catalog=%+v active=%+v err=%v", catalog, running.active, err)
	}
	if _, _, err := running.Activate(t.Context(), activation.Name, "full_access", false); err == nil {
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
