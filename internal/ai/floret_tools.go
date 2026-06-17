package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"path/filepath"
	"strings"
	"sync"

	"github.com/floegence/floret/observation"
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
			nil,
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
	readOnly := !def.Mutating && def.Name != "terminal.exec"
	return fltools.Definition{
		Name:         strings.TrimSpace(def.Name),
		Title:        strings.TrimSpace(def.Name),
		Description:  strings.TrimSpace(def.Description),
		InputSchema:  inputSchema,
		Effects:      effects,
		ReadOnly:     readOnly,
		Destructive:  def.Mutating,
		OpenWorld:    false,
		ParallelSafe: floretToolParallelSafe(def, effects),
		Permission:   fltools.PermissionSpec{Mode: fltools.PermissionAllow},
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
	payload := activityCallPayloadForTool(toolName, args)
	payload, _ = contractSafePayloadMap(payload, 0)
	var activity *observation.ActivityPresentation
	switch toolName {
	case "terminal.exec":
		command := strings.TrimSpace(anyToString(args["command"]))
		if command == "" {
			command = "terminal.exec"
		}
		activity = &observation.ActivityPresentation{
			Label:       activityPresentationLabel(command),
			Description: activityPresentationDescription(anyToString(args["description"])),
			Renderer:    observation.ActivityRendererTerminal,
			Chips:       []observation.ActivityChip{{Kind: "tool", Label: "shell", Tone: "neutral"}},
			Payload:     payload,
		}
	case "file.read":
		path := strings.TrimSpace(anyToString(args["file_path"]))
		displayName := displayNameForFilePath(path)
		if displayName != "" {
			payload["display_name"] = displayName
		}
		activity = &observation.ActivityPresentation{
			Label:    activityPresentationLabel(firstNonEmptyString(displayName, "file.read")),
			Renderer: observation.ActivityRendererFile,
			Payload:  mapWithOperation(payload, "read"),
		}
	case "file.edit":
		path := strings.TrimSpace(anyToString(args["file_path"]))
		displayName := displayNameForFilePath(path)
		if displayName != "" {
			payload["display_name"] = displayName
		}
		activity = &observation.ActivityPresentation{
			Label:    activityPresentationLabel(firstNonEmptyString(displayName, "file.edit")),
			Renderer: observation.ActivityRendererFile,
			Payload:  mapWithOperation(payload, "edit"),
		}
	case "file.write":
		path := strings.TrimSpace(anyToString(args["file_path"]))
		displayName := displayNameForFilePath(path)
		if displayName != "" {
			payload["display_name"] = displayName
		}
		activity = &observation.ActivityPresentation{
			Label:    activityPresentationLabel(firstNonEmptyString(displayName, "file.write")),
			Renderer: observation.ActivityRendererFile,
			Payload:  mapWithOperation(payload, "write"),
		}
	case "apply_patch":
		activity = &observation.ActivityPresentation{
			Label:    "apply_patch",
			Renderer: observation.ActivityRendererPatch,
			Payload:  mapWithOperation(payload, "apply_patch"),
		}
	case "web.search":
		query := strings.TrimSpace(anyToString(args["query"]))
		activity = &observation.ActivityPresentation{
			Label:    activityPresentationLabel(firstNonEmptyString(query, "web.search")),
			Renderer: observation.ActivityRendererWebSearch,
			Payload:  payload,
		}
	case "okf.search":
		query := strings.TrimSpace(anyToString(args["query"]))
		activity = &observation.ActivityPresentation{
			Label:    activityPresentationLabel(firstNonEmptyString(query, "okf.search")),
			Renderer: observation.ActivityRendererStructured,
			Payload:  mapWithOperation(payload, "okf.search"),
		}
	case "write_todos":
		activity = &observation.ActivityPresentation{
			Label:    "Update todos",
			Renderer: observation.ActivityRendererTodos,
			Payload:  payload,
		}
	case "use_skill":
		name := strings.TrimSpace(anyToString(args["name"]))
		activity = &observation.ActivityPresentation{
			Label:    activityPresentationLabel(firstNonEmptyString(name, "use_skill")),
			Renderer: observation.ActivityRendererStructured,
			Payload:  mapWithOperation(payload, "use_skill"),
		}
	case "subagents":
		action := strings.TrimSpace(anyToString(args["action"]))
		activity = &observation.ActivityPresentation{
			Label:    activityPresentationLabel(firstNonEmptyString(action, "subagents")),
			Renderer: observation.ActivityRendererStructured,
			Payload:  mapWithOperation(payload, "subagents"),
		}
	default:
		if toolName == "" {
			return nil
		}
		activity = &observation.ActivityPresentation{
			Label:    activityPresentationLabel(toolName),
			Renderer: observation.ActivityRendererStructured,
			Payload:  payload,
		}
	}
	return contractSafeActivityPresentation(activity)
}

