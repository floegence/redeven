package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"sync"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	fltools "github.com/floegence/floret/tools"
	aitools "github.com/floegence/redeven/internal/ai/tools"
)

type floretToolRuntimeState struct {
	mu    sync.Mutex
	state runtimeState
}

func newFloretToolRuntimeState(state runtimeState) *floretToolRuntimeState {
	return &floretToolRuntimeState{state: state}
}

func (s *floretToolRuntimeState) snapshot() runtimeState {
	if s == nil {
		return runtimeState{}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state
}

func (s *floretToolRuntimeState) updateFromToolResult(call ToolCall, result ToolResult, round int) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	id := strings.TrimSpace(call.ID)
	if id != "" {
		if s.state.ToolCallLedger == nil {
			s.state.ToolCallLedger = map[string]string{}
		}
		s.state.ToolCallLedger[id] = "dispatched"
	}
	updateTodoRuntimeState(&s.state, []ToolCall{call}, []ToolResult{result}, round)
	if result.Status == toolResultStatusSuccess {
		if id != "" {
			s.state.ToolCallLedger[id] = "completed"
		}
		s.state.CompletedActionFacts = appendLimited(s.state.CompletedActionFacts, result.ToolName+": "+strings.TrimSpace(result.Summary), 12)
		return
	}
	if id != "" {
		if result.Status == toolResultStatusAborted {
			s.state.ToolCallLedger[id] = "aborted"
		} else {
			s.state.ToolCallLedger[id] = "failed"
		}
		s.state.BlockedEvidenceRefs = appendLimited(s.state.BlockedEvidenceRefs, "tool:"+id, 12)
	}
	detail := strings.TrimSpace(result.Details)
	if detail == "" && result.Error != nil {
		detail = strings.TrimSpace(result.Error.Message)
	}
	if detail == "" {
		detail = strings.TrimSpace(result.Summary)
	}
	s.state.BlockedActionFacts = appendLimited(s.state.BlockedActionFacts, result.ToolName+": "+detail, 12)
}

func buildFloretToolRegistry(r *run, activeTools []ToolDef, state *floretToolRuntimeState) (*fltools.Registry, error) {
	registry := fltools.NewRegistry()
	for _, def := range activeTools {
		name := strings.TrimSpace(def.Name)
		if name == "" || isFlowerControlTool(name) {
			continue
		}
		def := def
		toolDef, err := floretToolDefinition(def)
		if err != nil {
			return nil, err
		}
		tool := fltools.Define[map[string]any](
			toolDef,
			nil,
			floretToolResources,
			func(ctx context.Context, inv fltools.Invocation[map[string]any]) (fltools.Result, error) {
				call := ToolCall{
					ID:   strings.TrimSpace(inv.CallID),
					Name: strings.TrimSpace(inv.Name),
					Args: cloneAnyMap(inv.Args),
				}
				if call.Name == "" {
					call.Name = strings.TrimSpace(def.Name)
				}
				handler := &builtInToolHandler{r: r, toolName: call.Name}
				result, err := handler.Execute(ctx, call)
				if err != nil {
					return fltools.Result{}, err
				}
				if _, err := validateToolResultStatus(result.Status); err != nil {
					return fltools.Result{}, err
				}
				if state != nil {
					state.updateFromToolResult(call, result, inv.Step)
				}
				toolResult, err := floretToolResultFromFlower(r, result)
				if err != nil {
					return fltools.Result{}, err
				}
				return toolResult, nil
			},
		)
		if err := registry.Register(tool); err != nil {
			return nil, err
		}
	}
	return registry, nil
}

func floretToolApproverForRun(r *run) fltools.Approver {
	if r == nil {
		return nil
	}
	return func(ctx context.Context, req fltools.ApprovalRequest) (fltools.PermissionDecision, error) {
		return r.approveFloretTool(ctx, req)
	}
}

