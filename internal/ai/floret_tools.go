package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"sync"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	fltools "github.com/floegence/floret/tools"
	"github.com/floegence/redeven/internal/ai/threadstore"
	aitools "github.com/floegence/redeven/internal/ai/tools"
)

type floretToolRuntimeState struct {
	mu    sync.Mutex
	state runtimeState
}

const (
	subagentToolHostContextAgentTypeKey        = "subagent_agent_type"
	subagentToolHostContextChildRunIDKey       = "child_run_id"
	subagentToolHostContextChildThreadIDKey    = "child_thread_id"
	subagentToolHostContextParentPermissionKey = "subagent_parent_permission"
	subagentToolHostContextSubagentIDKey       = "subagent_id"
)

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
	if result.Pending != nil {
		return
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
		toolDef, err := floretToolDefinition(r, def)
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
				execRun, err := floretInvocationRunContext(r, inv)
				if err != nil {
					return fltools.Result{}, err
				}
				ctx = contextWithFloretToolExecutionAuthorization(ctx, call.ID, call.Name)
				handler := &builtInToolHandler{
					r:        execRun,
					toolName: call.Name,
					activityUpdater: func(activity *observation.ActivityPresentation, metadata map[string]any) {
						inv.UpdateActivity(fltools.ActivityUpdate{
							Activity: activity,
							Metadata: metadata,
						})
					},
				}
				result, err := handler.Execute(ctx, call)
				if err != nil {
					return fltools.Result{}, err
				}
				if result.Pending == nil {
					if _, err := validateToolResultStatus(result.Status); err != nil {
						return fltools.Result{}, err
					}
				}
				if state != nil {
					state.updateFromToolResult(call, result, inv.Step)
				}
				toolResult, err := floretToolResultFromFlower(execRun, result)
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

func floretInvocationRunContext(base *run, inv fltools.Invocation[map[string]any]) (*run, error) {
	if base == nil {
		return nil, errors.New("missing floret invocation run context")
	}
	return floretRunContextForIDs(base, inv.RunID, inv.ThreadID, inv.TurnID, inv.HostContext)
}

func floretApprovalRunContext(base *run, req fltools.ApprovalRequest) (*run, error) {
	if base == nil {
		return nil, errors.New("missing floret approval run context")
	}
	threadID := strings.TrimSpace(req.HostContext[subagentToolHostContextChildThreadIDKey])
	if threadID == "" {
		threadID = strings.TrimSpace(req.HostContext[subagentToolHostContextSubagentIDKey])
	}
	if threadID == "" {
		return floretRunContextForIDs(base, req.RunID, req.ThreadID, req.TurnID, req.HostContext)
	}
	runID := strings.TrimSpace(req.HostContext[subagentToolHostContextChildRunIDKey])
	return floretRunContextForIDs(base, runID, req.ThreadID, req.TurnID, req.HostContext)
}

func floretRunContextForIDs(base *run, rawRunID string, rawThreadID string, rawTurnID string, hostContext map[string]string) (*run, error) {
	if base == nil {
		return nil, errors.New("missing floret run context")
	}
	runID := strings.TrimSpace(rawRunID)
	threadID := strings.TrimSpace(rawThreadID)
	turnID := strings.TrimSpace(rawTurnID)
	settlementRunID := runID
	settlementThreadID := threadID
	settlementTurnID := turnID
	childThreadID := strings.TrimSpace(hostContext[subagentToolHostContextChildThreadIDKey])
	if childThreadID == "" {
		childThreadID = strings.TrimSpace(hostContext[subagentToolHostContextSubagentIDKey])
	}
	childRunID := strings.TrimSpace(hostContext[subagentToolHostContextChildRunIDKey])
	if childThreadID == "" && childRunID == "" {
		if err := requireFloretRunIdentity("parent tool invocation", runID, threadID, turnID, strings.TrimSpace(base.id), strings.TrimSpace(base.threadID), strings.TrimSpace(base.messageID)); err != nil {
			return nil, err
		}
		return base, nil
	}
	if childThreadID == "" || childRunID == "" {
		return nil, errors.New("floret child tool invocation missing explicit child identity")
	}
	if childRunID == childThreadID {
		return nil, errors.New("floret child tool invocation child run aliases child thread")
	}
	if parentRunID := strings.TrimSpace(base.id); parentRunID != "" && childRunID == parentRunID && strings.TrimSpace(base.threadID) != childThreadID {
		return nil, errors.New("floret child tool invocation child run aliases parent run")
	}
	if threadID == "" || threadID != childThreadID {
		return nil, floretIdentityMismatchError("child tool invocation", "thread", threadID, childThreadID)
	}
	if turnID == "" {
		return nil, errors.New("floret child tool invocation missing turn id")
	}
	runID = childRunID
	threadID = childThreadID
	child := newRun(runOptions{
		Log:                   base.log,
		StateDir:              base.stateDir,
		AgentHomeDir:          base.agentHomeDir,
		WorkingDir:            base.workingDir,
		FilesystemScope:       base.scope,
		Shell:                 base.shell,
		Service:               base.service,
		AIConfig:              base.cfg,
		SessionMeta:           base.sessionMeta,
		ResolveProviderKey:    base.resolveProviderKey,
		ResolveWebSearchKey:   base.resolveWebSearchKey,
		DesktopModelSource:    base.desktopModelSource,
		RunID:                 runID,
		ChannelID:             base.channelID,
		EndpointID:            base.endpointID,
		ThreadID:              threadID,
		UserPublicID:          base.userPublicID,
		MessageID:             turnID,
		UploadsDir:            base.uploadsDir,
		ThreadsDB:             base.threadsDB,
		PersistOpTimeout:      base.persistOpTimeout,
		MaxWallTime:           base.maxWallTime,
		IdleTimeout:           base.idleTimeout,
		ToolApprovalTimeout:   base.toolApprovalTO,
		SubagentDepth:         base.subagentDepth,
		AllowSubagentDelegate: base.allowSubagentDelegate,
		ToolAllowlist:         mapKeys(base.toolAllowlist),
		NoUserInteraction:     base.noUserInteraction,
		WebSearchToolEnabled:  base.webSearchToolEnabled,
		WebSearchMode:         base.webSearchMode,
		SkillManager:          base.skillManager,
		ToolTargetPolicy:      base.toolTargetPolicy,
		TargetToolExecutor:    base.targetToolExecutor,
	})
	child.permissionType = base.permissionType
	child.settlementThreadID = settlementThreadID
	child.settlementRunID = settlementRunID
	child.settlementTurnID = settlementTurnID
	child.allowDelegatedApproval = base.allowDelegatedApproval
	child.delegatedApprovalParent = base.delegatedApprovalParent
	if permission := strings.TrimSpace(hostContext[subagentToolHostContextParentPermissionKey]); permission != "" {
		if normalized, err := normalizePermissionType(permission, child.permissionType); err == nil {
			child.permissionType = normalized
		}
	}
	child.currentModelID = base.currentModelID
	child.bindStoredChildPermissionSnapshot(threadID, runID)
	return child, nil
}

func requireFloretRunIdentity(label string, runID string, threadID string, turnID string, wantRunID string, wantThreadID string, wantTurnID string) error {
	if runID == "" {
		return fmt.Errorf("floret %s missing run id", label)
	}
	if threadID == "" {
		return fmt.Errorf("floret %s missing thread id", label)
	}
	if turnID == "" {
		return fmt.Errorf("floret %s missing turn id", label)
	}
	if runID != wantRunID {
		return floretIdentityMismatchError(label, "run", runID, wantRunID)
	}
	if threadID != wantThreadID {
		return floretIdentityMismatchError(label, "thread", threadID, wantThreadID)
	}
	if turnID != wantTurnID {
		return floretIdentityMismatchError(label, "turn", turnID, wantTurnID)
	}
	return nil
}

func floretIdentityMismatchError(label string, field string, got string, want string) error {
	return fmt.Errorf("floret %s %s identity mismatch: got %q, want %q", label, field, got, want)
}

func (r *run) bindStoredChildPermissionSnapshot(childThreadID string, childRunID string) {
	if r == nil || r.subagentDepth <= 0 || !r.noUserInteraction {
		return
	}
	childThreadID = strings.TrimSpace(childThreadID)
	childRunID = strings.TrimSpace(childRunID)
	if childThreadID == "" || childRunID == "" {
		r.permissionSnapshot = denyAllChildPermissionSnapshot(r.permissionType)
		r.toolAllowlist = map[string]struct{}{}
		return
	}
	if r.threadsDB == nil {
		r.permissionSnapshot = denyAllChildPermissionSnapshot(r.permissionType)
		r.toolAllowlist = map[string]struct{}{}
		return
	}
	ctx, cancel := persistContextForRun(r)
	rec, ok, err := r.threadsDB.GetFinalizedChildPermissionSnapshot(ctx, strings.TrimSpace(r.endpointID), childThreadID, childRunID)
	cancel()
	if err != nil || !ok {
		r.permissionSnapshot = denyAllChildPermissionSnapshot(r.permissionType)
		r.toolAllowlist = map[string]struct{}{}
		return
	}
	snapshot, err := decodePermissionSnapshot(rec.SnapshotJSON)
	if err != nil {
		r.permissionSnapshot = denyAllChildPermissionSnapshot(r.permissionType)
		r.toolAllowlist = map[string]struct{}{}
		return
	}
	if strings.TrimSpace(snapshot.SnapshotID) == "" {
		snapshot.SnapshotID = strings.TrimSpace(rec.ChildSnapshotID)
	}
	if strings.TrimSpace(snapshot.SnapshotHash) == "" {
		snapshot.SnapshotHash = strings.TrimSpace(rec.SnapshotHash)
	}
	if strings.TrimSpace(snapshot.RegistryHash) == "" {
		snapshot.RegistryHash = strings.TrimSpace(rec.RegistryHash)
	}
	if strings.TrimSpace(snapshot.SchemaHash) == "" {
		snapshot.SchemaHash = strings.TrimSpace(rec.SchemaHash)
	}
	if strings.TrimSpace(snapshot.PresentationHash) == "" {
		snapshot.PresentationHash = strings.TrimSpace(rec.PresentationHash)
	}
	if !permissionSnapshotActive(snapshot) {
		r.permissionSnapshot = denyAllChildPermissionSnapshot(r.permissionType)
		r.toolAllowlist = map[string]struct{}{}
		return
	}
	ctx, cancel = persistContextForRun(r)
	if err := r.validateStoredChildPermissionSnapshot(ctx, rec, snapshot); err != nil {
		cancel()
		r.permissionSnapshot = denyAllChildPermissionSnapshot(r.permissionType)
		r.toolAllowlist = map[string]struct{}{}
		return
	}
	cancel()
	r.permissionSnapshot = snapshot
	if snapshot.PermissionType != "" {
		r.permissionType = snapshot.PermissionType
	}
	r.toolAllowlist = stringSet(snapshot.VisibleToolNames...)
}

func (r *run) validateStoredChildPermissionSnapshot(ctx context.Context, rec threadstore.ChildPermissionSnapshotRecord, snapshot PermissionSnapshot) error {
	if r == nil || r.threadsDB == nil {
		return errors.New("missing child permission snapshot store")
	}
	if strings.TrimSpace(rec.ChildSnapshotID) == "" || strings.TrimSpace(rec.ParentSnapshotID) == "" || strings.TrimSpace(rec.SnapshotHash) == "" {
		return errors.New("incomplete child permission snapshot identity")
	}
	if err := validateStoredChildPermissionSnapshotIdentity(rec); err != nil {
		return err
	}
	if strings.TrimSpace(snapshot.SnapshotID) != strings.TrimSpace(rec.ChildSnapshotID) {
		return errors.New("child permission snapshot id mismatch")
	}
	if got := permissionSnapshotHash(snapshot); got != strings.TrimSpace(rec.SnapshotHash) || strings.TrimSpace(snapshot.SnapshotHash) != got {
		return errors.New("child permission snapshot hash mismatch")
	}
	if err := validateStoredPermissionSnapshotHashes("child", rec.RegistryHash, rec.SchemaHash, rec.PresentationHash, snapshot); err != nil {
		return err
	}
	if err := r.validateCurrentChildPermissionSnapshotCompatibility(snapshot); err != nil {
		return err
	}
	parentRec, ok, err := r.threadsDB.GetPermissionSnapshot(ctx, strings.TrimSpace(r.endpointID), strings.TrimSpace(rec.ParentSnapshotID))
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("parent permission snapshot missing")
	}
	parent, err := decodePermissionSnapshot(parentRec.SnapshotJSON)
	if err != nil {
		return err
	}
	if strings.TrimSpace(parent.SnapshotID) == "" {
		parent.SnapshotID = strings.TrimSpace(parentRec.SnapshotID)
	}
	if strings.TrimSpace(parent.SnapshotHash) == "" {
		parent.SnapshotHash = strings.TrimSpace(parentRec.SnapshotHash)
	}
	if strings.TrimSpace(parent.SnapshotID) != strings.TrimSpace(parentRec.SnapshotID) {
		return errors.New("parent permission snapshot id mismatch")
	}
	if strings.TrimSpace(parentRec.OwnerThreadID) == "" || strings.TrimSpace(parentRec.OwnerThreadID) != strings.TrimSpace(rec.ParentThreadID) {
		return errors.New("child permission snapshot parent thread owner mismatch")
	}
	if strings.TrimSpace(parentRec.OwnerRunID) == "" || strings.TrimSpace(parentRec.OwnerRunID) != strings.TrimSpace(rec.ParentRunID) {
		return errors.New("child permission snapshot parent run owner mismatch")
	}
	if got := permissionSnapshotHash(parent); got != strings.TrimSpace(parentRec.SnapshotHash) || strings.TrimSpace(parent.SnapshotHash) != got {
		return errors.New("parent permission snapshot hash mismatch")
	}
	if err := validateStoredPermissionSnapshotHashes("parent", parentRec.RegistryHash, parentRec.SchemaHash, parentRec.PresentationHash, parent); err != nil {
		return err
	}
	return validateChildPermissionSnapshotSubset(parent, snapshot)
}