func activityCallPayloadForTool(toolName string, args map[string]any) map[string]any {
	out := map[string]any{}
	addString := func(key string) {
		if value := strings.TrimSpace(anyToString(args[key])); value != "" {
			out[key] = value
		}
	}
	addScalar := func(key string) {
		switch value := args[key].(type) {
		case string:
			if strings.TrimSpace(value) != "" {
				out[key] = strings.TrimSpace(value)
			}
		case bool:
			out[key] = value
		case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, float32, float64:
			out[key] = value
		}
	}
	switch strings.TrimSpace(toolName) {
	case "terminal.exec":
		addString("command")
		addScalar("timeout_ms")
		addString("description")
	case "file.read":
		addScalar("offset")
		addScalar("limit")
	case "file.edit":
		addScalar("replace_all")
	case "file.write":
	case "apply_patch":
		if patch := strings.TrimSpace(anyToString(args["patch"])); patch != "" {
			filesChanged, hunks, additions, deletions := summarizeUnifiedDiff(patch)
			out["files_changed"] = filesChanged
			out["hunks"] = hunks
			out["additions"] = additions
			out["deletions"] = deletions
		}
	case "web.search", "okf.search":
		addString("query")
		addScalar("count")
		addString("provider")
	case "write_todos":
		if todos := toAnySlice(args["todos"]); len(todos) > 0 {
			out["todos"] = sanitizedTodoActivityItems(todos)
		}
		addScalar("expected_version")
		addString("explanation")
	case "use_skill":
		addString("name")
	case "subagents":
		addString("action")
		addScalar("limit")
	}
	return out
}