func floretHostLabelsForRun(r *run) map[string]string {
	return map[string]string{
		"endpoint_id": strings.TrimSpace(r.endpointID),
		"engine":      "redeven",
	}
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

const (
	activityPresentationLabelLimit       = 200
	activityPresentationDescriptionLimit = 500
	activityPayloadKeyLimit              = 80
	activityPayloadStringLimit           = 8000
	activityPayloadMaxDepth              = 5
)

func activityPresentationLabel(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= activityPresentationLabelLimit {
		return value
	}
	const suffix = "..."
	limit := activityPresentationLabelLimit - len([]rune(suffix))
	if limit <= 0 {
		return string(runes[:activityPresentationLabelLimit])
	}
	return strings.TrimSpace(string(runes[:limit])) + suffix
}

func activityPresentationDescription(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	out, _ := contractSafeString(value, activityPresentationDescriptionLimit)
	return out
}

func activityToolErrorPayload(toolErr *aitools.ToolError) map[string]any {
	if toolErr == nil {
		return map[string]any{}
	}
	toolErr.Normalize()
	out := map[string]any{
		"code":      strings.TrimSpace(string(toolErr.Code)),
		"message":   strings.TrimSpace(toolErr.Message),
		"retryable": toolErr.Retryable,
	}
	return out
}

func activityToolErrorPayloadFromValue(value any) (map[string]any, bool) {
	switch typed := value.(type) {
	case *aitools.ToolError:
		if typed == nil {
			return nil, false
		}
		return activityToolErrorPayload(typed), true
	case aitools.ToolError:
		toolErr := typed
		return activityToolErrorPayload(&toolErr), true
	default:
		return nil, false
	}
}

func activityToolErrorRecordFromValue(value any) (map[string]any, bool) {
	if payload, ok := activityToolErrorPayloadFromValue(value); ok {
		return payload, true
	}
	record, ok := value.(map[string]any)
	if !ok {
		return nil, false
	}
	code := strings.TrimSpace(anyToString(record["code"]))
	message := strings.TrimSpace(anyToString(record["message"]))
	if code == "" && message == "" {
		return nil, false
	}
	out := map[string]any{
		"code":      code,
		"message":   message,
		"retryable": readBoolField(record, "retryable"),
	}
	return out, true
}

func validateToolResultStatus(status string) (string, error) {
	status = strings.TrimSpace(status)
	switch status {
	case toolResultStatusSuccess, toolResultStatusError, toolResultStatusTimeout, toolResultStatusAborted:
		return status, nil
	default:
		if status == "" {
			return "", fmt.Errorf("tool result status is required")
		}
		return "", fmt.Errorf("tool result status %q is not supported", status)
	}
}

func contractSafeToolResultPayload(result ToolResult) (map[string]any, error) {
	status, err := validateToolResultStatus(result.Status)
	if err != nil {
		return nil, err
	}
	if result.Error != nil && status == toolResultStatusSuccess {
		return nil, fmt.Errorf("tool result status %q cannot carry an error", status)
	}
	raw := map[string]any{
		"status":      status,
		"summary":     strings.TrimSpace(result.Summary),
		"details":     strings.TrimSpace(result.Details),
		"truncated":   result.Truncated,
		"content_ref": strings.TrimSpace(result.ContentRef),
	}
	if result.Data != nil {
		raw["data"] = result.Data
	}
	if result.Error != nil {
		raw["error"] = activityToolErrorPayload(result.Error)
	}
	payload, truncated := contractSafePayloadMap(raw, 0)
	if truncated || result.Truncated {
		payload["truncated"] = true
	}
	return payload, nil
}

func floretToolDefinition(def ToolDef) (fltools.Definition, error) {
	inputSchema := map[string]any{"type": "object", "additionalProperties": true}
	if len(def.InputSchema) > 0 {
		var parsed map[string]any
		if err := json.Unmarshal(def.InputSchema, &parsed); err != nil || parsed == nil {
			return fltools.Definition{}, fmt.Errorf("invalid input schema for Floret tool %s", strings.TrimSpace(def.Name))
		}
		inputSchema = stripRedevenTargetFieldsFromFloretToolSchema(strings.TrimSpace(def.Name), parsed)
	}
	effects := floretToolEffects(def)
	readOnly := !def.Mutating && !floretToolOpenWorld(def) && def.Name != "terminal.exec"
	permission := floretToolPermission(def)
	return fltools.Definition{
		Name:         strings.TrimSpace(def.Name),
		Title:        strings.TrimSpace(def.Name),
		Description:  strings.TrimSpace(def.Description),
		InputSchema:  inputSchema,
		Effects:      effects,
		ReadOnly:     readOnly,
		Destructive:  def.Mutating,
		OpenWorld:    floretToolOpenWorld(def),
		ParallelSafe: floretToolParallelSafe(def, effects),
		Permission:   permission,
		PermissionFor: func(req fltools.PermissionRequest) (fltools.PermissionSpec, error) {
			args, _ := req.Args.(map[string]any)
			return floretPermissionForInvocation(def, cloneAnyMap(args)), nil
		},
		Activity: func(inv fltools.Invocation[any]) (*observation.ActivityPresentation, error) {
			args, _ := inv.Args.(map[string]any)
			return floretActivityForToolCall(strings.TrimSpace(def.Name), args), nil
		},
		Annotations: map[string]any{
			"source":    strings.TrimSpace(def.Source),
			"namespace": strings.TrimSpace(def.Namespace),
		},
	}, nil
}

func floretToolPermission(def ToolDef) fltools.PermissionSpec {
	name := strings.TrimSpace(def.Name)
	resourceKinds := floretToolResourceKinds(name)
	mode := fltools.PermissionAllow
	if def.RequiresApproval || aitools.RequiresApproval(name) || name == "terminal.exec" || floretToolOpenWorld(def) {
		mode = fltools.PermissionAsk
	}
	return fltools.PermissionSpec{Mode: mode, ResourceKinds: resourceKinds}
}

func floretPermissionForInvocation(def ToolDef, args map[string]any) fltools.PermissionSpec {
	toolName := strings.TrimSpace(def.Name)
	resourceKinds := floretToolResourceKinds(toolName)
	if toolName == "terminal.exec" && !aitools.RequiresApprovalForInvocation(toolName, args) {
		return fltools.PermissionSpec{Mode: fltools.PermissionAllow, ResourceKinds: resourceKinds}
	}
	permission := floretToolPermission(def)
	if permission.ResourceKinds == nil {
		permission.ResourceKinds = resourceKinds
	}
	if aitools.RequiresApprovalForInvocation(toolName, args) {
		permission.Mode = fltools.PermissionAsk
	}
	return permission
}

func floretToolResourceKinds(toolName string) []string {
	switch strings.TrimSpace(toolName) {
	case "terminal.exec":
		return []string{"command"}
	case "file.read", "file.edit", "file.write", "apply_patch":
		return []string{"file"}
	case "web.search":
		return []string{"web_query"}
	case "okf.search":
		return []string{"knowledge_query"}
	case "use_skill":
		return []string{"skill"}
	case "subagents":
		return []string{"subagent"}
	default:
		return nil
	}
}

func floretToolOpenWorld(def ToolDef) bool {
	switch strings.TrimSpace(def.Name) {
	case "terminal.exec", "web.search":
		return true
	default:
		return false
	}
}

func floretToolResources(inv fltools.Invocation[map[string]any]) ([]fltools.ResourceRef, error) {
	args := cloneAnyMap(inv.Args)
	switch strings.TrimSpace(inv.Name) {
	case "terminal.exec":
		if command := strings.TrimSpace(anyToString(args["command"])); command != "" {
			return []fltools.ResourceRef{{Kind: "command", Value: command}}, nil
		}
	case "file.read", "file.edit", "file.write":
		if path := strings.TrimSpace(anyToString(args["file_path"])); path != "" {
			return []fltools.ResourceRef{{Kind: "file", Value: path}}, nil
		}
	case "apply_patch":
		if patch := strings.TrimSpace(anyToString(args["patch"])); patch != "" {
			files := resourceRefsFromPatch(patch)
			if len(files) > 0 {
				return files, nil
			}
		}
	case "web.search":
		if query := strings.TrimSpace(anyToString(args["query"])); query != "" {
			return []fltools.ResourceRef{{Kind: "web_query", Value: query}}, nil
		}
	case "okf.search":
		if query := strings.TrimSpace(anyToString(args["query"])); query != "" {
			return []fltools.ResourceRef{{Kind: "knowledge_query", Value: query}}, nil
		}
	case "use_skill":
		if name := strings.TrimSpace(anyToString(args["name"])); name != "" {
			return []fltools.ResourceRef{{Kind: "skill", Value: name}}, nil
		}
	case "subagents":
		if action := strings.TrimSpace(anyToString(args["action"])); action != "" {
			return []fltools.ResourceRef{{Kind: "subagent", Value: action}}, nil
		}
	}
	return nil, nil
}

func resourceRefsFromPatch(patch string) []fltools.ResourceRef {
	parsed, err := parsePatchText(patch)
	if err == nil {
		return resourceRefsFromPatchFiles(parsed.files)
	}
	seen := map[string]struct{}{}
	out := make([]fltools.ResourceRef, 0, 4)
	for _, line := range strings.Split(patch, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "--- ") || strings.HasPrefix(line, "+++ ") {
			path := strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(line, "--- "), "+++ "))
			if path == "" || path == "/dev/null" {
				continue
			}
			path = strings.TrimPrefix(path, "a/")
			path = strings.TrimPrefix(path, "b/")
			if _, ok := seen[path]; ok {
				continue
			}
			seen[path] = struct{}{}
			out = append(out, fltools.ResourceRef{Kind: "file", Value: path})
		}
	}
	return out
}

