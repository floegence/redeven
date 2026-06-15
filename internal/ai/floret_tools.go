package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"sync"

	"github.com/floegence/floret/observation"
	fltools "github.com/floegence/floret/tools"
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
	hostContext := floretHostLabelsForRun(r)
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
				call.Args = applyFloretHostContextToToolArgs(call.Name, call.Args, hostContext)
				handler := &builtInToolHandler{r: r, toolName: call.Name}
				result, err := handler.Execute(ctx, call)
				if err != nil {
					return fltools.Result{}, err
				}
				if state != nil {
					state.updateFromToolResult(call, result, inv.Step)
				}
				return floretToolResultFromFlower(r, result), nil
			},
		)
		if err := registry.Register(tool); err != nil {
			return nil, err
		}
	}
	return registry, nil
}

func floretHostLabelsForRun(r *run) map[string]string {
	host := map[string]string{
		"endpoint_id": strings.TrimSpace(r.endpointID),
		"engine":      "redeven",
	}
	if policy := normalizeToolTargetPolicy(r.toolTargetPolicy); policy.requiresExplicitTarget() {
		if targetID := strings.TrimSpace(policy.DefaultTargetID); targetID != "" {
			host["target_id"] = targetID
			host["current_target_id"] = targetID
			host["primary_target_id"] = targetID
		}
	}
	return host
}

