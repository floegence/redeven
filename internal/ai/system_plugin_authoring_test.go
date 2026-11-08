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
		"a small runnable version of the user's actual application",
		"one useful end-to-end interaction",
		"leave later preview updates to Apply",
		"never reuse a version for different bytes",
		"plugin_author_rename",
		"ready_for_install",
		"installation_check",
		"Never ask the user to retry the same rejected artifact",
		"choose a concise descriptive name in their language",
		"Continue the requested implementation and acceptance work",
		"Every newly generated plugin MUST include an automatically authored SVG icon",
		"before the first runnable milestone build",
		"ui/assets/plugin-icon.svg",
		"presentation.icon.path",
		"The SVG source, derived PNG and manifest reference are required deliverables",
		"Missing or invalid icon assets block completion",
	} {
		if !strings.Contains(activation.Content, instruction) {
			t.Fatalf("published plugin authoring instruction is missing: %s", instruction)
		}
	}
	for _, retired := range []string{"redevplugin repository identity", "redevplugin init dev.", "binding directory after identity changes", "When the user selects Create directly"} {
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

func TestPluginBuildFeedbackRetainsReadinessWhenLogsAreTruncated(t *testing.T) {
	for _, tool := range []string{"plugin_author_build", "plugin_author_capture"} {
		payload := map[string]any{"artifact": map[string]any{"artifact_id": "exact-artifact", "version": "0.1.0"}, "ready_for_install": false,
			"installation_check": map[string]any{"code": "plugin_author_package_conflict", "message": "same version has different contents"},
			"build":              map[string]any{"status": "passed", "commands": strings.Repeat("bounded build log\n", 1000)}}
		value, truncated, err := normalizeTruncatedToolPayload(tool, payload)
		if err != nil || !truncated {
			t.Fatalf("normalization: %v %v", truncated, err)
		}
		record := value.(map[string]any)
		if record["ready_for_install"] != false || record["artifact"].(map[string]any)["artifact_id"] != "exact-artifact" || record["installation_check"].(map[string]any)["code"] != "plugin_author_package_conflict" {
			t.Fatalf("lost actionable build feedback: %+v", record)
		}
	}
}