func resourceRefsFromPatchFiles(files []unifiedDiffFile) []fltools.ResourceRef {
	seen := map[string]struct{}{}
	out := make([]fltools.ResourceRef, 0, len(files))
	for _, file := range files {
		for _, path := range []string{strings.TrimSpace(file.oldPath), strings.TrimSpace(file.newPath)} {
			if path == "" || path == "/dev/null" {
				continue
			}
			if _, ok := seen[path]; ok {
				continue
			}
			seen[path] = struct{}{}
			out = append(out, fltools.ResourceRef{Kind: "file", Value: path})
		}
	}
	return out
}

func stripRedevenTargetFieldsFromFloretToolSchema(toolName string, inputSchema map[string]any) map[string]any {
	if !toolRequiresTarget(toolName) || inputSchema == nil {
		return inputSchema
	}
	if properties, ok := inputSchema["properties"].(map[string]any); ok {
		delete(properties, "target_id")
		delete(properties, "targetId")
	}
	required, ok := inputSchema["required"].([]any)
	if !ok || len(required) == 0 {
		return inputSchema
	}
	nextRequired := make([]any, 0, len(required))
	for _, item := range required {
		name := strings.TrimSpace(anyToString(item))
		if name == "target_id" || name == "targetId" {
			continue
		}
		nextRequired = append(nextRequired, item)
	}
	inputSchema["required"] = nextRequired
	return inputSchema
}

func floretToolParallelSafe(def ToolDef, effects []fltools.Effect) bool {
	if !def.ParallelSafe || def.Mutating {
		return false
	}
	if len(effects) == 0 {
		return false
	}
	for _, effect := range effects {
		if effect != fltools.EffectRead {
			return false
		}
	}
	return true
}

