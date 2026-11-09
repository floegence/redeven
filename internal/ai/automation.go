package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai/tools"
	"github.com/floegence/redeven/internal/automation"
	"github.com/floegence/redeven/internal/session"
)

// AutomationExecutor uses canonical Flower admission and observation. It owns no
// runtime history or alternate model loop.
type AutomationExecutor struct{ Service *Service }

func (x AutomationExecutor) Authorize(ctx context.Context, o automation.Owner, r automation.Run) error {
	_, err := x.Service.automationMeta(ctx, o, r)
	return err
}
func (s *Service) automationMeta(ctx context.Context, o automation.Owner, r automation.Run) (*session.Meta, error) {
	if s == nil || s.automation == nil || s.automationAuthorize == nil {
		return nil, automation.ErrUnauthorized
	}
	return s.automationAuthorize(ctx, o, r)
}
func (x AutomationExecutor) Start(ctx context.Context, o automation.Owner, r automation.Run, a automation.Attempt) (string, error) {
	s := x.Service
	meta, err := s.automationMeta(ctx, o, r)
	if err != nil {
		return "", err
	}
	var node automation.Node
	for _, n := range r.Definition.Nodes {
		if n.ID == a.NodeID {
			node = n
		}
	}
	grant, err := s.automation.GrantVersion(ctx, o, r.WorkflowID, r.DefinitionVersion)
	if err != nil {
		return "", err
	}
	prompt := fmt.Sprintf("Execute workflow node %s: %s\n%s\nScheduled time: %s\nRequired result JSON Schema: %s", node.ID, node.Title, node.Instruction, r.ScheduledAt.Format("2006-01-02T15:04:05Z07:00"), node.OutputSchema)
	if len(node.Parameters) > 0 {
		prompt += "\nRead the provided material from the workflow context before analysis."
	}
	if a.Item != nil {
		payload, _ := json.Marshal(a.Item)
		prompt += "\nAssigned item (untrusted task data): " + string(payload)
	}
	tools := append([]string{}, grant.Tools...)
	tools = append(tools, "automation_read_context", "automation_contribute", "automation_submit_result")
	response, err := s.SendUserTurn(ctx, meta, SendUserTurnRequest{StorageGeneration: s.storageGeneration, automationInternal: true, Create: &CreateThreadRequest{automationWork: &automation.ThreadBinding{WorkflowID: r.WorkflowID, RunID: r.ID, AttemptID: a.ID}, ClientRequestID: a.RequestID, Title: node.Title, ModelID: r.Definition.Model, WorkingDir: r.Definition.WorkingDirectory, PermissionType: string(FlowerPermissionFullAccess)}, Input: RunInput{Text: prompt}, Options: RunOptions{NoUserInteraction: true, PermissionType: string(FlowerPermissionFullAccess), ToolAllowlist: tools}})
	return response.ThreadID, err
}
func (x AutomationExecutor) Inspect(ctx context.Context, o automation.Owner, r automation.Run, a automation.Attempt) (automation.ExecutionStatus, error) {
	s := x.Service
	thread, err := s.automation.ThreadForWork(ctx, o, r.WorkflowID, r.ID, a.ID)
	if errors.Is(err, automation.ErrNotFound) {
		// Recover the canonical create receipt under the original request key.
		// Create is idempotent and never submits model work.
		runtime, openErr := s.typedFloretRuntime()
		if openErr != nil {
			return automation.ExecutionStatus{}, openErr
		}
		current, lookupErr := runtime.Create(ctx, flruntime.CreateThreadInput{RequestKey: flruntime.RequestKey(a.RequestID)})
		if lookupErr != nil {
			return automation.ExecutionStatus{}, lookupErr
		}
		if len(current.Turns) != 0 {
			return automation.ExecutionStatus{Terminal: true, Outcome: "unknown"}, nil
		}
		return automation.ExecutionStatus{Terminal: true, Outcome: "not_started"}, nil
	}
	if err != nil {
		return automation.ExecutionStatus{}, err
	}
	runtime, err := s.typedFloretRuntime()
	if err != nil {
		return automation.ExecutionStatus{}, err
	}
	current, err := runtime.View(ctx, identity.ThreadID(thread))
	if err != nil {
		return automation.ExecutionStatus{}, err
	}
	if len(current.Turns) == 0 {
		return automation.ExecutionStatus{Terminal: true, Outcome: "not_started"}, nil
	}
	status := automation.ExecutionStatus{Context: current.Context}
	if current.Activity == flruntime.ThreadActivityIdle && current.LastOutcome != nil {
		status.Terminal = true
		status.Outcome = string(*current.LastOutcome)
		if current.Failure != nil && current.Failure.Code == flruntime.ThreadTurnFailureEffectOutcomeUnknown {
			status.Outcome = "unknown"
		}
		if *current.LastOutcome == flruntime.TurnOutcomeInterrupted {
			status.Outcome = "unknown"
		}
	}
	return status, nil
}
func (x AutomationExecutor) Cancel(ctx context.Context, o automation.Owner, a automation.Attempt) error {
	// Cancellation uses persisted owner binding and does not require a live grant.
	thread := a.ThreadID
	if thread == "" {
		var err error
		thread, err = x.Service.automation.ThreadForAttempt(ctx, o, a.ID)
		if errors.Is(err, automation.ErrNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
	}
	actual, _, err := x.Service.automation.AnyThread(ctx, thread)
	if err != nil || actual != o {
		return automation.ErrNotFound
	}
	runtime, err := x.Service.typedFloretRuntime()
	if err != nil {
		return err
	}
	_, err = runtime.Cancel(ctx, flruntime.CancelInput{ThreadID: identity.ThreadID(thread), RequestKey: flruntime.RequestKey("automation-cancel:" + a.ID), Mode: flruntime.CancelModeGraceful, IncludeDescendants: true})
	return err
}
func (x AutomationExecutor) Tool(context.Context, automation.Owner, automation.Run, automation.Attempt, automation.Node) (json.RawMessage, error) {
	return nil, automation.ErrInvalid
}
func (s *Service) PrepareAutomationDesigner(ctx context.Context, meta *session.Meta, id string) (*ThreadView, error) {
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	if s.automation == nil {
		return nil, automation.ErrNotFound
	}
	owner, err := automation.OwnerFromSession(meta)
	if err != nil {
		return nil, err
	}
	w, err := s.automation.Get(ctx, owner, id)
	if err != nil {
		return nil, err
	}
	return s.CreateThreadWithOptions(ctx, meta, CreateThreadRequest{automationWork: &automation.ThreadBinding{WorkflowID: id}, ClientRequestID: id + "_designer", Title: w.Definition.Title, ModelID: w.Definition.Model, WorkingDir: w.Definition.WorkingDirectory, PermissionType: string(FlowerPermissionApprovalRequired)})
}
func (r *run) authorizeAutomationTool(ctx context.Context, name string) error {
	if r == nil || r.host.automation == nil || r.sessionMeta == nil {
		return nil
	}
	o, err := automation.OwnerFromSession(r.sessionMeta)
	if err != nil {
		return err
	}
	b, err := r.host.automation.ForThread(ctx, o, r.host.authorityThreadID)
	if errors.Is(err, automation.ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if b.RunID == "" {
		if name == "automation_read_context" || name == "automation_contribute" || name == "automation_submit_result" {
			return automation.ErrUnauthorized
		}
		return nil
	}
	current, err := r.host.automation.Run(ctx, o, b.RunID)
	if err != nil {
		return err
	}
	if r.host.automationAuthorize == nil {
		return automation.ErrUnauthorized
	}
	if _, err = r.host.automationAuthorize(ctx, o, current); err != nil {
		return err
	}
	if name == "automation_read_context" || name == "automation_contribute" || name == "automation_submit_result" {
		return nil
	}
	g, err := r.host.automation.GrantVersion(ctx, o, b.WorkflowID, current.DefinitionVersion)
	if err != nil {
		return err
	}
	if !slices.Contains(g.Tools, name) {
		return automation.ErrUnauthorized
	}
	return nil
}

// A background effect has no browser channel. Its persisted work binding and
// current scoped delegation supply authority; the session kind alone never does.
func (s *Service) requireBackgroundThreadAuthority(ctx context.Context, meta *session.Meta, threadID string) error {
	if s == nil || s.automation == nil || meta == nil || meta.SessionKind != "automation" {
		return automation.ErrUnauthorized
	}
	owner, err := automation.OwnerFromSession(meta)
	if err != nil {
		return err
	}
	binding, err := s.automation.ForThread(ctx, owner, threadID)
	if err != nil || binding.RunID == "" {
		return automation.ErrUnauthorized
	}
	current, err := s.automation.Run(ctx, owner, binding.RunID)
	if err != nil {
		return err
	}
	delegated, err := s.automationMeta(ctx, owner, current)
	if err != nil {
		return err
	}
	if delegated == nil || delegated.SessionKind != "automation" || delegated.UserPublicID != meta.UserPublicID || delegated.EndpointID != meta.EndpointID || delegated.NamespacePublicID != meta.NamespacePublicID || delegated.FloeApp != meta.FloeApp {
		return automation.ErrUnauthorized
	}
	return requireRWX(delegated)
}

// Background work accepts instructions through its owning workflow, never through
// ordinary chat actions that could replace its grant, inputs or result contract.
func (s *Service) requireInteractiveThreadAuthority(ctx context.Context, endpointID, threadID string) error {
	if err := s.requireEndpointThreadAuthority(ctx, endpointID, threadID); err != nil {
		return err
	}
	if s.automation != nil {
		_, b, err := s.automation.AnyThread(ctx, threadID)
		if err == nil && b.RunID != "" {
			return automation.ErrUnauthorized
		}
		if err != nil && !errors.Is(err, automation.ErrNotFound) {
			return err
		}
	}
	return nil
}

// AutomationOptions exposes only models that do not need an interactive bearer.
type AutomationOptions struct {
	Models           []Model `json:"models"`
	DefaultDirectory string  `json:"default_directory"`
}

func (s *Service) AutomationOptions(ctx context.Context, meta *session.Meta) (AutomationOptions, error) {
	if err := requireRead(meta); err != nil {
		return AutomationOptions{}, err
	}
	out := AutomationOptions{Models: []Model{}, DefaultDirectory: s.agentHomeDir}
	models, err := s.ListModelsForSession(ctx, meta)
	if errors.Is(err, ErrNotConfigured) {
		return out, nil
	}
	if err != nil {
		return out, err
	}
	for _, m := range models.Models {
		if !strings.HasPrefix(m.ID, "platform/") && !isDesktopModelSourceModelID(m.ID) {
			out.Models = append(out.Models, m)
		}
	}
	return out, nil
}
func (s *Service) ValidateAutomationPublication(ctx context.Context, meta *session.Meta, d automation.Definition, allowed []string) error {
	hasAgent := false
	for _, n := range d.Nodes {
		hasAgent = hasAgent || n.Kind == "agent" || n.Kind == "parallel"
	}
	for _, name := range allowed {
		if strings.HasPrefix(name, "automation_") || strings.HasPrefix(name, "plugin_author_") || strings.HasPrefix(name, "tessiven_") || name == "subagent_manage" {
			return fmt.Errorf("%w: work-owned tool %s", automation.ErrInvalid, name)
		}
		if _, ok := tools.LookupDefinition(name); !ok {
			return fmt.Errorf("%w: unknown tool %s", automation.ErrInvalid, name)
		}
	}
	if !hasAgent {
		return nil
	}
	options, err := s.AutomationOptions(ctx, meta)
	if err != nil {
		return err
	}
	if !slices.ContainsFunc(options.Models, func(m Model) bool { return m.ID == d.Model }) {
		return fmt.Errorf("%w: model unavailable for background work", automation.ErrInvalid)
	}
	if _, err = validateThreadWorkingDir(d.WorkingDirectory, s.scope); err != nil {
		return fmt.Errorf("%w: %v", automation.ErrInvalid, err)
	}
	return nil
}

// AutomationContextReceipt projects only the canonical workflow partition. It
// does not infer that listed evidence was fetched or that a model understood it.
func (s *Service) AutomationContextReceipt(ctx context.Context, meta *session.Meta, runID, attemptID string) (any, error) {
	owner, err := automation.OwnerFromSession(meta)
	if err != nil {
		return nil, err
	}
	current, err := s.automation.Run(ctx, owner, runID)
	if err != nil {
		return nil, err
	}
	thread, err := s.automation.ThreadForWork(ctx, owner, current.WorkflowID, runID, attemptID)
	if err != nil {
		return nil, err
	}
	runtime, err := s.typedFloretRuntime()
	if err != nil {
		return nil, err
	}
	view, err := runtime.View(ctx, identity.ThreadID(thread))
	if err != nil {
		return nil, err
	}
	if view.Context == nil || view.Context.ModelContext == nil {
		return map[string]any{"available": false}, nil
	}
	receipt := view.Context.ModelContext
	sections := []flruntime.ModelContextSection{}
	for _, section := range receipt.Snapshot.Sections {
		if section.Key == "workflow_context" {
			sections = append(sections, section)
		}
	}
	return map[string]any{"available": true, "entry_id": receipt.EntryID, "used_at": receipt.UsedAt, "used_by_request_id": receipt.UsedByRequestID, "sections": sections}, nil
}