func validateStoredChildPermissionSnapshotIdentity(rec threadstore.ChildPermissionSnapshotRecord) error {
	childRunID := strings.TrimSpace(rec.ChildRunID)
	childThreadID := strings.TrimSpace(rec.ChildThreadID)
	parentRunID := strings.TrimSpace(rec.ParentRunID)
	if childRunID == "" {
		return errors.New("child permission snapshot missing child run identity")
	}
	if childRunID == childThreadID {
		return errors.New("child permission snapshot child run identity aliases child thread")
	}
	if parentRunID != "" && childRunID == parentRunID {
		return errors.New("child permission snapshot child run identity aliases parent run")
	}
	return nil
}

func validateStoredPermissionSnapshotHashes(label string, registryHash string, schemaHash string, presentationHash string, snapshot PermissionSnapshot) error {
	if strings.TrimSpace(snapshot.RegistryHash) != strings.TrimSpace(registryHash) {
		return fmt.Errorf("%s permission snapshot registry hash mismatch", label)
	}
	if strings.TrimSpace(snapshot.SchemaHash) != strings.TrimSpace(schemaHash) {
		return fmt.Errorf("%s permission snapshot schema hash mismatch", label)
	}
	if strings.TrimSpace(snapshot.PresentationHash) != strings.TrimSpace(presentationHash) {
		return fmt.Errorf("%s permission snapshot presentation hash mismatch", label)
	}
	return nil
}