func floretToolEffects(def ToolDef) []fltools.Effect {
	name := strings.TrimSpace(def.Name)
	switch name {
	case "terminal.exec":
		return []fltools.Effect{fltools.EffectShell}
	case "web.search":
		return []fltools.Effect{fltools.EffectNetwork}
	case "file.edit", "file.write", "apply_patch":
		return []fltools.Effect{fltools.EffectWrite}
	default:
		return []fltools.Effect{fltools.EffectRead}
	}
}

func floretToolResultFromFlower(r *run, result ToolResult) (fltools.Result, error) {
	structured, err := contractSafeToolResultPayload(result)
	if err != nil {
		return fltools.Result{}, err
	}
	text, _ := json.Marshal(structured)
	status := strings.TrimSpace(anyToString(structured["status"]))
	activity, err := floretActivityForToolResult(r, result)
	if err != nil {
		return fltools.Result{}, err
	}
	return fltools.Result{
		CallID:     strings.TrimSpace(result.ToolID),
		Name:       strings.TrimSpace(result.ToolName),
		Text:       string(text),
		Structured: structured,
		Activity:   activity,
		IsError:    status != toolResultStatusSuccess,
	}, nil
}

func floretActivityForToolCall(toolName string, args map[string]any) *observation.ActivityPresentation {
	toolName = strings.TrimSpace(toolName)
	if toolName == "" {
		return nil
	}
	spec, hasSpec := aitools.PresentationSpec(toolName)
	renderer := activityRendererFromSpec(spec, hasSpec)
	payload := activityPayloadFromFieldList(spec.CallPayloadFields, args)
	payload = activityPayloadWithSpecOperation(payload, spec, hasSpec)
	payload = activityPayloadWithHostDisplayFields(payload, args, spec, hasSpec)
	payload, _ = contractSafePayloadMap(payload, 0)
	activity := &observation.ActivityPresentation{
		Label:    activityCallLabel(toolName, spec, hasSpec, renderer, args, payload),
		Renderer: renderer,
		Payload:  payload,
	}
	if renderer == observation.ActivityRendererTerminal {
		activity.Description = activityPresentationDescription(anyToString(args["description"]))
		activity.Chips = []observation.ActivityChip{{Kind: "tool", Label: "shell", Tone: "neutral"}}
	}
	return contractSafeActivityPresentation(activity)
}

func activityRendererFromSpec(spec aitools.ToolPresentationSpec, ok bool) observation.ActivityRenderer {
	if !ok {
		return observation.ActivityRendererStructured
	}
	switch renderer := observation.ActivityRenderer(strings.TrimSpace(spec.Renderer)); renderer {
	case observation.ActivityRendererStructured,
		observation.ActivityRendererTerminal,
		observation.ActivityRendererFile,
		observation.ActivityRendererPatch,
		observation.ActivityRendererWebSearch,
		observation.ActivityRendererTodos,
		observation.ActivityRendererQuestion,
		observation.ActivityRendererCompletion:
		return renderer
	default:
		return observation.ActivityRendererStructured
	}
}

func activityPayloadWithHostDisplayFields(payload map[string]any, source map[string]any, spec aitools.ToolPresentationSpec, hasSpec bool) map[string]any {
	out := cloneAnyMap(payload)
	if !hasSpec || !activitySpecAllowsPayloadField(spec, "display_name") {
		return out
	}
	if strings.TrimSpace(anyToString(out["display_name"])) != "" {
		return out
	}
	filePath := firstNonEmptyString(anyToString(source["file_path"]), anyToString(source["new_path"]), anyToString(source["old_path"]))
	if displayName := displayNameForFilePath(filePath); displayName != "" {
		out["display_name"] = displayName
	}
	return out
}

func activityPayloadWithSpecOperation(payload map[string]any, spec aitools.ToolPresentationSpec, hasSpec bool) map[string]any {
	if !hasSpec || strings.TrimSpace(spec.Operation) == "" {
		return payload
	}
	return mapWithOperation(payload, strings.TrimSpace(spec.Operation))
}

func activityLabelFromFields(fields []string, records ...map[string]any) string {
	for _, field := range fields {
		field = strings.TrimSpace(field)
		if field == "" {
			continue
		}
		for _, record := range records {
			if record == nil {
				continue
			}
			if value := strings.TrimSpace(anyToString(record[field])); value != "" {
				return activityPresentationLabel(value)
			}
		}
	}
	return ""
}

func activityFallbackLabel(value string, fallback string) string {
	return activityPresentationLabel(firstNonEmptyString(value, fallback))
}

func activityCallLabelFallback(toolName string, spec aitools.ToolPresentationSpec, hasSpec bool) string {
	if hasSpec {
		if label := strings.TrimSpace(spec.CallLabelFallback); label != "" {
			return label
		}
	}
	return toolName
}

func activityResultLabelFallback(toolName string, spec aitools.ToolPresentationSpec, hasSpec bool) string {
	if hasSpec {
		if label := strings.TrimSpace(spec.ResultLabelFallback); label != "" {
			return label
		}
		if label := strings.TrimSpace(spec.CallLabelFallback); label != "" {
			return label
		}
	}
	return toolName
}

