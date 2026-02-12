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
		r.skillManager = newSkillManager(r.fsRoot)
		r.skillManager.Discover()
	}
	return r.skillManager
}

func (r *run) listSkills() []SkillMeta {
	mgr := r.ensureSkillManager()
	if mgr == nil {
		return nil
	}
	return mgr.List()
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
	activation, alreadyActive, err := mgr.Activate(name)
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
	mgr := r.ensureSubagentManager()
	if mgr == nil {
		return nil, errors.New("subagent manager unavailable")
	}
	return mgr.delegate(ctx, args)
}

func (r *run) sendSubagentInput(id string, message string, interrupt bool) (map[string]any, error) {
	if r == nil {
		return nil, errors.New("nil run")
	}
	mgr := r.ensureSubagentManager()
	if mgr == nil {
		return nil, errors.New("subagent manager unavailable")
	}
	return mgr.sendInput(id, message, interrupt)
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

func (r *run) closeSubagent(id string) (map[string]any, error) {
	if r == nil {
		return nil, errors.New("nil run")
	}
	mgr := r.ensureSubagentManager()
	if mgr == nil {
		return nil, errors.New("subagent manager unavailable")
	}
	return mgr.close(id)
}
