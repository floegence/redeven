package ai

import (
	"context"
	"encoding/json"
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
		r.skillManager = newSkillManager(r.agentHomeDir, r.stateDir)
	}
	return r.skillManager
}

func (r *run) listSkills() []SkillMeta {
	mgr := r.ensureSkillManager()
	if mgr == nil {
		return nil
	}
	return r.scopedSkills(mgr.List(r.skillPermissionType()))
}

func (r *run) activateSkill(ctx context.Context, name string) (SkillActivation, bool, error) {
	if r == nil {
		return SkillActivation{}, false, errors.New("nil run")
	}
	mgr := r.ensureSkillManager()
	if mgr == nil {
		return SkillActivation{}, false, errors.New("skill manager unavailable")
	}
	snapshot, ok := toolAuthorizationSnapshotFromContext(ctx)
	if !ok || snapshot.PermissionType == "" {
		return SkillActivation{}, false, errors.New("skill activation authorization snapshot is unavailable")
	}
	if strings.TrimSpace(name) == pluginAuthoringSkillName && !r.hasPluginDraft() {
		return SkillActivation{}, false, errors.New("plugin authoring skill is available only in a plugin creation conversation")
	}
	if strings.TrimSpace(name) == tessivenSkillName && !r.hasTessivenThread() {
		return SkillActivation{}, false, errors.New("Tessiven skill is available only in a Tessiven conversation")
	}
	activation, alreadyActive, err := mgr.Activate(ctx, name, permissionTypeString(snapshot.PermissionType), false)
	if err != nil {
		r.recordRunDiagnostic("skill.activate.error", RealtimeStreamKindLifecycle, map[string]any{"name": strings.TrimSpace(name), "error": err.Error()})
		return SkillActivation{}, false, err
	}
	r.recordRunDiagnostic("skill.activated", RealtimeStreamKindLifecycle, map[string]any{"name": activation.Name, "activation_id": activation.ActivationID, "already_active": alreadyActive})
	return activation, alreadyActive, nil
}

func (r *run) skillPermissionType() string {
	permissionType := r.currentPermissionType()
	if r == nil || permissionType == "" {
		return ""
	}
	return permissionTypeString(permissionType)
}

func (r *run) ensureSubagentRuntime() subagentRuntime {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if runtime, ok := r.subagentRuntime.(*floretSubagentRuntime); ok {
		runtime.attachParentRun(r)
	}
	return r.subagentRuntime
}

func (r *run) manageSubagentsForTool(ctx context.Context, toolCallID string, args map[string]any) (map[string]any, error) {
	if r == nil {
		return nil, errors.New("nil run")
	}
	if !r.allowSubagentDelegate {
		return nil, fmt.Errorf("subagents is disabled in this run")
	}
	action := strings.ToLower(strings.TrimSpace(anyToString(args["action"])))
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
		r.recordRunDiagnostic("delegation.manage.validation_error", RealtimeStreamKindLifecycle, eventPayload)
		return nil, err
	}
	runtime := r.ensureSubagentRuntime()
	if runtime == nil {
		return nil, errors.New("subagent runtime unavailable")
	}
	return runtime.manage(ctx, strings.TrimSpace(toolCallID), args)
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

func decodeSubagentsToolInput(raw []byte) (map[string]any, error) {
	var args map[string]any
	if err := json.Unmarshal(raw, &args); err != nil {
		return nil, err
	}
	action := strings.ToLower(strings.TrimSpace(anyToString(args["action"])))
	return args, validateSubagentsArgsByAction(action, args)
}

