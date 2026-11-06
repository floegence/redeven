package ai

import (
	"strings"
	"testing"

	platformversion "github.com/floegence/redevplugin/v3/pkg/version"
)

func TestPluginAuthoringSkillUsesPublishedPlatformInModelAndBrowseContent(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	manager := newSkillManager(root, t.TempDir())
	manager.userHome = t.TempDir()
	catalog, err := manager.modelContextCatalog(t.Context(), "full_access")
	if err != nil {
		t.Fatal(err)
	}
	const name = "redeven-plugin-authoring"
	const path = "system:redeven-plugin-authoring/SKILL.md"
	found := false
	for _, skill := range catalog {
		if skill.Name == name {
			found = skill.Path == path && skill.Scope == string(SkillSourceTypeSystem) && skill.AllowImplicitInvocation
		}
	}
	if !found {
		t.Fatal("application authoring skill is missing from model-visible system catalog")
	}
	activation, alreadyActive, err := manager.Activate(t.Context(), name, "full_access", true)
	if err != nil || alreadyActive {
		t.Fatalf("activation failed: active=%v err=%v", alreadyActive, err)
	}
	coordinate := "github.com/floegence/redevplugin/v3/cmd/redevplugin@v" + platformversion.CurrentPlatformVersion()
	if !strings.Contains(activation.Content, coordinate) || strings.Contains(activation.Content, "{{REDEVPLUGIN_PLATFORM_VERSION}}") {
		t.Fatal("model instructions must contain the actual released platform coordinate")
	}
	for _, instruction := range []string{
		"redevplugin build <project-root> --release",
		"redevplugin.source.v1",
		"plugin.slug",
		"publisher_id = github.repo.<repository-id>",
		"plugin_id = github.repo.<repository-id>.<slug>",
		"before bindings, Worker/UI compilation and hashing",
		"never rewrites source or the repository index",
		"GitHub-shaped ID does not establish repository provenance",
	} {
		if !strings.Contains(activation.Content, instruction) {
			t.Fatalf("published plugin authoring instruction is missing: %s", instruction)
		}
	}
	for _, retired := range []string{"redevplugin repository identity", "redevplugin init dev.", "binding directory after identity changes"} {
		if strings.Contains(activation.Content, retired) {
			t.Fatalf("retired author workflow remains: %s", retired)
		}
	}
	file, err := manager.BrowseFile(path, "SKILL.md", "utf8", 64*1024)
	if err != nil || file.Truncated {
		t.Fatalf("browse and model instructions differ: truncated=%v err=%v", file.Truncated, err)
	}
	_, body, err := parseSkillContent(path, string(SkillSourceTypeSystem), file.Content)
	if err != nil || strings.TrimSpace(body) != strings.TrimSpace(activation.Content) {
		t.Fatal("browse and model skill bodies differ")
	}
	if _, err := manager.PatchToggles([]SkillTogglePatch{{Path: path, Enabled: false}}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := manager.Activate(t.Context(), name, "full_access", true); err == nil {
		t.Fatal("disabled authoring skill remained active")
	}
}