func activitySpecAllowsPayloadField(spec aitools.ToolPresentationSpec, key string) bool {
	key = strings.TrimSpace(key)
	if key == "" {
		return false
	}
	for _, field := range spec.CallPayloadFields {
		if strings.TrimSpace(field) == key {
			return true
		}
	}
	for _, field := range spec.ResultPayloadFields {
		if strings.TrimSpace(field) == key {
			return true
		}
	}
	return false
}

func activityPayloadFromFieldList(fields []string, source map[string]any) map[string]any {
	return activityPayloadFromFieldListWithRegistry(nil, fields, source)
}

func activityPayloadFromFieldListWithRegistry(r *run, fields []string, source map[string]any) map[string]any {
	out := map[string]any{}
	for _, field := range fields {
		field = strings.TrimSpace(field)
		if field == "" {
			continue
		}
		if value, ok := activityPayloadFieldValue(r, field, source); ok {
			out[field] = value
		}
	}
	return out
}

func activityPayloadFieldValue(r *run, field string, source map[string]any) (any, bool) {
	if source == nil {
		return nil, false
	}
	if value, ok := source[field]; ok {
		switch field {
		case "mutations":
			return activityMutationPayloads(r, toAnySlice(value)), true
		case "stdout", "stderr":
			if text, ok := value.(string); ok && text != "" {
				return text, true
			}
		}
		if text, ok := value.(string); ok {
			if strings.TrimSpace(text) == "" {
				return nil, false
			}
			return strings.TrimSpace(text), true
		}
		return value, true
	}
	switch field {
	case "files_changed", "hunks", "additions", "deletions":
		if patch := strings.TrimSpace(anyToString(source["patch"])); patch != "" {
			filesChanged, hunks, additions, deletions := summarizeUnifiedDiff(patch)
			switch field {
			case "files_changed":
				return filesChanged, true
			case "hunks":
				return hunks, true
			case "additions":
				return additions, true
			case "deletions":
				return deletions, true
			}
		}
	case "display_name":
		path := firstNonEmptyString(anyToString(source["file_path"]), anyToString(source["new_path"]), anyToString(source["old_path"]))
		if displayName := displayNameForFilePath(path); displayName != "" {
			return displayName, true
		}
	case "file_action_id":
		actionID := activityFileActionIDFromPayload(r, source)
		if actionID != "" {
			return actionID, true
		}
	case "results_count":
		if count := len(toAnySlice(source["results"])); count > 0 {
			return count, true
		}
	case "source_count":
		if count := len(toAnySlice(source["sources"])); count > 0 {
			return count, true
		}
	case "result_count":
		for _, key := range []string{"result_count", "total_concepts", "count"} {
			if value, ok := source[key]; ok {
				return value, true
			}
		}
	case "agent_count":
		if count := len(toAnySlice(source["agents"])); count > 0 {
			return count, true
		}
	case "total", "pending", "in_progress", "completed", "cancelled":
		if value, ok := activityTodoCountValue(source, field); ok {
			return value, true
		}
	}
	return nil, false
}

func activityMutationPayloads(r *run, mutations []any) []any {
	out := make([]any, 0, len(mutations))
	for _, mutation := range mutations {
		record, ok := mutation.(map[string]any)
		if !ok || record == nil {
			continue
		}
		clean := activityPayloadFromFieldListWithRegistry(r, []string{
			"display_name",
			"file_action_id",
			"change_type",
			"additions",
			"deletions",
			"unified_diff",
			"diff_unavailable_reason",
			"truncated",
		}, record)
		if len(clean) > 0 {
			out = append(out, clean)
		}
	}
	return out
}

func activityTodoCountValue(source map[string]any, field string) (any, bool) {
	if value, ok := source[field]; ok {
		return value, true
	}
	if summary, ok := source["summary"].(map[string]any); ok {
		if value, ok := summary[field]; ok {
			return value, true
		}
	}
	count := 0
	for _, item := range toAnySlice(source["todos"]) {
		record, _ := item.(map[string]any)
		if strings.TrimSpace(anyToString(record["status"])) == field {
			count++
		}
	}
	if count > 0 {
		return count, true
	}
	return nil, false
}

func activityCallLabel(toolName string, spec aitools.ToolPresentationSpec, hasSpec bool, _ observation.ActivityRenderer, args map[string]any, payload map[string]any) string {
	if label := activityLabelFromFields(spec.ActivityLabelFields, args, payload); label != "" {
		return label
	}
	fallback := activityCallLabelFallback(toolName, spec, hasSpec)
	return activityFallbackLabel(fallback, toolName)
}

func activityResultLabel(toolName string, spec aitools.ToolPresentationSpec, hasSpec bool, _ observation.ActivityRenderer, payload map[string]any) string {
	if label := activityLabelFromFields(spec.ActivityLabelFields, payload); label != "" {
		return label
	}
	if hasSpec && strings.TrimSpace(spec.ResultLabelFallback) == "" && strings.TrimSpace(spec.CallLabelFallback) == "" {
		return ""
	}
	fallback := activityResultLabelFallback(toolName, spec, hasSpec)
	return activityFallbackLabel(fallback, toolName)
}

