package ai

import (
	"context"
	"errors"
	"fmt"

	"github.com/floegence/redeven/internal/automation"
	"github.com/floegence/redeven/internal/flowerwork"
	"github.com/floegence/redeven/internal/plugincreation"
	"github.com/floegence/redeven/internal/session"
)

func (r *run) resolveFlowerWork(ctx context.Context) (*flowerwork.Resolved, error) {
	if r == nil {
		return nil, nil
	}
	registry := flowerwork.New()
	_ = registry.Register("plugin", flowerwork.AdapterFunc(func(ctx context.Context, meta *session.Meta, thread string) (*flowerwork.Resolved, error) {
		if r.host.pluginCreation == nil {
			return nil, nil
		}
		owner, err := plugincreation.OwnerFromSession(meta)
		if err != nil {
			return nil, nil
		}
		d, err := r.host.pluginCreation.Store.ForThread(ctx, owner, thread)
		if errors.Is(err, plugincreation.ErrNotFound) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		if d.Lifecycle != "active" {
			return nil, nil
		}
		return &flowerwork.Resolved{Binding: flowerwork.Binding{Kind: "plugin", ID: d.ID, ThreadID: thread, Revision: fmt.Sprint(d.Revision), Title: d.Title, Scope: d.WorkspaceID}, Profile: flowerwork.Profile{ID: "plugin.author", ToolPrefixes: []string{"plugin_author_"}, Skills: []string{pluginAuthoringSkillName}, ResultContract: "author-artifact", Guidance: "This is a dedicated plugin creation conversation. Read the redeven-plugin-authoring skill and plugin_author_get_status before editing. Discuss requirements or implement as requested. Use the managed source directory and plugin_author_build; the workspace shows retained artifacts and handles preview and installation review. Preview, installation and grants remain separate."}}, nil
	}))
	_ = registry.Register("tessiven", flowerwork.AdapterFunc(func(ctx context.Context, meta *session.Meta, thread string) (*flowerwork.Resolved, error) {
		if r.host.tessivenCanvasID == "" {
			return nil, nil
		}
		body, err := systemSkillFS.ReadFile("system_skills/redeven-tessiven/SKILL.md")
		if err != nil {
			return nil, err
		}
		return &flowerwork.Resolved{Binding: flowerwork.Binding{Kind: "tessiven", ID: r.host.tessivenCanvasID, ThreadID: thread, Scope: r.host.tessivenCanvasID}, Profile: flowerwork.Profile{ID: "tessiven.design", ToolPrefixes: []string{"tessiven_"}, Skills: []string{tessivenSkillName}, ResultContract: "canvas-version", Guidance: string(body)}}, nil
	}))
	_ = registry.Register("automation", flowerwork.AdapterFunc(func(ctx context.Context, meta *session.Meta, thread string) (*flowerwork.Resolved, error) {
		if r.host.automation == nil {
			return nil, nil
		}
		owner, err := automation.OwnerFromSession(meta)
		if err != nil {
			return nil, nil
		}
		w, b, err := r.host.automation.WorkflowForThread(ctx, owner, thread)
		if errors.Is(err, automation.ErrNotFound) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		result := &flowerwork.Resolved{Binding: flowerwork.Binding{Kind: "automation", ID: w.ID, ThreadID: thread, Revision: fmt.Sprint(w.Revision), Title: w.Definition.Title, Scope: b.RunID}, Profile: flowerwork.Profile{ID: "automation.design", ToolNames: []string{"automation_read_definition", "automation_save_definition"}, ResultContract: "workflow-definition", Guidance: "Design this workflow using automation_read_definition and automation_save_definition. Preserve the user's current revision. Creating a draft never enables a schedule or grants permission. Nodes share a versioned workflow context."}}
		if b.RunID != "" {
			run, err := r.host.automation.Run(ctx, owner, b.RunID)
			if err != nil {
				return nil, err
			}
			if r.host.automationAuthorize == nil {
				return nil, automation.ErrUnauthorized
			}
			if _, err = r.host.automationAuthorize(ctx, owner, run); err != nil {
				return nil, err
			}
			brief, err := r.host.automation.Brief(ctx, owner, b.RunID)
			if err != nil {
				return nil, err
			}
			if w.Plugin != nil {
				result.Binding.Kind = "automation"
				result.Binding.Title = w.Definition.Title
				result.Profile.ID = "plugin.analyze"
			} else {
				result.Profile.ID = "automation.execute"
			}
			result.Profile.ToolNames = []string{"automation_read_context", "automation_contribute", "automation_submit_result"}
			result.Profile.ResultContract = "node-result"
			result.Profile.Guidance = "Execute only the assigned node. Read shared context as needed, contribute supported findings and submit the structured result with automation_submit_result. Do not modify the workflow or start other runs."
			result.Context = []flowerwork.Context{{Key: "workflow_context", Title: "Shared workflow context", Text: brief}}
		}
		return result, nil
	}))
	meta := r.sessionMeta
	if meta == nil {
		meta = &session.Meta{}
	}
	thread := r.host.authorityThreadID
	if thread == "" {
		thread = r.threadID
	}
	if thread == "" {
		return nil, nil
	}
	return registry.Resolve(ctx, meta, thread)
}
