package ai

import (
	"strings"

	fltools "github.com/floegence/floret/v5/tools"
	"github.com/floegence/floret/v5/tools/webfetch"
	aitools "github.com/floegence/redeven/internal/ai/tools"
)

type floretNativeToolFactory func(ToolDef, PermissionSnapshot) fltools.Tool

var floretNativeToolFactories = map[string]floretNativeToolFactory{
	webfetch.ToolName: func(def ToolDef, snapshot PermissionSnapshot) fltools.Tool {
		return webfetch.New(webfetch.Options{
			Permission: fltools.PermissionSpec{Mode: fltools.PermissionAsk, ResourceKinds: []string{"web_url"}},
			PermissionFor: func(fltools.PermissionRequest) (fltools.PermissionSpec, error) {
				decision := permissionDecisionForTool(snapshot.PermissionType, def)
				return fltools.PermissionSpec{Mode: floretPermissionMode(decision), ResourceKinds: []string{"web_url"}}, nil
			},
			AllowResolvedBenchmarkIPs: true,
		})
	},
}

func floretNativeToolDefinitions() []ToolDef {
	definition := webfetch.New(webfetch.Options{}).Definition
	return []ToolDef{{
		Name:             definition.Name,
		Description:      definition.Description,
		InputSchema:      toolSchemaRaw(definition.InputSchema),
		Mutating:         definition.Destructive,
		RequiresApproval: false,
		Visibility:       ToolVisibilitySharedReadonly,
		Capabilities:     []ToolCapabilityClass{ToolCapabilityReadonlyNetwork, ToolCapabilityOpenWorld},
		Presentation:     aitools.MustPresentationSpec(definition.Name),
		Source:           "floret",
		Namespace:        "floret.web",
		Priority:         100,
	}}
}

func buildFloretNativeTool(def ToolDef, snapshot PermissionSnapshot) (fltools.Tool, bool) {
	factory, ok := floretNativeToolFactories[strings.TrimSpace(def.Name)]
	if !ok {
		return fltools.Tool{}, false
	}
	return factory(def, snapshot), true
}

func isFloretNativeTool(toolName string) bool {
	_, ok := floretNativeToolFactories[strings.TrimSpace(toolName)]
	return ok
}
