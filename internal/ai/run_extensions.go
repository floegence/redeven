package ai

import (
	"context"
	"errors"
	"fmt"
	"sort"
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

func (r *run) manageSubagents(ctx context.Context, args map[string]any) (map[string]any, error) {
	if r == nil {
		return nil, errors.New("nil run")
	}
	if !r.allowSubagentDelegate {
		return nil, fmt.Errorf("subagents is disabled in this run")
	}
	action := strings.ToLower(strings.TrimSpace(anyToString(args["action"])))
	if action == "" {
		err := subagentArgumentsError{
			code: "invalid_arguments.subagents.missing_action",
			msg:  "subagents action is required",
			meta: nil,
		}
		r.persistRunEvent("delegation.manage.validation_error", RealtimeStreamKindLifecycle, map[string]any{
			"action":                "",
			"provided_keys":         subagentValidationProvidedKeys(args),
			"contract_variant":      "unknown",
			"validation_error_code": err.InvalidArgumentsCode(),
		})
		return nil, err
	}
	contractVariant := subagentValidationContractVariant(action, args)
	if err := validateSubagentsArgsByAction(action, args); err != nil {
		eventPayload := map[string]any{
			"action":           action,
			"provided_keys":    subagentValidationProvidedKeys(args),
			"contract_variant": contractVariant,
		}
		var subagentErr subagentArgumentsError
		if errors.As(err, &subagentErr) {
			eventPayload["validation_error_code"] = subagentErr.InvalidArgumentsCode()
		}
		r.persistRunEvent("delegation.manage.validation_error", RealtimeStreamKindLifecycle, eventPayload)
		return nil, err
	}
	mgr := r.ensureSubagentManager()
	if mgr == nil {
		return nil, errors.New("subagent manager unavailable")
	}
	return mgr.manage(ctx, args)
}

type subagentArgumentsError struct {
	code string
	msg  string
	meta map[string]any
}

func (e subagentArgumentsError) Error() string {
	msg := strings.TrimSpace(e.msg)
	if msg == "" {
		msg = "invalid subagents arguments"
	}
	return "invalid arguments: " + msg
}

func (e subagentArgumentsError) InvalidArgumentsCode() string {
	return strings.TrimSpace(e.code)
}

func (e subagentArgumentsError) InvalidArgumentsMeta() map[string]any {
	return cloneAnyMap(e.meta)
}

func invalidSubagentArguments(code string, msg string, meta map[string]any) error {
	return subagentArgumentsError{
		code: strings.TrimSpace(code),
		msg:  strings.TrimSpace(msg),
		meta: cloneAnyMap(meta),
	}
}

func validateSubagentsArgsByAction(action string, args map[string]any) error {
	switch action {
	case subagentActionCreate:
		if strings.TrimSpace(anyToString(args["objective"])) == "" {
			return invalidSubagentArguments("invalid_arguments.subagents.create_requires_objective", "create requires objective", nil)
		}
		agentType := strings.ToLower(strings.TrimSpace(anyToString(args["agent_type"])))
		if !isValidSubagentAgentType(agentType) {
			return invalidSubagentArguments(
				"invalid_arguments.subagents.create_invalid_agent_type",
				fmt.Sprintf("invalid agent_type %q", strings.TrimSpace(anyToString(args["agent_type"]))),
				nil,
			)
		}
		if strings.TrimSpace(anyToString(args["trigger_reason"])) == "" {
			return invalidSubagentArguments("invalid_arguments.subagents.create_requires_trigger_reason", "create requires trigger_reason", nil)
		}
		if len(extractStringSlice(args["deliverables"])) == 0 {
			return invalidSubagentArguments("invalid_arguments.subagents.create_requires_deliverables", "create requires deliverables", nil)
		}
		if len(extractStringSlice(args["definition_of_done"])) == 0 {
			return invalidSubagentArguments("invalid_arguments.subagents.create_requires_definition_of_done", "create requires definition_of_done", nil)
		}
		outputSchema, ok := args["output_schema"].(map[string]any)
		if !ok || len(outputSchema) == 0 {
			return invalidSubagentArguments("invalid_arguments.subagents.create_requires_output_schema", "create requires output_schema", nil)
		}
		if err := validateSubagentOutputSchemaDefinition(outputSchema); err != nil {
			return invalidSubagentArguments("invalid_arguments.subagents.invalid_output_schema", err.Error(), nil)
		}
		return nil
	case subagentActionWait:
		return nil
	case subagentActionList:
		return nil
	case subagentActionInspect:
		target := strings.TrimSpace(anyToString(args["target"]))
		ids := extractStringSlice(args["ids"])
		if target == "" && len(ids) == 0 {
			return invalidSubagentArguments("invalid_arguments.subagents.inspect_requires_target_or_ids", "inspect requires target or ids", nil)
		}
		return nil
	case subagentActionSteer:
		if strings.TrimSpace(anyToString(args["target"])) == "" {
			return invalidSubagentArguments("invalid_arguments.subagents.steer_requires_target", "steer requires target", nil)
		}
		message := strings.TrimSpace(anyToString(args["message"]))
		if message == "" {
			return invalidSubagentArguments("invalid_arguments.subagents.steer_requires_message", "steer requires message", nil)
		}
		if len(message) > 4000 {
			return invalidSubagentArguments("invalid_arguments.subagents.steer_message_too_long", "steer message too long", nil)
		}
		return nil
	case subagentActionTerminate:
		if strings.TrimSpace(anyToString(args["target"])) == "" {
			return invalidSubagentArguments("invalid_arguments.subagents.terminate_requires_target", "terminate requires target", nil)
		}
		return nil
	case subagentActionTerminateAll:
		scope := strings.ToLower(strings.TrimSpace(anyToString(args["scope"])))
		if scope == "" {
			scope = "current_run"
		}
		if scope != "current_run" {
			return invalidSubagentArguments(
				"invalid_arguments.subagents.terminate_all_invalid_scope",
				fmt.Sprintf("invalid scope %q", strings.TrimSpace(anyToString(args["scope"]))),
				nil,
			)
		}
		return nil
	default:
		return invalidSubagentArguments(
			"invalid_arguments.subagents.unsupported_action",
			fmt.Sprintf("unsupported action %q", strings.TrimSpace(anyToString(args["action"]))),
			nil,
		)
	}
}

func subagentValidationProvidedKeys(args map[string]any) []string {
	if len(args) == 0 {
		return []string{}
	}
	out := make([]string, 0, len(args))
	for k := range args {
		key := strings.TrimSpace(k)
		if key == "" {
			continue
		}
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}

func subagentValidationContractVariant(action string, args map[string]any) string {
	switch action {
	case subagentActionInspect:
		hasTarget := strings.TrimSpace(anyToString(args["target"])) != ""
		hasIDs := len(extractStringSlice(args["ids"])) > 0
		switch {
		case hasTarget && hasIDs:
			return "inspect.target_and_ids"
		case hasTarget:
			return "inspect.target"
		case hasIDs:
			return "inspect.ids"
		default:
			return "inspect.invalid"
		}
	default:
		if action == "" {
			return "unknown"
		}
		return action
	}
}