func sanitizedTodoActivityItems(items []any) []any {
	out := make([]any, 0, len(items))
	for _, item := range items {
		record, ok := item.(map[string]any)
		if !ok {
			continue
		}
		clean := map[string]any{}
		for _, key := range []string{"id", "content", "status", "note"} {
			if value := strings.TrimSpace(anyToString(record[key])); value != "" {
				clean[key] = value
			}
		}
		if len(clean) > 0 {
			out = append(out, clean)
		}
	}
	return out
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
	payload, dataTruncated := activityPresentationPayloadFromToolResultData(r, toolName, result.Data)
	payload["status"] = status
	payload["summary"] = strings.TrimSpace(result.Summary)
	payload["details"] = strings.TrimSpace(result.Details)
	if result.Truncated || dataTruncated || readBoolField(payload, "truncated") {
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
	switch toolName {
	case "terminal.exec":
		return &observation.ActivityPresentation{
			Label:    activityPresentationLabel(anyToString(payload["command"])),
			Renderer: observation.ActivityRendererTerminal,
			Chips:    terminalActivityChips(payload),
			Payload:  payload,
		}, nil
	case "file.read":
		displayName := firstNonEmptyString(anyToString(payload["display_name"]), "file.read")
		return &observation.ActivityPresentation{
			Label:    activityPresentationLabel(displayName),
			Renderer: observation.ActivityRendererFile,
			Chips:    fileActivityChips(payload),
			Payload:  mapWithOperation(payload, "read"),
		}, nil
	case "file.edit", "file.write":
		operation := "edit"
		if toolName == "file.write" {
			operation = "write"
		}
		displayName := firstNonEmptyString(anyToString(payload["display_name"]), toolName)
		return &observation.ActivityPresentation{
			Label:    activityPresentationLabel(displayName),
			Renderer: observation.ActivityRendererFile,
			Chips:    fileActivityChips(payload),
			Payload:  mapWithOperation(payload, operation),
		}, nil
	case "apply_patch":
		return &observation.ActivityPresentation{
			Label:    "apply_patch",
			Renderer: observation.ActivityRendererPatch,
			Chips:    fileActivityChips(payload),
			Payload:  mapWithOperation(payload, "apply_patch"),
		}, nil
	case "web.search":
		return &observation.ActivityPresentation{
			Label:    activityPresentationLabel(anyToString(payload["query"])),
			Renderer: observation.ActivityRendererWebSearch,
			Chips:    webSearchActivityChips(payload),
			Payload:  payload,
		}, nil
	case "write_todos":
		return &observation.ActivityPresentation{
			Label:    "Update todos",
			Renderer: observation.ActivityRendererTodos,
			Chips:    todoActivityChips(payload),
			Payload:  payload,
		}, nil
	default:
		if toolName == "" {
			return nil, nil
		}
		return &observation.ActivityPresentation{
			Label:    activityPresentationLabel(toolName),
			Renderer: observation.ActivityRendererStructured,
			Payload:  payload,
		}, nil
	}
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

func activityPresentationPayloadFromToolResultData(r *run, toolName string, data any) (map[string]any, bool) {
	payload, truncated := activityPayloadFromResultData(data)
	var shaped map[string]any
	switch strings.TrimSpace(toolName) {
	case "file.read":
		shaped = fileReadActivityPayload(r, payload)
	case "file.edit", "file.write":
		shaped = fileMutationActivityPayload(r, payload)
	case "apply_patch":
		shaped = applyPatchActivityPayload(r, payload)
	default:
		shaped = payload
	}
	safe, shapedTruncated := contractSafePayloadMap(shaped, 0)
	return safe, truncated || shapedTruncated
}

func fileReadActivityPayload(r *run, payload map[string]any) map[string]any {
	out := map[string]any{}
	displayName := firstNonEmptyString(anyToString(payload["display_name"]), displayNameForFilePath(anyToString(payload["file_path"])))
	if displayName != "" {
		out["display_name"] = displayName
	}
	actionID := registerFlowerActivityFileAction(r, displayName, anyToString(payload["file_path"]), activityDirectoryPath(anyToString(payload["file_path"])))
	if actionID != "" {
		out["file_action_id"] = actionID
	}
	for _, key := range []string{"content", "line_offset", "line_count", "total_lines", "truncated"} {
		if value, ok := payload[key]; ok {
			out[key] = value
		}
	}
	return out
}

func fileMutationActivityPayload(r *run, payload map[string]any) map[string]any {
	return fileMutationActivityPayloadFromRecord(r, payload)
}

func applyPatchActivityPayload(r *run, payload map[string]any) map[string]any {
	out := map[string]any{}
	for _, key := range []string{"files_changed", "hunks", "additions", "deletions", "input_format", "normalized_format"} {
		if value, ok := payload[key]; ok {
			out[key] = value
		}
	}
	mutations := toAnySlice(payload["mutations"])
	if len(mutations) == 0 {
		return out
	}
	outMutations := make([]any, 0, len(mutations))
	for _, mutation := range mutations {
		record, ok := mutation.(map[string]any)
		if !ok {
			continue
		}
		outMutations = append(outMutations, fileMutationActivityPayloadFromRecord(r, record))
	}
	if len(outMutations) > 0 {
		out["mutations"] = outMutations
	}
	return out
}

func fileMutationActivityPayloadFromRecord(r *run, payload map[string]any) map[string]any {
	out := map[string]any{}
	filePath := anyToString(payload["file_path"])
	oldPath := anyToString(payload["old_path"])
	newPath := anyToString(payload["new_path"])
	changeType := anyToString(payload["change_type"])
	displayName := firstNonEmptyString(anyToString(payload["display_name"]), displayNameForFilePath(firstNonEmptyString(newPath, filePath, oldPath)))
	if displayName != "" {
		out["display_name"] = displayName
	}
	previewPath := mutationActionPath(filePath, oldPath, newPath, changeType)
	actionID := registerFlowerActivityFileAction(r, displayName, previewPath, mutationDirectoryPath(previewPath, oldPath, newPath))
	if actionID != "" {
		out["file_action_id"] = actionID
	}
	for _, key := range []string{"change_type", "additions", "deletions", "unified_diff", "diff_unavailable_reason", "truncated"} {
		if value, ok := payload[key]; ok {
			out[key] = value
		}
	}
	return out
}

func activityDirectoryPath(filePath string) string {
	filePath = strings.TrimSpace(filePath)
	if filePath == "" || filePath == "/dev/null" {
		return ""
	}
	return filepath.Dir(filePath)
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

func terminalActivityChips(payload map[string]any) []observation.ActivityChip {
	chips := []observation.ActivityChip{}
	if exit := activityScalarString(payload["exit_code"]); strings.TrimSpace(exit) != "" {
		tone := "neutral"
		if strings.TrimSpace(exit) != "0" {
			tone = "danger"
		}
		chips = append(chips, observation.ActivityChip{Kind: "exit_code", Label: "exit", Value: exit, Tone: tone})
	}
	if duration := activityScalarString(payload["duration_ms"]); strings.TrimSpace(duration) != "" {
		chips = append(chips, observation.ActivityChip{Kind: "duration", Label: "duration", Value: duration + " ms", Tone: "neutral"})
	}
	if readBoolField(payload, "truncated") {
		chips = append(chips, observation.ActivityChip{Kind: "truncated", Label: "truncated", Tone: "warning"})
	}
	return chips
}

func fileActivityChips(payload map[string]any) []observation.ActivityChip {
	chips := []observation.ActivityChip{}
	if value := activityScalarString(payload["change_type"]); strings.TrimSpace(value) != "" {
		chips = append(chips, observation.ActivityChip{Kind: "change", Label: strings.TrimSpace(value), Tone: "neutral"})
	}
	if value := activityScalarString(payload["line_count"]); strings.TrimSpace(value) != "" {
		chips = append(chips, observation.ActivityChip{Kind: "lines", Label: "lines", Value: value, Tone: "neutral"})
	}
	if readBoolField(payload, "truncated") {
		chips = append(chips, observation.ActivityChip{Kind: "truncated", Label: "truncated", Tone: "warning"})
	}
	return chips
}

func webSearchActivityChips(payload map[string]any) []observation.ActivityChip {
	count := len(toAnySlice(payload["sources"]))
	if count == 0 {
		count = len(toAnySlice(payload["results"]))
	}
	if count <= 0 {
		return nil
	}
	return []observation.ActivityChip{{Kind: "results", Label: "results", Value: fmt.Sprintf("%d", count), Tone: "neutral"}}
}

func todoActivityChips(payload map[string]any) []observation.ActivityChip {
	counts := map[string]int{}
	for _, item := range toAnySlice(payload["todos"]) {
		record, _ := item.(map[string]any)
		status := strings.TrimSpace(anyToString(record["status"]))
		if status != "" {
			counts[status]++
		}
	}
	chips := []observation.ActivityChip{}
	for _, status := range []string{"pending", "in_progress", "completed", "cancelled"} {
		if count := counts[status]; count > 0 {
			chips = append(chips, observation.ActivityChip{Kind: status, Label: status, Value: fmt.Sprintf("%d", count), Tone: "neutral"})
		}
	}
	return chips
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
		defs = append(defs, fltools.ToolDefinition{
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
		})
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
