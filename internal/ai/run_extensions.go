package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

func (r *run) ensureSkillManager() *skillManager {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.skillManager == nil {
		r.skillManager = newSkillManager(r.fsRoot, r.stateDir)
		r.skillManager.Discover()
	}
	return r.skillManager
}

func (r *run) listSkills() []SkillMeta {
	mgr := r.ensureSkillManager()
	if mgr == nil {
		return nil
	}
	return mgr.List(r.runMode)
}

func (r *run) activeSkills() []SkillActivation {
	mgr := r.ensureSkillManager()
	if mgr == nil {
		return nil
	}
	return mgr.Active()
}

func (r *run) activateSkill(name string) (SkillActivation, bool, error) {
	if r == nil {
		return SkillActivation{}, false, errors.New("nil run")
	}
	mgr := r.ensureSkillManager()
	if mgr == nil {
		return SkillActivation{}, false, errors.New("skill manager unavailable")
	}
	activation, alreadyActive, err := mgr.Activate(name, r.runMode, false)
	if err != nil {
		r.persistRunEvent("skill.activate.error", RealtimeStreamKindLifecycle, map[string]any{"name": strings.TrimSpace(name), "error": err.Error()})
		return SkillActivation{}, false, err
	}
	r.persistRunEvent("skill.activated", RealtimeStreamKindLifecycle, map[string]any{"name": activation.Name, "activation_id": activation.ActivationID, "already_active": alreadyActive})
	return activation, alreadyActive, nil
}

func (r *run) ensureSubagentManager() *subagentManager {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.subagentManager == nil {
		r.subagentManager = newSubagentManager(r)
	}
	return r.subagentManager
}

func (r *run) delegateTask(ctx context.Context, args map[string]any) (map[string]any, error) {
	if r == nil {
		return nil, errors.New("nil run")
	}
	if !r.allowSubagentDelegate {
		return nil, fmt.Errorf("delegate_task is disabled in this run")
	}
	objective := strings.TrimSpace(anyToString(args["objective"]))
	if objective == "" {
		return nil, fmt.Errorf("missing objective")
	}
	taskID := strings.TrimSpace(anyToString(args["task_id"]))
	if taskID == "" {
		agentType := strings.ToLower(strings.TrimSpace(anyToString(args["agent_type"])))
		if !isValidSubagentAgentType(agentType) {
			return nil, fmt.Errorf("invalid agent_type %q", strings.TrimSpace(anyToString(args["agent_type"])))
		}
		triggerReason := strings.TrimSpace(anyToString(args["trigger_reason"]))
		if triggerReason == "" {
			return nil, fmt.Errorf("missing trigger_reason")
		}
		expectedOutput, ok := args["expected_output"].(map[string]any)
		if !ok || len(expectedOutput) == 0 {
			return nil, fmt.Errorf("missing expected_output")
		}
	}
	mgr := r.ensureSubagentManager()
	if mgr == nil {
		return nil, errors.New("subagent manager unavailable")
	}
	return mgr.delegate(ctx, args)
}

func (r *run) manageSubagents(ctx context.Context, args map[string]any) (map[string]any, error) {
	if r == nil {
		return nil, errors.New("nil run")
	}
	if !r.allowSubagentDelegate {
		return nil, fmt.Errorf("subagents is disabled in this run")
	}
	action := strings.ToLower(strings.TrimSpace(anyToString(args["action"])))
	if action == "" {
		return nil, fmt.Errorf("missing action")
	}
	switch action {
	case subagentActionList:
		// Optional fields only.
	case subagentActionInspect, subagentActionTerminate:
		if strings.TrimSpace(anyToString(args["target"])) == "" {
			return nil, fmt.Errorf("missing target")
		}
	case subagentActionSteer:
		if strings.TrimSpace(anyToString(args["target"])) == "" {
			return nil, fmt.Errorf("missing target")
		}
		message := strings.TrimSpace(anyToString(args["message"]))
		if message == "" {
			return nil, fmt.Errorf("missing message")
		}
		if len(message) > 4000 {
			return nil, fmt.Errorf("message too long")
		}
	case subagentActionTerminateAll:
		scope := strings.ToLower(strings.TrimSpace(anyToString(args["scope"])))
		if scope == "" {
			scope = "current_run"
		}
		if scope != "current_run" {
			return nil, fmt.Errorf("invalid scope %q", strings.TrimSpace(anyToString(args["scope"])))
		}
	default:
		return nil, fmt.Errorf("unsupported action %q", action)
	}
	mgr := r.ensureSubagentManager()
	if mgr == nil {
		return nil, errors.New("subagent manager unavailable")
	}
	return mgr.manage(ctx, args)
}

func (r *run) waitSubagents(ctx context.Context, ids []string) (map[string]any, bool) {
	if r == nil {
		return map[string]any{}, false
	}
	mgr := r.ensureSubagentManager()
	if mgr == nil {
		return map[string]any{}, false
	}
	return mgr.wait(ctx, ids)
}