func floretActivityForToolResult(r *run, result ToolResult) (*observation.ActivityPresentation, error) {
	toolName := strings.TrimSpace(result.ToolName)
	status, err := validateToolResultStatus(result.Status)
	if err != nil {
		return nil, err
	}
	if result.Error != nil && status == toolResultStatusSuccess {
		return nil, fmt.Errorf("tool result status %q cannot carry an error", status)
	}
	if toolName == "" {
		return nil, nil
	}
	spec, hasSpec := aitools.PresentationSpec(toolName)
	renderer := activityRendererFromSpec(spec, hasSpec)
	rawPayload, dataTruncated := activityPayloadFromResultData(result.Data)
	payload := activityPayloadFromFieldListWithRegistry(r, spec.ResultPayloadFields, rawPayload)
	payload = activityPayloadWithSpecOperation(payload, spec, hasSpec)
	if status != "" {
		payload["status"] = status
	}
	if summary := strings.TrimSpace(result.Summary); summary != "" {
		payload["summary"] = summary
	}
	if details := strings.TrimSpace(result.Details); details != "" {
		payload["details"] = details
	}
	if result.Truncated || dataTruncated || readBoolField(rawPayload, "truncated") || readBoolField(payload, "truncated") {
		payload["truncated"] = true
	}
	if result.ContentRef != "" {
		payload["content_ref"] = strings.TrimSpace(result.ContentRef)
	}
	if result.Error != nil {
		payload["error"] = activityToolErrorPayload(result.Error)
	}
	payload, payloadTruncated := contractSafePayloadMap(payload, 0)
	if payloadTruncated {
		payload["truncated"] = true
	}
	activity := &observation.ActivityPresentation{
		Label:    activityResultLabel(toolName, spec, hasSpec, renderer, payload),
		Renderer: renderer,
		Chips:    activityChipsFromSpec(spec, payload),
		Payload:  payload,
	}
	return contractSafeActivityPresentation(activity), nil
}