func applyFloretHostContextToToolArgs(toolName string, args map[string]any, hostContext map[string]string) map[string]any {
	if !toolRequiresTarget(toolName) {
		return args
	}
	if strings.TrimSpace(targetIDFromToolArgs(args)) != "" {
		return args
	}
	targetID := firstNonEmptyString(hostContext["target_id"], hostContext["current_target_id"], hostContext["primary_target_id"])
	if targetID == "" {
		return args
	}
	out := cloneAnyMap(args)
	out["target_id"] = targetID
	return out
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

func floretToolDefinition(def ToolDef) (fltools.Definition, error) {
	inputSchema := map[string]any{"type": "object", "additionalProperties": true}
	if len(def.InputSchema) > 0 {
		var parsed map[string]any
		if err := json.Unmarshal(def.InputSchema, &parsed); err != nil || parsed == nil {
			return fltools.Definition{}, fmt.Errorf("invalid input schema for Floret tool %s", strings.TrimSpace(def.Name))
		}
		inputSchema = parsed
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
			"source":              strings.TrimSpace(def.Source),
			"namespace":           strings.TrimSpace(def.Namespace),
			"flower_policy_owner": "internal/ai.run.handleToolCall",
		},
	}, nil
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

func floretToolResultFromFlower(r *run, result ToolResult) fltools.Result {
	structured := map[string]any{
		"status":      strings.TrimSpace(result.Status),
		"summary":     strings.TrimSpace(result.Summary),
		"details":     strings.TrimSpace(result.Details),
		"truncated":   result.Truncated,
		"content_ref": strings.TrimSpace(result.ContentRef),
	}
	if result.Data != nil {
		structured["data"] = result.Data
	}
	if result.Error != nil {
		result.Error.Normalize()
		structured["error"] = result.Error
	}
	text, _ := json.Marshal(structured)
	return fltools.Result{
		CallID:     strings.TrimSpace(result.ToolID),
		Name:       strings.TrimSpace(result.ToolName),
		Text:       string(text),
		Structured: structured,
		Activity:   floretActivityForToolResult(r, result),
		IsError:    strings.TrimSpace(result.Status) != "" && strings.TrimSpace(result.Status) != toolResultStatusSuccess,
	}
}

func floretActivityForToolCall(toolName string, args map[string]any) *observation.ActivityPresentation {
	toolName = strings.TrimSpace(toolName)
	payload := activityCallPayloadForTool(toolName, args)
	switch toolName {
	case "terminal.exec":
		command := strings.TrimSpace(anyToString(args["command"]))
		if command == "" {
			command = "terminal.exec"
		}
		return &observation.ActivityPresentation{
			Label:       command,
			Description: strings.TrimSpace(anyToString(args["description"])),
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
		return &observation.ActivityPresentation{
			Label:    firstNonEmptyString(displayName, "file.read"),
			Renderer: observation.ActivityRendererFile,
			Payload:  mapWithOperation(payload, "read"),
		}
	case "file.edit":
		path := strings.TrimSpace(anyToString(args["file_path"]))
		displayName := displayNameForFilePath(path)
		if displayName != "" {
			payload["display_name"] = displayName
		}
		return &observation.ActivityPresentation{
			Label:    firstNonEmptyString(displayName, "file.edit"),
			Renderer: observation.ActivityRendererFile,
			Payload:  mapWithOperation(payload, "edit"),
		}
	case "file.write":
		path := strings.TrimSpace(anyToString(args["file_path"]))
		displayName := displayNameForFilePath(path)
		if displayName != "" {
			payload["display_name"] = displayName
		}
		return &observation.ActivityPresentation{
			Label:    firstNonEmptyString(displayName, "file.write"),
			Renderer: observation.ActivityRendererFile,
			Payload:  mapWithOperation(payload, "write"),
		}
	case "apply_patch":
		return &observation.ActivityPresentation{
			Label:    "apply_patch",
			Renderer: observation.ActivityRendererPatch,
			Payload:  mapWithOperation(payload, "apply_patch"),
		}
	case "web.search":
		query := strings.TrimSpace(anyToString(args["query"]))
		return &observation.ActivityPresentation{
			Label:    firstNonEmptyString(query, "web.search"),
			Renderer: observation.ActivityRendererWebSearch,
			Payload:  payload,
		}
	case "knowledge.search":
		query := strings.TrimSpace(anyToString(args["query"]))
		return &observation.ActivityPresentation{
			Label:    firstNonEmptyString(query, "knowledge.search"),
			Renderer: observation.ActivityRendererStructured,
			Payload:  mapWithOperation(payload, "knowledge.search"),
		}
	case "write_todos":
		return &observation.ActivityPresentation{
			Label:    "Update todos",
			Renderer: observation.ActivityRendererTodos,
			Payload:  payload,
		}
	case "use_skill":
		name := strings.TrimSpace(anyToString(args["name"]))
		return &observation.ActivityPresentation{
			Label:    firstNonEmptyString(name, "use_skill"),
			Renderer: observation.ActivityRendererStructured,
			Payload:  mapWithOperation(payload, "use_skill"),
		}
	case "subagents":
		action := strings.TrimSpace(anyToString(args["action"]))
		return &observation.ActivityPresentation{
			Label:    firstNonEmptyString(action, "subagents"),
			Renderer: observation.ActivityRendererStructured,
			Payload:  mapWithOperation(payload, "subagents"),
		}
	default:
		if toolName == "" {
			return nil
		}
		return &observation.ActivityPresentation{
			Label:    toolName,
			Renderer: observation.ActivityRendererStructured,
			Payload:  payload,
		}
	}
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
	case "web.search", "knowledge.search":
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

func floretActivityForToolResult(r *run, result ToolResult) *observation.ActivityPresentation {
	toolName := strings.TrimSpace(result.ToolName)
	payload := activityPresentationPayloadFromToolResultData(r, toolName, result.Data)
	payload["status"] = strings.TrimSpace(result.Status)
	payload["summary"] = strings.TrimSpace(result.Summary)
	payload["details"] = strings.TrimSpace(result.Details)
	if result.Truncated || readBoolField(payload, "truncated") {
		payload["truncated"] = true
	}
	if result.ContentRef != "" {
		payload["content_ref"] = strings.TrimSpace(result.ContentRef)
	}
	if result.Error != nil {
		payload["error"] = result.Error
	}
	switch toolName {
	case "terminal.exec":
		return &observation.ActivityPresentation{
			Label:    strings.TrimSpace(anyToString(payload["command"])),
			Renderer: observation.ActivityRendererTerminal,
			Chips:    terminalActivityChips(payload),
			Payload:  payload,
		}
	case "file.read":
		displayName := firstNonEmptyString(anyToString(payload["display_name"]), "file.read")
		return &observation.ActivityPresentation{
			Label:    displayName,
			Renderer: observation.ActivityRendererFile,
			Chips:    fileActivityChips(payload),
			Payload:  mapWithOperation(payload, "read"),
		}
	case "file.edit", "file.write":
		operation := "edit"
		if toolName == "file.write" {
			operation = "write"
		}
		displayName := firstNonEmptyString(anyToString(payload["display_name"]), toolName)
		return &observation.ActivityPresentation{
			Label:    displayName,
			Renderer: observation.ActivityRendererFile,
			Chips:    fileActivityChips(payload),
			Payload:  mapWithOperation(payload, operation),
		}
	case "apply_patch":
		return &observation.ActivityPresentation{
			Label:    "apply_patch",
			Renderer: observation.ActivityRendererPatch,
			Chips:    fileActivityChips(payload),
			Payload:  mapWithOperation(payload, "apply_patch"),
		}
	case "web.search":
		return &observation.ActivityPresentation{
			Label:    strings.TrimSpace(anyToString(payload["query"])),
			Renderer: observation.ActivityRendererWebSearch,
			Chips:    webSearchActivityChips(payload),
			Payload:  payload,
		}
	case "write_todos":
		return &observation.ActivityPresentation{
			Label:    "Update todos",
			Renderer: observation.ActivityRendererTodos,
			Chips:    todoActivityChips(payload),
			Payload:  payload,
		}
	default:
		if toolName == "" {
			return nil
		}
		return &observation.ActivityPresentation{
			Label:    toolName,
			Renderer: observation.ActivityRendererStructured,
			Payload:  payload,
		}
	}
}

func activityPayloadFromResultData(data any) map[string]any {
	if data == nil {
		return map[string]any{}
	}
	if record, ok := data.(map[string]any); ok {
		return cloneAnyMap(record)
	}
	raw, err := json.Marshal(data)
	if err != nil || len(raw) == 0 {
		return map[string]any{"value": strings.TrimSpace(fmt.Sprint(data))}
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err == nil && out != nil {
		return out
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return map[string]any{"value": string(raw)}
	}
	return map[string]any{"value": value}
}

func activityPresentationPayloadFromToolResultData(r *run, toolName string, data any) map[string]any {
	payload := activityPayloadFromResultData(data)
	switch strings.TrimSpace(toolName) {
	case "file.read":
		return fileReadActivityPayload(r, payload)
	case "file.edit", "file.write":
		return fileMutationActivityPayload(r, payload)
	case "apply_patch":
		return applyPatchActivityPayload(r, payload)
	default:
		return payload
	}
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