func (r *run) validateCurrentChildPermissionSnapshotCompatibility(snapshot PermissionSnapshot) error {
	if r == nil {
		return errors.New("missing child permission snapshot runtime")
	}
	registry := NewInMemoryToolRegistry()
	if err := registerBuiltInTools(registry, r); err != nil {
		return err
	}
	allTools := registry.Snapshot()
	floretTools, err := requireToolDefsByName(allTools, snapshot.FloretToolNames)
	if err != nil {
		return err
	}
	presentationTools, err := requireToolDefsByName(append(append([]ToolDef{}, allTools...), builtInControlSignalDefinitions()...), snapshot.PromptCapabilityNames)
	if err != nil {
		return err
	}
	registryHash := stableToolRegistryHash(floretTools)
	if snapshot.Version == permissionSnapshotVersionLegacy {
		registryHash = stableToolRegistryHashV1(floretTools, snapshot.legacyConcurrency)
	}
	if registryHash != strings.TrimSpace(snapshot.RegistryHash) {
		return errors.New("child permission snapshot registry is incompatible with current tools")
	}
	if got := stableToolSchemaHash(floretTools); got != strings.TrimSpace(snapshot.SchemaHash) {
		return errors.New("child permission snapshot schema is incompatible with current tools")
	}
	if got := stableToolPresentationHash(presentationTools); got != strings.TrimSpace(snapshot.PresentationHash) {
		return errors.New("child permission snapshot presentation is incompatible with current tools")
	}
	return nil
}