func activityPayloadFromResultData(data any) (map[string]any, bool) {
	if data == nil {
		return map[string]any{}, false
	}
	if record, ok := data.(map[string]any); ok {
		return contractSafePayloadMap(record, 0)
	}
	raw, err := json.Marshal(data)
	if err != nil || len(raw) == 0 {
		value, truncated := contractSafePayloadValue(strings.TrimSpace(fmt.Sprint(data)), 1)
		return map[string]any{"value": value}, truncated
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err == nil && out != nil {
		return contractSafePayloadMap(out, 0)
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		safeValue, truncated := contractSafePayloadValue(string(raw), 1)
		return map[string]any{"value": safeValue}, truncated
	}
	safeValue, truncated := contractSafePayloadValue(value, 1)
	return map[string]any{"value": safeValue}, truncated
}

func contractSafePayloadMap(in map[string]any, depth int) (map[string]any, bool) {
	out := make(map[string]any, len(in))
	truncated := false
	for key, value := range in {
		key = contractSafePayloadKey(key)
		if key == "" {
			truncated = true
			continue
		}
		if key == "error" {
			if errorPayload, ok := activityToolErrorRecordFromValue(value); ok {
				safeError, errorTruncated := contractSafePayloadMap(errorPayload, depth+1)
				out[key] = safeError
				truncated = truncated || errorTruncated
				continue
			}
		}
		safeValue, valueTruncated := contractSafePayloadValue(value, depth+1)
		out[key] = safeValue
		truncated = truncated || valueTruncated
	}
	return out, truncated
}

func contractSafePayloadValue(value any, depth int) (any, bool) {
	if depth > activityPayloadMaxDepth {
		text, truncated := contractSafeString(compactJSONForActivityPayload(value), activityPayloadStringLimit)
		return text, true || truncated
	}
	if errorPayload, ok := activityToolErrorPayloadFromValue(value); ok {
		safeError, truncated := contractSafePayloadMap(errorPayload, depth)
		return safeError, truncated
	}
	switch typed := value.(type) {
	case nil:
		return nil, false
	case string:
		return contractSafeString(typed, activityPayloadStringLimit)
	case bool,
		int, int8, int16, int32, int64,
		uint, uint8, uint16, uint32, uint64:
		return typed, false
	case float32:
		if math.IsInf(float64(typed), 0) || math.IsNaN(float64(typed)) {
			return strings.TrimSpace(fmt.Sprint(typed)), true
		}
		return typed, false
	case float64:
		if math.IsInf(typed, 0) || math.IsNaN(typed) {
			return strings.TrimSpace(fmt.Sprint(typed)), true
		}
		return typed, false
	case map[string]any:
		if depth >= activityPayloadMaxDepth {
			text, truncated := contractSafeString(compactJSONForActivityPayload(typed), activityPayloadStringLimit)
			return text, true || truncated
		}
		return contractSafePayloadMap(typed, depth)
	case []any:
		if depth >= activityPayloadMaxDepth {
			text, truncated := contractSafeString(compactJSONForActivityPayload(typed), activityPayloadStringLimit)
			return text, true || truncated
		}
		out := make([]any, 0, len(typed))
		truncated := false
		for _, item := range typed {
			safeItem, itemTruncated := contractSafePayloadValue(item, depth+1)
			out = append(out, safeItem)
			truncated = truncated || itemTruncated
		}
		return out, truncated
	case []map[string]any:
		if depth >= activityPayloadMaxDepth {
			text, truncated := contractSafeString(compactJSONForActivityPayload(typed), activityPayloadStringLimit)
			return text, true || truncated
		}
		out := make([]any, 0, len(typed))
		truncated := false
		for _, item := range typed {
			safeItem, itemTruncated := contractSafePayloadMap(item, depth+1)
			out = append(out, safeItem)
			truncated = truncated || itemTruncated
		}
		return out, truncated
	default:
		raw, err := json.Marshal(value)
		if err != nil || len(raw) == 0 {
			return contractSafePayloadValue(strings.TrimSpace(fmt.Sprint(value)), depth)
		}
		var out any
		if err := json.Unmarshal(raw, &out); err != nil {
			return contractSafePayloadValue(string(raw), depth)
		}
		return contractSafePayloadValue(out, depth)
	}
}

func contractSafeActivityPresentation(activity *observation.ActivityPresentation) *observation.ActivityPresentation {
	if activity == nil {
		return nil
	}
	activity.Label = activityPresentationLabel(activity.Label)
	activity.Description = activityPresentationDescription(activity.Description)
	if len(activity.Payload) > 0 {
		payload, truncated := contractSafePayloadMap(activity.Payload, 0)
		if truncated {
			payload["truncated"] = true
		}
		activity.Payload = payload
	}
	return activity
}

func contractSafePayloadKey(key string) string {
	key = strings.TrimSpace(key)
	if key == "" {
		return ""
	}
	var b strings.Builder
	lastUnderscore := false
	for _, r := range key {
		valid := (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' || r == '.' || r == ':'
		if valid {
			b.WriteRune(r)
			lastUnderscore = false
			continue
		}
		if !lastUnderscore {
			b.WriteByte('_')
			lastUnderscore = true
		}
	}
	out := strings.Trim(b.String(), "_-.:")
	if out == "" {
		return ""
	}
	runes := []rune(out)
	if len(runes) > activityPayloadKeyLimit {
		out = strings.Trim(string(runes[:activityPayloadKeyLimit]), "_-.:")
	}
	return out
}

func contractSafeString(value string, limit int) (string, bool) {
	if value == "" {
		return "", false
	}
	runes := []rune(value)
	if len(runes) <= limit {
		return value, false
	}
	const suffix = "..."
	cut := limit - len([]rune(suffix))
	if cut <= 0 {
		return string(runes[:limit]), true
	}
	return string(runes[:cut]) + suffix, true
}

func compactJSONForActivityPayload(value any) string {
	raw, err := json.Marshal(value)
	if err == nil && len(raw) > 0 {
		return string(raw)
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func activityFileActionIDFromPayload(r *run, payload map[string]any) string {
	filePath := anyToString(payload["file_path"])
	oldPath := anyToString(payload["old_path"])
	newPath := anyToString(payload["new_path"])
	changeType := anyToString(payload["change_type"])
	displayName := firstNonEmptyString(anyToString(payload["display_name"]), displayNameForFilePath(firstNonEmptyString(newPath, filePath, oldPath)))
	previewPath := mutationActionPath(filePath, oldPath, newPath, changeType)
	if previewPath == "" && oldPath == "" && newPath == "" {
		previewPath = filePath
	}
	return registerFlowerActivityFileAction(r, displayName, previewPath, mutationDirectoryPath(previewPath, oldPath, newPath))
}

func registerFlowerActivityFileAction(r *run, displayName string, previewPath string, directoryPath string) string {
	if r == nil {
		return ""
	}
	displayName = strings.TrimSpace(displayName)
	previewPath = strings.TrimSpace(previewPath)
	directoryPath = strings.TrimSpace(directoryPath)
	if displayName == "" || (previewPath == "" && directoryPath == "") {
		return ""
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	if r.activityFileActions == nil {
		r.activityFileActions = map[string]FlowerActivityFileAction{}
	}
	r.activityFileActionSeq++
	actionID := fmt.Sprintf("file_action_%d", r.activityFileActionSeq)
	action := FlowerActivityFileAction{
		ActionID:      actionID,
		DisplayName:   displayName,
		PreviewPath:   previewPath,
		DirectoryPath: directoryPath,
	}
	r.activityFileActions[actionID] = action
	return actionID
}

func mapWithOperation(in map[string]any, operation string) map[string]any {
	out := cloneAnyMap(in)
	if operation != "" {
		out["operation"] = operation
	}
	return out
}

func activityChipsFromSpec(spec aitools.ToolPresentationSpec, payload map[string]any) []observation.ActivityChip {
	chips := []observation.ActivityChip{}
	for _, field := range spec.ChipFields {
		field = strings.TrimSpace(field)
		if field == "" {
			continue
		}
		if chip, ok := activityChipForField(field, payload); ok {
			chips = append(chips, chip)
		}
	}
	return chips
}

func activityChipForField(field string, payload map[string]any) (observation.ActivityChip, bool) {
	if field == "truncated" {
		if !readBoolField(payload, "truncated") {
			return observation.ActivityChip{}, false
		}
		return observation.ActivityChip{Kind: "truncated", Label: "truncated", Tone: "warning"}, true
	}
	value := strings.TrimSpace(activityScalarString(payload[field]))
	if value == "" {
		return observation.ActivityChip{}, false
	}
	chip := observation.ActivityChip{
		Kind:  activityChipKind(field),
		Label: activityChipLabel(field),
		Value: value,
		Tone:  "neutral",
	}
	if field == "exit_code" && value != "0" {
		chip.Tone = "danger"
	}
	if field == "duration_ms" {
		chip.Value = value + " ms"
	}
	if field == "change_type" {
		chip.Label = value
		chip.Value = ""
	}
	return chip, true
}

func activityChipKind(field string) string {
	switch field {
	case "target_id":
		return "target"
	default:
		return field
	}
}

func activityChipLabel(field string) string {
	switch field {
	case "execution_location":
		return "location"
	case "target_id":
		return "target"
	case "exit_code":
		return "exit"
	case "duration_ms":
		return "duration"
	case "files_changed":
		return "files"
	case "results_count", "result_count":
		return "results"
	case "source_count":
		return "sources"
	case "agent_count":
		return "agents"
	default:
		return strings.ReplaceAll(field, "_", " ")
	}
}

func activityScalarString(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case []byte:
		return string(v)
	case int:
		return fmt.Sprintf("%d", v)
	case int8:
		return fmt.Sprintf("%d", v)
	case int16:
		return fmt.Sprintf("%d", v)
	case int32:
		return fmt.Sprintf("%d", v)
	case int64:
		return fmt.Sprintf("%d", v)
	case uint:
		return fmt.Sprintf("%d", v)
	case uint8:
		return fmt.Sprintf("%d", v)
	case uint16:
		return fmt.Sprintf("%d", v)
	case uint32:
		return fmt.Sprintf("%d", v)
	case uint64:
		return fmt.Sprintf("%d", v)
	case float32:
		return fmt.Sprintf("%g", v)
	case float64:
		return fmt.Sprintf("%g", v)
	default:
		return ""
	}
}

func isFlowerControlTool(name string) bool {
	switch strings.TrimSpace(name) {
	case "ask_user", "task_complete", "exit_plan_mode":
		return true
	default:
		return false
	}
}

func floretControlDefinitionsFromTools(activeTools []ToolDef) ([]fltools.ToolDefinition, error) {
	defs := make([]fltools.ToolDefinition, 0, 3)
	hasTaskComplete := false
	for _, def := range activeTools {
		if strings.TrimSpace(def.Name) == "task_complete" {
			hasTaskComplete = true
			break
		}
	}
	coreDefs := flruntime.CoreControlDefinitions(hasTaskComplete)
	coreByName := make(map[string]fltools.ToolDefinition, len(coreDefs))
	for _, def := range coreDefs {
		coreByName[strings.TrimSpace(def.Name)] = def
	}
	for _, def := range activeTools {
		name := strings.TrimSpace(def.Name)
		if !isFlowerControlTool(name) {
			continue
		}
		inputSchema := map[string]any{"type": "object", "additionalProperties": true}
		if len(def.InputSchema) > 0 {
			var parsed map[string]any
			if err := json.Unmarshal(def.InputSchema, &parsed); err != nil || parsed == nil {
				return nil, fmt.Errorf("invalid input schema for Floret control tool %s", name)
			}
			inputSchema = parsed
		}
		toolDef := fltools.ToolDefinition{
			Name:        name,
			Title:       name,
			Description: strings.TrimSpace(def.Description),
			InputSchema: inputSchema,
			Strict:      true,
			Annotations: map[string]any{
				"kind":      "control",
				"source":    strings.TrimSpace(def.Source),
				"namespace": strings.TrimSpace(def.Namespace),
			},
		}
		if coreDef, ok := coreByName[name]; ok {
			toolDef = coreDef
			if strings.TrimSpace(def.Description) != "" {
				toolDef.Description = strings.TrimSpace(def.Description)
			}
			if inputSchema != nil {
				toolDef.InputSchema = inputSchema
			}
			if toolDef.Annotations == nil {
				toolDef.Annotations = map[string]any{}
			}
			toolDef.Annotations["kind"] = "control"
			toolDef.Annotations["source"] = strings.TrimSpace(def.Source)
			toolDef.Annotations["namespace"] = strings.TrimSpace(def.Namespace)
			toolDef.Annotations["core_control"] = true
		}
		defs = append(defs, toolDef)
	}
	return defs, nil
}

func floretControlToolsForContract(all []ToolDef, contract runCapabilityContract) []ToolDef {
	allowed := make(map[string]struct{}, len(contract.AllowedSignals))
	for _, name := range contract.AllowedSignals {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		allowed[name] = struct{}{}
	}
	if len(allowed) == 0 {
		return nil
	}
	out := make([]ToolDef, 0, len(allowed))
	seen := make(map[string]struct{}, len(allowed))
	for _, def := range all {
		name := strings.TrimSpace(def.Name)
		if name == "" {
			continue
		}
		if _, ok := allowed[name]; !ok {
			continue
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		out = append(out, def)
	}
	return out
}
