package ai

import (
	"context"
	"errors"

	"github.com/floegence/redeven/internal/plugincreation"
	"github.com/floegence/redeven/internal/session"
)

func builtInPluginAuthorToolDefinitions() []ToolDef {
	defs := []ToolDef{}
	add := func(name, description string, properties map[string]any, required []string, mutating bool) {
		visibility := ToolVisibilitySharedReadonly
		capabilities := []ToolCapabilityClass{ToolCapabilityReadonlyLocal}
		if mutating {
			visibility = ToolVisibilityStandard
			capabilities = []ToolCapabilityClass{ToolCapabilityMutation}
		}
		if name == "plugin_author.build" {
			capabilities = append(capabilities, ToolCapabilityShell, ToolCapabilityOpenWorld)
		}
		defs = append(defs, ToolDef{Name: name, Description: description, InputSchema: toolSchemaRaw(map[string]any{"type": "object", "properties": properties, "required": required, "additionalProperties": false}), Mutating: mutating, RequiresApproval: mutating, Visibility: visibility, Capabilities: capabilities, Source: "builtin", Namespace: "builtin.plugin_author", Priority: 100})
	}
	text := map[string]any{"type": "string"}
	add("plugin_author.status", "Read the current dedicated plugin draft's managed source directory and retained build artifacts. Available only in a plugin creation conversation.", map[string]any{}, []string{}, false)
	add("plugin_author.initialize", "Initialize this draft's empty managed source using the released platform template. Keep existing identity and source; inspect status first.", map[string]any{"plugin_id": text, "display_name": text, "template": map[string]any{"type": "string", "enum": []string{"web", "data", "files", "monitor", "worker"}}}, []string{"plugin_id", "display_name", "template"}, true)
	add("plugin_author.build", "Run this project's declared author pipeline under the current execution approval. Returns actual stages and an immutable package artifact. Never installs or grants permissions. Failed builds retain the last usable artifact.", map[string]any{}, []string{}, true)
	add("plugin_author.capture", "Capture and verify an already-built package from the declared project output without running commands. Returns an immutable artifact; does not claim business tests ran.", map[string]any{}, []string{}, true)
	return defs
}
func (r *run) execPluginAuthorTool(ctx context.Context, meta *session.Meta, name string, args map[string]any) (any, error) {
	if r.host.pluginCreation == nil {
		return nil, errors.New("plugin authoring is unavailable")
	}
	operation := ""
	switch name {
	case "plugin_author.status":
		operation = "status"
	case "plugin_author.initialize":
		operation = "initialize"
	case "plugin_author.build":
		operation = "build"
	case "plugin_author.capture":
		operation = "capture"
	default:
		return nil, errors.New("unknown plugin author operation")
	}
	if operation != "initialize" && len(args) != 0 {
		return nil, errors.New("unexpected plugin author arguments")
	}
	return r.host.pluginCreation.AuthorOperation(ctx, meta, r.host.authorityThreadID, operation, args)
}

func (r *run) hasPluginDraft() bool {
	if r == nil || r.host.pluginCreation == nil || r.sessionMeta == nil || r.host.authorityThreadID == "" {
		return false
	}
	owner, err := plugincreation.OwnerFromSession(r.sessionMeta)
	if err != nil {
		return false
	}
	draft, err := r.host.pluginCreation.Store.ForThread(context.Background(), owner, r.host.authorityThreadID)
	return err == nil && draft.Lifecycle == "active"
}
