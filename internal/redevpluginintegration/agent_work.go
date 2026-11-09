package redevpluginintegration

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/floegence/redeven/internal/automation"
	"github.com/floegence/redevplugin/v3/pkg/capability"
	"github.com/floegence/redevplugin/v3/pkg/sessionctx"
)

// agentWorkAdapter accepts only platform-verified identity and existing session
// ownership. Submission creates a visible request; it never grants model access.
type agentWorkAdapter struct {
	store     *automation.Store
	sessions  *sessionPermissionCache
	directory string
}

func (a *agentWorkAdapter) ProjectTarget(_ context.Context, r capability.TargetResolutionRequest) (capability.TargetDescriptor, error) {
	work, ok := r.TargetInput["work_id"].(string)
	if !ok || work == "" || r.Identity.PluginInstanceID == "" {
		return capability.TargetDescriptor{}, automation.ErrInvalid
	}
	return capability.TargetDescriptor{Kind: "agent.work", Fields: map[string]any{"work_id": work}}, nil
}
func (a *agentWorkAdapter) Invoke(ctx context.Context, req capability.Invocation) (capability.Result, error) {
	scope, ok := sessionctx.FromContext(ctx)
	if !ok {
		return capability.Result{}, workError("WORK_AUTHORIZATION_REQUIRED")
	}
	resolved, ok := a.sessions.Get(scope)
	if !ok || resolved.ownerUser == "" || !resolved.permissions.read {
		return capability.Result{}, workError("WORK_AUTHORIZATION_REQUIRED")
	}
	b := req.Execution.ExecutionBinding
	if b.OwnerUserHash != scope.OwnerUserHash || b.OwnerEnvHash != scope.OwnerEnvHash || b.OwnerSessionHash != scope.OwnerSessionHash || b.SessionChannelIDHash != scope.SessionChannelIDHash {
		return capability.Result{}, workError("WORK_AUTHORIZATION_REQUIRED")
	}
	owner := automation.Owner{User: resolved.ownerUser, Environment: resolved.ownerEnvironment}
	text := func(k string) string { v, _ := req.Arguments[k].(string); return v }
	work, request := text("work_id"), text("request_id")
	if b.Target.Fields["work_id"] != work {
		return capability.Result{}, workError("WORK_UNAVAILABLE")
	}
	var w automation.Workflow
	var err error
	if b.Method == "agent.work.submit" {
		if !resolved.permissions.execute {
			return capability.Result{}, workError("WORK_AUTHORIZATION_REQUIRED")
		}
		w, err = a.store.CreatePluginRequest(ctx, owner, b, work, request, text("instruction"), text("context_json"), a.directory)
	} else {
		w, err = a.store.PluginRequest(ctx, owner, b, work, request)
		if err == nil && b.Method != "agent.work.cancel" {
			err = a.store.ValidatePluginAuthority(ctx, owner, w.ID)
		}
	}
	if err != nil {
		return capability.Result{}, mapWorkError(err)
	}
	run, runErr := a.store.PluginRun(ctx, owner, w)
	switch b.Method {
	case "agent.work.submit", "agent.work.get":
	case "agent.work.cancel":
		if errors.Is(runErr, automation.ErrNotFound) {
			_, err = a.store.Archive(ctx, owner, w.ID, w.Revision)
		} else if runErr == nil {
			run, err = a.store.RequestCancel(ctx, owner, run.ID)
		}
	case "agent.work.input":
		if runErr != nil {
			return capability.Result{}, workError("WORK_UNAVAILABLE")
		}
		run, err = a.store.Contribute(ctx, owner, run.ID, automation.Contribution{ID: text("input_id"), Kind: "requirement", Text: text("instruction"), Basis: run.ContextRevision})
	default:
		return capability.Result{}, workError("WORK_UNAVAILABLE")
	}
	if err != nil {
		return capability.Result{}, mapWorkError(err)
	}
	if runErr != nil && !errors.Is(runErr, automation.ErrNotFound) {
		return capability.Result{}, mapWorkError(runErr)
	}
	state := "waiting"
	if w.Archived || b.Method == "agent.work.cancel" && errors.Is(runErr, automation.ErrNotFound) {
		state = "cancelled"
	}
	result := map[string]any{"request_id": request, "state": state, "execution_ref": w.ID}
	if runErr == nil {
		state = map[string]string{"ready": "accepted", "running": "running", "review": "waiting", "blocked": "waiting", "canceling": "cancelling", "canceled": "cancelled", "completed": "completed", "partial": "failed", "failed": "failed"}[run.Status]
		if state == "" {
			state = "unknown"
		}
		result["state"] = state
		result["execution_ref"] = run.ID
		if state == "completed" {
			for i := len(run.Attempts) - 1; i >= 0; i-- {
				attempt := run.Attempts[i]
				if !attempt.Invalidated && attempt.State == "completed" && json.Valid(attempt.Result) && len(attempt.Result) <= 64000 {
					result["result_json"] = string(attempt.Result)
					result["result_valid"] = true
					break
				}
			}
		}
	}
	return capability.Result{Data: result}, nil
}
func workError(code string) error {
	messages := map[string]string{"WORK_UNAVAILABLE": "Work is unavailable", "WORK_CONFLICT": "Work revision or request conflicts", "WORK_AUTHORIZATION_REQUIRED": "Work requires authorization", "WORK_OUTCOME_UNKNOWN": "The original work outcome is unknown"}
	e, err := capability.NewBusinessError(code, messages[code], nil)
	if err != nil {
		return err
	}
	return e
}
func mapWorkError(err error) error {
	if errors.Is(err, automation.ErrConflict) {
		return workError("WORK_CONFLICT")
	}
	if errors.Is(err, automation.ErrUnauthorized) {
		return workError("WORK_AUTHORIZATION_REQUIRED")
	}
	if errors.Is(err, automation.ErrUnknown) {
		return workError("WORK_OUTCOME_UNKNOWN")
	}
	return workError("WORK_UNAVAILABLE")
}
