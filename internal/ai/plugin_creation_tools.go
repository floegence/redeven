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
		if name == "plugin_author_build" {
			capabilities = append(capabilities, ToolCapabilityShell, ToolCapabilityOpenWorld)
		}
		defs = append(defs, ToolDef{Name: name, Description: description, InputSchema: toolSchemaRaw(map[string]any{"type": "object", "properties": properties, "required": required, "additionalProperties": false}), Mutating: mutating, RequiresApproval: mutating, Visibility: visibility, Capabilities: capabilities, Source: "builtin", Namespace: "builtin.plugin_author", Priority: 100})
	}
	text := map[string]any{"type": "string", "minLength": 1, "maxLength": 120}
	add("plugin_author_get_status", "Read the current dedicated plugin draft's managed source directory and retained build artifacts. Available only in a plugin creation conversation.", map[string]any{}, []string{}, false)
	add("plugin_author_rename", "Set this creation project's title from the user's naming intent. Read plugin_author_get_status for project.revision first. Keep source plugin.display_name aligned through ordinary source edits and rebuild; this tool does not change installed package bytes or identity.", map[string]any{"title": map[string]any{"type": "string", "minLength": 1, "maxLength": 120}, "revision": map[string]any{"type": "integer", "minimum": 1}}, []string{"title", "revision"}, true)
	add("plugin_author_initialize", "Initialize this draft's empty managed source using a short lowercase slug and the released platform template. Publication identity is generated; inspect status first.", map[string]any{"slug": map[string]any{"type": "string", "minLength": 1, "maxLength": 80, "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$"}, "display_name": text, "template": map[string]any{"type": "string", "enum": []string{"web", "data", "files", "monitor", "worker"}}}, []string{"slug", "display_name", "template"}, true)
	add("plugin_author_build", "Run this project's declared author pipeline under the current execution approval. Returns actual stages, an immutable artifact and ready_for_install from platform inspection. Resolve a failed installation_check before handoff. Never installs or grants permissions. Failed builds retain the last usable artifact.", map[string]any{}, []string{}, true)
	add("plugin_author_capture", "Capture and verify an already-built package from the declared project output without running commands. Returns an immutable artifact; does not claim business tests ran.", map[string]any{}, []string{}, true)
	return defs
}
func (r *run) execPluginAuthorTool(ctx context.Context, meta *session.Meta, name string, args map[string]any) (any, error) {
	if r.host.pluginCreation == nil {
		return nil, errors.New("plugin authoring is unavailable")
	}
	operation := ""
	switch name {
	case "plugin_author_get_status":
		operation = "status"
	case "plugin_author_initialize":
		operation = "initialize"
	case "plugin_author_rename":
		operation = "rename"
	case "plugin_author_build":
		operation = "build"
	case "plugin_author_capture":
		operation = "capture"
	default:
		return nil, errors.New("unknown plugin author operation")
	}
	if operation != "initialize" && operation != "rename" && len(args) != 0 {
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

const pluginAuthoringSkillName = "redeven-plugin-authoring"

func (r *run) scopedSkills(catalog []SkillMeta) []SkillMeta {
	pluginAuthoring, tessivenThread := r.hasPluginDraft(), r.hasTessivenThread()
	out := make([]SkillMeta, 0, len(catalog))
	for _, skill := range catalog {
		if (skill.Name != pluginAuthoringSkillName || pluginAuthoring) && (skill.Name != tessivenSkillName || tessivenThread) {
			out = append(out, skill)
		}
	}
	return out
}