func requireToolDefsByName(all []ToolDef, names []string) ([]ToolDef, error) {
	byName := make(map[string]ToolDef, len(all))
	for _, def := range all {
		name := strings.TrimSpace(def.Name)
		if name != "" {
			byName[name] = def
		}
	}
	out := make([]ToolDef, 0, len(names))
	seen := map[string]struct{}{}
	for _, rawName := range names {
		name := strings.TrimSpace(rawName)
		if name == "" {
			return nil, errors.New("permission snapshot has empty tool name")
		}
		if _, ok := seen[name]; ok {
			return nil, fmt.Errorf("permission snapshot has duplicate tool %q", name)
		}
		def, ok := byName[name]
		if !ok {
			return nil, fmt.Errorf("permission snapshot tool %q is not registered", name)
		}
		seen[name] = struct{}{}
		out = append(out, def)
	}
	return out, nil
}

func denyAllChildPermissionSnapshot(permissionType FlowerPermissionType) PermissionSnapshot {
	if permissionType == "" {
		permissionType = FlowerPermissionApprovalRequired
	}
	return PermissionSnapshot{
		SnapshotID:     "missing_child_permission_snapshot",
		PermissionType: permissionType,
		ToolPolicies:   map[string]ToolPermissionPolicy{},
	}
}

