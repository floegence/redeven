package ai

import (
	flruntime "github.com/floegence/floret/v7/runtime"
	fltools "github.com/floegence/floret/v7/tools"
	"slices"
	"testing"
)

func TestComputerDefaultSurfaceAndHistoricalResume(t *testing.T) {
	all := builtInComputerToolDefinitions()
	names := func(defs []ToolDef) []string {
		var out []string
		for _, d := range defs {
			out = append(out, d.Name)
		}
		return out
	}
	want := []string{"computer_list_targets", "computer_select_target", "computer_exec"}
	if got := names(compactComputerToolSurface(all, nil, nil)); !slices.Equal(got, want) {
		t.Fatalf("default surface: %v", got)
	}
	explicit := map[string]struct{}{"computer_exec": {}, "computer_click": {}}
	if got := names(compactComputerToolSurface(all, explicit, nil)); !slices.Contains(got, "computer_click") {
		t.Fatal("explicit consumer lost its tool")
	}
	previous := &flruntime.ProviderToolSurface{ToolDefinitions: []fltools.ToolDefinition{{Name: "computer_click"}}}
	if got := names(compactComputerToolSurface(all, nil, previous)); !slices.Contains(got, "computer_click") {
		t.Fatal("historical admitted call lost its tool")
	}
	withoutExec := slices.DeleteFunc(slices.Clone(all), func(d ToolDef) bool { return d.Name == "computer_exec" })
	if got := names(compactComputerToolSurface(withoutExec, nil, nil)); !slices.Contains(got, "computer_observe") {
		t.Fatal("non-script consumer lost observation")
	}
}

func TestComputerDefaultSurfaceInRun(t *testing.T) {
	r := newRun(runOptions{AgentHomeDir: t.TempDir()})
	surface, err := r.buildRunToolSurface(runToolSurfaceConfig{}, FlowerPermissionFullAccess)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, item := range surface.FloretToolItems {
		if isComputerUseToolName(item.Definition.Name) {
			names = append(names, item.Definition.Name)
		}
	}
	if len(names) != 3 || !slices.Contains(names, "computer_exec") {
		t.Fatalf("actual provider surface: %v", names)
	}
}

// These fixtures deliberately emit primitive calls. Keep this explicit consumer
// surface so restart/retry, image fidelity and partial-effect tests retain their
// original contracts while new tasks exercise the compact production default.
func legacyComputerFixtureTools() []string {
	names := []string{"user_ask"}
	for _, d := range builtInToolDefinitions() {
		names = append(names, d.Name)
	}
	return names
}