// Null is omission on strict provider routes. Every non-null field must belong
// to the selected action, including empty arrays, false and default values.
func validateSubagentsArgsByAction(action string, args map[string]any) error {
	allowed := map[string][]string{
		subagentActionSpawn:     {"task_name", "task_description", "message", "context_mode", "title", "objective"},
		subagentActionSendInput: {"target", "message"},
		subagentActionWait:      {"ids", "timeout_ms"},
		subagentActionList:      {"running_only", "limit"},
		subagentActionStatus:    {"target", "ids"},
		subagentActionInspect:   {"target", "ids"},
		subagentActionClose:     {"target"},
		subagentActionCloseAll:  {"scope"},
	}
	if fields, known := allowed[action]; known {
		unsupported := []string{}
		for key, value := range args {
			if key == "action" || value == nil {
				continue
			}
			found := false
			for _, field := range fields {
				found = found || key == field
			}
			if !found {
				unsupported = append(unsupported, key)
			}
		}
		if len(unsupported) > 0 {
			sort.Strings(unsupported)
			return invalidSubagentArguments("invalid_arguments.subagents.unsupported_fields", fmt.Sprintf("%s does not accept %s", action, strings.Join(unsupported, ", ")), map[string]any{"action": action, "fields": unsupported})
		}
	}
	switch action {
	case "":
		return invalidSubagentArguments("invalid_arguments.subagents.missing_action", "subagents action is required", nil)
	case subagentActionSpawn:
		if _, exists := args["title"]; exists {
			return invalidSubagentArguments("invalid_arguments.subagents.spawn_title_unsupported", "spawn does not accept title; use task_name", nil)
		}
		if _, exists := args["objective"]; exists {
			return invalidSubagentArguments("invalid_arguments.subagents.spawn_objective_unsupported", "spawn does not accept objective; use message", nil)
		}
		if strings.TrimSpace(anyToString(args["task_name"])) == "" {
			return invalidSubagentArguments("invalid_arguments.subagents.spawn_requires_task_name", "spawn requires task_name", nil)
		}
		if strings.TrimSpace(anyToString(args["task_description"])) == "" {
			return invalidSubagentArguments("invalid_arguments.subagents.spawn_requires_task_description", "spawn requires task_description", nil)
		}
		if strings.TrimSpace(anyToString(args["message"])) == "" {
			return invalidSubagentArguments("invalid_arguments.subagents.spawn_requires_message", "spawn requires message", nil)
		}
		return nil
	case subagentActionWait:
		if len(normalizeSubagentThreadIDs(args["ids"])) == 0 {
			return invalidSubagentArguments("invalid_arguments.subagents.wait_requires_ids", "wait requires ids", nil)
		}
		return nil
	case subagentActionList:
		return nil
	case subagentActionStatus:
		targets := collectInspectTargets(args)
		if len(targets) == 0 {
			return invalidSubagentArguments("invalid_arguments.subagents.status_requires_target_or_ids", "status requires target or ids", nil)
		}
		if len(targets) > 200 {
			return invalidSubagentArguments("invalid_arguments.subagents.status_too_many_targets", "status supports at most 200 distinct targets", nil)
		}
		return nil
	case subagentActionInspect:
		target := strings.TrimSpace(anyToString(args["target"]))
		ids := extractStringSlice(args["ids"])
		if target == "" && len(ids) == 0 {
			return invalidSubagentArguments("invalid_arguments.subagents.inspect_requires_target_or_ids", "inspect requires target or ids", nil)
		}
		return nil
	case subagentActionSendInput:
		if strings.TrimSpace(anyToString(args["target"])) == "" {
			return invalidSubagentArguments("invalid_arguments.subagents.send_input_requires_target", "send_input requires target", nil)
		}
		message := strings.TrimSpace(anyToString(args["message"]))
		if message == "" {
			return invalidSubagentArguments("invalid_arguments.subagents.send_input_requires_message", "send_input requires message", nil)
		}
		if len(message) > 4000 {
			return invalidSubagentArguments("invalid_arguments.subagents.send_input_message_too_long", "send_input message too long", nil)
		}
		return nil
	case subagentActionClose:
		if strings.TrimSpace(anyToString(args["target"])) == "" {
			return invalidSubagentArguments("invalid_arguments.subagents.close_requires_target", "close requires target", nil)
		}
		return nil
	case subagentActionCloseAll:
		scope := strings.ToLower(strings.TrimSpace(anyToString(args["scope"])))
		if scope == "" {
			scope = "current_thread"
		}
		if scope != "current_thread" {
			return invalidSubagentArguments(
				"invalid_arguments.subagents.close_all_invalid_scope",
				fmt.Sprintf("close_all scope must be current_thread; got %q", strings.TrimSpace(anyToString(args["scope"]))),
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