func mapKeys(in map[string]struct{}) []string {
	if len(in) == 0 {
		return nil
	}
	out := make([]string, 0, len(in))
	for key := range in {
		key = strings.TrimSpace(key)
		if key != "" {
			out = append(out, key)
		}
	}
	return out
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
	okfActivityPayloadMaxDepth           = 8
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
	status := strings.TrimSpace(result.Status)
	if result.Pending != nil {
		if status == "" {
			status = "pending"
		}
	} else {
		var err error
		status, err = validateToolResultStatus(result.Status)
		if err != nil {
			return nil, err
		}
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

func floretToolDefinition(r *run, def ToolDef) (fltools.Definition, error) {
	def = normalizeToolPermissionMetadata(def)
	toolName := strings.TrimSpace(def.Name)
	inputSchema := map[string]any{"type": "object", "additionalProperties": true}
	if len(def.InputSchema) > 0 {
		var parsed map[string]any
		if err := json.Unmarshal(def.InputSchema, &parsed); err != nil || parsed == nil {
			return fltools.Definition{}, fmt.Errorf("invalid input schema for Floret tool %s", toolName)
		}
		inputSchema = stripRedevenTargetFieldsFromFloretToolSchema(toolName, parsed)
	}
	effects := floretToolEffects(def)
	readOnly := !def.Mutating && !floretToolOpenWorld(def) && toolName != "terminal.exec"
	permissionType := FlowerPermissionApprovalRequired
	if r != nil && r.permissionType != "" {
		permissionType = r.permissionType
	}
	permission := floretToolPermission(permissionType, def)
	annotations := map[string]any{
		"source":    strings.TrimSpace(def.Source),
		"namespace": strings.TrimSpace(def.Namespace),
	}
	if toolName == "terminal.read" {
		annotations[fltools.AnnotationRepeatPolicy] = fltools.RepeatPolicyPolling
		annotations[fltools.AnnotationRepeatIdentityIgnoredArguments] = []string{"description"}
	}
	return fltools.Definition{
		Name:        toolName,
		Title:       toolName,
		Description: strings.TrimSpace(def.Description),
		InputSchema: inputSchema,
		Effects:     effects,
		ReadOnly:    readOnly,
		Destructive: def.Mutating,
		OpenWorld:   floretToolOpenWorld(def),
		Permission:  permission,
		PermissionFor: func(req fltools.PermissionRequest) (fltools.PermissionSpec, error) {
			args, _ := req.Args.(map[string]any)
			currentPermissionType := permissionType
			if r != nil && r.permissionType != "" {
				currentPermissionType = r.permissionType
			}
			if raw := strings.TrimSpace(req.HostContext[subagentToolHostContextParentPermissionKey]); raw != "" {
				if normalized, err := normalizePermissionType(raw, currentPermissionType); err == nil {
					currentPermissionType = normalized
				}
			}
			return floretPermissionForInvocation(currentPermissionType, def, cloneAnyMap(args)), nil
		},
		Activity: func(inv fltools.Invocation[any]) (*observation.ActivityPresentation, error) {
			args, _ := inv.Args.(map[string]any)
			if toolName == "terminal.exec" {
				args = normalizeTerminalExecArgs(args)
			}
			return floretActivityForToolCall(toolName, args), nil
		},
		Annotations: annotations,
	}, nil
}

func floretToolPermission(permissionType FlowerPermissionType, def ToolDef) fltools.PermissionSpec {
	name := strings.TrimSpace(def.Name)
	resourceKinds := floretToolResourceKinds(name)
	mode := floretPermissionMode(permissionDecisionForTool(permissionType, def))
	if floretToolOpenWorld(def) && mode == fltools.PermissionAllow {
		mode = fltools.PermissionAsk
	}
	return fltools.PermissionSpec{Mode: mode, ResourceKinds: resourceKinds}
}

func floretPermissionForInvocation(permissionType FlowerPermissionType, def ToolDef, args map[string]any) fltools.PermissionSpec {
	toolName := strings.TrimSpace(def.Name)
	resourceKinds := floretToolResourceKinds(toolName)
	decision := permissionDecisionForTool(permissionType, def)
	return fltools.PermissionSpec{Mode: floretPermissionMode(decision), ResourceKinds: resourceKinds}
}

func floretPermissionMode(decision ApprovalDecisionKind) fltools.PermissionMode {
	switch decision {
	case ApprovalDecisionAllow:
		return fltools.PermissionAllow
	case ApprovalDecisionAsk:
		return fltools.PermissionAsk
	default:
		return fltools.PermissionDeny
	}
}

func floretToolResourceKinds(toolName string) []string {
	switch strings.TrimSpace(toolName) {
	case "terminal.exec":
		return []string{"command"}
	case "file.read", "read_file", "read_files", "rgrep", "find", "file.edit", "file.write", "apply_patch":
		return []string{"file"}
	case "web_fetch":
		return []string{"web_url"}
	case "web.search":
		return []string{"web_query"}
	case "okf.index", "okf.search", "okf.open":
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
	case "terminal.exec", "terminal.read", "terminal.write", "terminal.terminate", "web.search", "web_fetch", "use_skill":
		return true
	default:
		return false
	}
}

func floretToolResources(inv fltools.Invocation[map[string]any]) ([]fltools.ResourceRef, error) {
	args := cloneAnyMap(inv.Args)
	switch strings.TrimSpace(inv.Name) {
	case "terminal.exec":
		out := []fltools.ResourceRef{}
		if command := strings.TrimSpace(anyToString(args["command"])); command != "" {
			out = append(out, fltools.ResourceRef{Kind: "command", Value: command})
		}
		if cwd := strings.TrimSpace(firstNonEmptyString(anyToString(args["cwd"]), anyToString(args["workdir"]))); cwd != "" {
			out = append(out, fltools.ResourceRef{Kind: "working_directory", Value: cwd})
		}
		if len(out) > 0 {
			return out, nil
		}
	case "terminal.read", "terminal.write", "terminal.terminate":
		if processID := strings.TrimSpace(anyToString(args["process_id"])); processID != "" {
			return []fltools.ResourceRef{{Kind: "terminal_process", Value: processID}}, nil
		}
	case "file.read", "read_file", "file.edit", "file.write":
		if path := strings.TrimSpace(anyToString(args["file_path"])); path != "" {
			return []fltools.ResourceRef{{Kind: "file", Value: path}}, nil
		}
		if path := strings.TrimSpace(anyToString(args["path"])); path != "" {
			return []fltools.ResourceRef{{Kind: "file", Value: path}}, nil
		}
	case "read_files":
		paths := extractStringSlice(args["paths"])
		out := make([]fltools.ResourceRef, 0, len(paths))
		for _, path := range paths {
			if path = strings.TrimSpace(path); path != "" {
				out = append(out, fltools.ResourceRef{Kind: "file", Value: path})
			}
		}
		if len(out) > 0 {
			return out, nil
		}
	case "rgrep":
		paths := extractStringSlice(args["paths"])
		if len(paths) == 0 {
			if query := strings.TrimSpace(anyToString(args["query"])); query != "" {
				return []fltools.ResourceRef{{Kind: "file", Value: query}}, nil
			}
		}
		out := make([]fltools.ResourceRef, 0, len(paths))
		for _, path := range paths {
			if path = strings.TrimSpace(path); path != "" {
				out = append(out, fltools.ResourceRef{Kind: "file", Value: path})
			}
		}
		if len(out) > 0 {
			return out, nil
		}
	case "find":
		if root := strings.TrimSpace(anyToString(args["root"])); root != "" {
			return []fltools.ResourceRef{{Kind: "file", Value: root}}, nil
		}
	case "web_fetch":
		if rawURL := strings.TrimSpace(anyToString(args["url"])); rawURL != "" {
			return []fltools.ResourceRef{{Kind: "web_url", Value: rawURL}}, nil
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
	case "okf.index":
		if section := strings.TrimSpace(anyToString(args["section"])); section != "" {
			return []fltools.ResourceRef{{Kind: "knowledge_query", Value: section}}, nil
		}
	case "okf.search":
		if query := strings.TrimSpace(anyToString(args["query"])); query != "" {
			return []fltools.ResourceRef{{Kind: "knowledge_query", Value: query}}, nil
		}
	case "okf.open":
		if conceptID := strings.TrimSpace(anyToString(args["concept_id"])); conceptID != "" {
			return []fltools.ResourceRef{{Kind: "knowledge_query", Value: conceptID}}, nil
		}
		if path := strings.TrimSpace(anyToString(args["path"])); path != "" {
			return []fltools.ResourceRef{{Kind: "knowledge_query", Value: path}}, nil
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

func stripRedevenTargetFieldsFromFloretToolSchema(_ string, inputSchema map[string]any) map[string]any {
	if inputSchema == nil {
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

func floretToolEffects(def ToolDef) []fltools.Effect {
	name := strings.TrimSpace(def.Name)
	switch name {
	case "terminal.exec", "terminal.read", "terminal.write", "terminal.terminate":
		return []fltools.Effect{fltools.EffectShell}
	case "web.search", "web_fetch":
		return []fltools.Effect{fltools.EffectNetwork}
	case "use_skill":
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
	if result.Pending != nil {
		activity := pendingToolActivityFromFlower(result, structured)
		return fltools.Result{
			CallID:     strings.TrimSpace(result.ToolID),
			Name:       strings.TrimSpace(result.ToolName),
			Structured: structured,
			Activity:   activity,
			Pending: &fltools.PendingToolResult{
				Handle:      strings.TrimSpace(result.Pending.Handle),
				State:       fltools.PendingToolResultRunning,
				Summary:     strings.TrimSpace(result.Pending.Summary),
				Instruction: strings.TrimSpace(result.Pending.Instruction),
				Metadata:    cloneStringMap(result.Pending.Metadata),
			},
		}, nil
	}
	text, _ := json.Marshal(structured)
	status := strings.TrimSpace(anyToString(structured["status"]))
	metadata := map[string]any(nil)
	isError := status != toolResultStatusSuccess
	if status == toolResultStatusAborted {
		metadata = map[string]any{"tool_result_status": string(observation.ActivityStatusCanceled)}
		isError = false
	}
	if token := floretToolResultProgressToken(result, structured); token != "" {
		if metadata == nil {
			metadata = map[string]any{}
		}
		metadata[fltools.ResultMetadataProgressToken] = token
	}
	activity, err := floretActivityForToolResult(r, result)
	if err != nil {
		return fltools.Result{}, err
	}
	return fltools.Result{
		CallID:     strings.TrimSpace(result.ToolID),
		Name:       strings.TrimSpace(result.ToolName),
		Text:       string(text),
		Structured: structured,
		Metadata:   metadata,
		Activity:   activity,
		IsError:    isError,
	}, nil
}

func floretToolResultProgressToken(result ToolResult, structured map[string]any) string {
	if strings.TrimSpace(result.ToolName) != "terminal.read" || structured == nil {
		return ""
	}
	data, _ := structured["data"].(map[string]any)
	if data == nil {
		return ""
	}
	processID := strings.TrimSpace(anyToString(data["process_id"]))
	if processID == "" {
		return ""
	}
	lastSeq := readInt64Field(data, "last_seq")
	status := strings.TrimSpace(anyToString(data["status"]))
	endedAt := readInt64Field(data, "ended_at_ms")
	return fmt.Sprintf("%s:%d:%s:%d", processID, lastSeq, status, endedAt)
}

func pendingToolActivityFromFlower(result ToolResult, structured map[string]any) *observation.ActivityPresentation {
	toolName := strings.TrimSpace(result.ToolName)
	label := activityPresentationLabel(anyToString(structured["command"]))
	if label == "" {
		label = activityPresentationLabel(result.Summary)
	}
	if label == "" {
		label = firstNonEmptyString(toolName, "tool")
	}
	payload := cloneAnyMap(structured)
	payload["status"] = terminalProcessStatusRunning
	return contractSafeActivityPresentationForTool(toolName, &observation.ActivityPresentation{
		Label:    label,
		Renderer: observation.ActivityRendererTerminal,
		Chips: []observation.ActivityChip{
			{Kind: "tool", Label: "shell", Tone: "neutral"},
		},
		Payload: payload,
	})
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
	payload = publicActivityPayloadForTool(toolName, payload)
	payload, _ = contractSafePayloadMap(payload, 0)
	activity := &observation.ActivityPresentation{
		Label:    activityCallLabel(toolName, spec, hasSpec, renderer, args, payload),
		Renderer: renderer,
		Payload:  payload,
	}
	if renderer == observation.ActivityRendererTerminal {
		description := activityPresentationDescription(anyToString(args["description"]))
		if description != activity.Label {
			activity.Description = description
		}
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
	case "section_count":
		if count := len(toAnySlice(source["sections"])); count > 0 {
			return count, true
		}
	case "match_count":
		if value, ok := source["match_count"]; ok {
			return value, true
		}
		if count := len(toAnySlice(source["matches"])); count > 0 {
			return count, true
		}
	case "total_matches":
		if value, ok := source["total_matches"]; ok {
			return value, true
		}
	case "link_count":
		if value, ok := source["link_count"]; ok {
			return value, true
		}
		if count := len(toAnySlice(source["links"])); count > 0 {
			return count, true
		}
	case "backlink_count":
		if value, ok := source["backlink_count"]; ok {
			return value, true
		}
		if count := len(toAnySlice(source["backlinks"])); count > 0 {
			return count, true
		}
	case "concept_title":
		if concept, ok := source["concept"].(map[string]any); ok {
			if title := strings.TrimSpace(anyToString(concept["title"])); title != "" {
				return title, true
			}
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
		if count := len(toAnySlice(source["items"])); count > 0 {
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
	rawPayload, dataTruncated := activityPayloadFromResultDataForTool(toolName, result.Data)
	payload := activityPayloadFromFieldListWithRegistry(r, spec.ResultPayloadFields, rawPayload)
	payload = activityPayloadWithSpecOperation(payload, spec, hasSpec)
	if status != "" {
		payload["status"] = status
	}
	if result.Truncated || readBoolField(rawPayload, "truncated") || readBoolField(payload, "truncated") || (!isOKFToolName(toolName) && dataTruncated) {
		payload["truncated"] = true
	}
	if result.ContentRef != "" {
		payload["content_ref"] = strings.TrimSpace(result.ContentRef)
	}
	if result.Error != nil {
		payload["error"] = activityToolErrorPayload(result.Error)
	} else if status != toolResultStatusSuccess {
		if message := firstActionableToolActivityText(result.Details, result.Summary); message != "" {
			payload["error"] = map[string]any{"message": message}
		}
	}
	payload = publicActivityPayloadForTool(toolName, payload)
	payload, payloadTruncated := contractSafePayloadMapForTool(toolName, payload, 0)
	if payloadTruncated && !isOKFToolName(toolName) {
		payload["truncated"] = true
	}
	activity := &observation.ActivityPresentation{
		Label:    activityResultLabel(toolName, spec, hasSpec, renderer, payload),
		Renderer: renderer,
		Chips:    activityChipsFromSpec(spec, payload),
		Payload:  payload,
	}
	return contractSafeActivityPresentationForTool(toolName, activity), nil
}

func isNonInformativeToolActivityText(value string) bool {
	normalized := strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(value))), " ")
	switch normalized {
	case "",
		"tool execution completed",
		"tool completed",
		"execution completed",
		"completed",
		"success",
		"ok",
		"done",
		"tool execution failed",
		"tool failed",
		"tool.error",
		"tool error",
		"tool.timeout",
		"tool aborted",
		"tool.aborted",
		"permission_denied":
		return true
	default:
		return false
	}
}

func firstActionableToolActivityText(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || isNonInformativeToolActivityText(value) {
			continue
		}
		return value
	}
	return ""
}

func publicActivityPayloadForTool(toolName string, payload map[string]any) map[string]any {
	if strings.TrimSpace(toolName) != "subagents" || len(payload) == 0 {
		return payload
	}
	if sanitized, ok := sanitizeSubagentsActivityPayloadValue(payload); ok {
		return sanitized
	}
	return map[string]any{}
}

func activityPayloadFromResultDataForTool(toolName string, data any) (map[string]any, bool) {
	if isOKFToolName(toolName) {
		return activityPayloadFromResultDataWithDepth(data, okfActivityPayloadMaxDepth)
	}
	return activityPayloadFromResultData(data)
}

func activityPayloadFromResultData(data any) (map[string]any, bool) {
	return activityPayloadFromResultDataWithDepth(data, activityPayloadMaxDepth)
}

func activityPayloadFromResultDataWithDepth(data any, maxDepth int) (map[string]any, bool) {
	if data == nil {
		return map[string]any{}, false
	}
	if record, ok := data.(map[string]any); ok {
		return contractSafePayloadMapWithMaxDepth(record, 0, maxDepth)
	}
	raw, err := json.Marshal(data)
	if err != nil || len(raw) == 0 {
		value, truncated := contractSafePayloadValueWithMaxDepth(strings.TrimSpace(fmt.Sprint(data)), 1, maxDepth)
		return map[string]any{"value": value}, truncated
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err == nil && out != nil {
		return contractSafePayloadMapWithMaxDepth(out, 0, maxDepth)
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		safeValue, truncated := contractSafePayloadValueWithMaxDepth(string(raw), 1, maxDepth)
		return map[string]any{"value": safeValue}, truncated
	}
	safeValue, truncated := contractSafePayloadValueWithMaxDepth(value, 1, maxDepth)
	return map[string]any{"value": safeValue}, truncated
}

func contractSafePayloadMap(in map[string]any, depth int) (map[string]any, bool) {
	return contractSafePayloadMapWithMaxDepth(in, depth, activityPayloadMaxDepth)
}

func contractSafePayloadMapForTool(toolName string, in map[string]any, depth int) (map[string]any, bool) {
	if isOKFToolName(toolName) {
		return contractSafePayloadMapWithMaxDepth(in, depth, okfActivityPayloadMaxDepth)
	}
	return contractSafePayloadMap(in, depth)
}

func contractSafePayloadMapWithMaxDepth(in map[string]any, depth int, maxDepth int) (map[string]any, bool) {
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
				safeError, errorTruncated := contractSafePayloadMapWithMaxDepth(errorPayload, depth+1, maxDepth)
				out[key] = safeError
				truncated = truncated || errorTruncated
				continue
			}
		}
		safeValue, valueTruncated := contractSafePayloadValueWithMaxDepth(value, depth+1, maxDepth)
		out[key] = safeValue
		truncated = truncated || valueTruncated
	}
	return out, truncated
}

func contractSafePayloadValueWithMaxDepth(value any, depth int, maxDepth int) (any, bool) {
	if depth > maxDepth {
		text, truncated := contractSafeString(compactJSONForActivityPayload(value), activityPayloadStringLimit)
		return text, true || truncated
	}
	if errorPayload, ok := activityToolErrorPayloadFromValue(value); ok {
		safeError, truncated := contractSafePayloadMapWithMaxDepth(errorPayload, depth, maxDepth)
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
		if depth >= maxDepth {
			text, truncated := contractSafeString(compactJSONForActivityPayload(typed), activityPayloadStringLimit)
			return text, true || truncated
		}
		return contractSafePayloadMapWithMaxDepth(typed, depth, maxDepth)
	case []any:
		if depth >= maxDepth {
			text, truncated := contractSafeString(compactJSONForActivityPayload(typed), activityPayloadStringLimit)
			return text, true || truncated
		}
		out := make([]any, 0, len(typed))
		truncated := false
		for _, item := range typed {
			safeItem, itemTruncated := contractSafePayloadValueWithMaxDepth(item, depth+1, maxDepth)
			out = append(out, safeItem)
			truncated = truncated || itemTruncated
		}
		return out, truncated
	case []map[string]any:
		if depth >= maxDepth {
			text, truncated := contractSafeString(compactJSONForActivityPayload(typed), activityPayloadStringLimit)
			return text, true || truncated
		}
		out := make([]any, 0, len(typed))
		truncated := false
		for _, item := range typed {
			safeItem, itemTruncated := contractSafePayloadMapWithMaxDepth(item, depth+1, maxDepth)
			out = append(out, safeItem)
			truncated = truncated || itemTruncated
		}
		return out, truncated
	default:
		raw, err := json.Marshal(value)
		if err != nil || len(raw) == 0 {
			return contractSafePayloadValueWithMaxDepth(strings.TrimSpace(fmt.Sprint(value)), depth, maxDepth)
		}
		var out any
		if err := json.Unmarshal(raw, &out); err != nil {
			return contractSafePayloadValueWithMaxDepth(string(raw), depth, maxDepth)
		}
		return contractSafePayloadValueWithMaxDepth(out, depth, maxDepth)
	}
}

func contractSafeActivityPresentation(activity *observation.ActivityPresentation) *observation.ActivityPresentation {
	return contractSafeActivityPresentationForTool("", activity)
}

func contractSafeActivityPresentationForTool(toolName string, activity *observation.ActivityPresentation) *observation.ActivityPresentation {
	if activity == nil {
		return nil
	}
	activity.Label = activityPresentationLabel(activity.Label)
	activity.Description = activityPresentationDescription(activity.Description)
	if len(activity.Payload) > 0 {
		payload, truncated := contractSafePayloadMapForTool(toolName, activity.Payload, 0)
		if truncated && !isOKFToolName(toolName) {
			payload["truncated"] = true
		}
		activity.Payload = payload
	}
	return activity
}

func isOKFToolName(toolName string) bool {
	switch strings.TrimSpace(toolName) {
	case "okf.index", "okf.search", "okf.open":
		return true
	default:
		return false
	}
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
	if field == "has_more" {
		if !readBoolField(payload, "has_more") {
			return observation.ActivityChip{}, false
		}
		return observation.ActivityChip{Kind: "has_more", Label: "more", Tone: "neutral"}, true
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
	case "results_count", "result_count", "match_count", "total_matches":
		return "results"
	case "section_count":
		return "sections"
	case "source_count":
		return "sources"
	case "link_count":
		return "links"
	case "backlink_count":
		return "backlinks"
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
	case "ask_user", "task_complete":
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
