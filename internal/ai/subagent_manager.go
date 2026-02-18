package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	subagentStatusQueued    = "queued"
	subagentStatusRunning   = "running"
	subagentStatusWaiting   = "waiting_input"
	subagentStatusCompleted = "completed"
	subagentStatusFailed    = "failed"
	subagentStatusCanceled  = "canceled"
	subagentStatusTimedOut  = "timed_out"

	subagentAgentTypeExplore  = "explore"
	subagentAgentTypeWorker   = "worker"
	subagentAgentTypeReviewer = "reviewer"

	subagentActionCreate       = "create"
	subagentActionWait         = "wait"
	subagentActionList         = "list"
	subagentActionInspect      = "inspect"
	subagentActionSteer        = "steer"
	subagentActionTerminate    = "terminate"
	subagentActionTerminateAll = "terminate_all"

	subagentContextModeIsolated      = "isolated"
	subagentContextModeMinimalPack   = "minimal_pack"
	subagentContextModeThreadCompact = "thread_compact"
	subagentContextModeThreadFull    = "thread_full"

	subagentDefaultMaxSteps   = 8
	subagentDefaultTimeoutSec = 900
	subagentSteerMinInterval  = 2 * time.Second

	subagentFailureReasonRuntimeError            = "runtime_error"
	subagentFailureReasonResultContractViolation = "result_contract_violation"
	subagentFailureReasonTimedOut                = "timed_out"
	subagentFailureReasonCanceled                = "canceled"
)

type subagentStats struct {
	Steps     int64
	ToolCalls int64
	Tokens    int64
	Cost      float64
	ElapsedMS int64
	Outcome   string
}

type subagentExecutionStats struct {
	toolCalls int64
	tokens    int64
	cost      float64
}

type subagentResultValidation struct {
	Passed bool
	Errors []string
}

type subagentResult struct {
	Summary                string
	EvidenceRefs           []string
	KeyFiles               []map[string]any
	OpenRisks              []string
	NextActions            []string
	Structured             map[string]any
	Validation             subagentResultValidation
	FailureReasonCode      string
	FailureReasonDetail    string
	Blockers               []string
	SuggestedParentActions []string
}

type subagentSpec struct {
	SpecID                   string
	Title                    string
	AgentType                string
	Objective                string
	DelegationPromptMarkdown string
	TriggerReason            string
	ContextMode              string
	Inputs                   []map[string]any
	Constraints              map[string]any
	Deliverables             []string
	DefinitionOfDone         []string
	OutputSchema             map[string]any
	Budget                   map[string]any
	PromptHash               string
	CreatedAtMS              int64
}

func defaultSubagentResult() subagentResult {
	return subagentResult{
		Summary:      "",
		EvidenceRefs: []string{},
		KeyFiles:     []map[string]any{},
		OpenRisks:    []string{},
		NextActions:  []string{},
		Structured:   map[string]any{},
		Validation: subagentResultValidation{
			Passed: false,
			Errors: []string{},
		},
		FailureReasonCode:      "",
		FailureReasonDetail:    "",
		Blockers:               []string{},
		SuggestedParentActions: []string{},
	}
}

type subagentTask struct {
	id            string
	taskID        string
	objective     string
	agentType     string
	triggerReason string
	spec          subagentSpec

	mode              string
	modelID           string
	allowedTools      []string
	maxSteps          int
	timeoutSec        int
	forceReadonlyExec bool

	ctx    context.Context
	cancel context.CancelFunc
	doneCh chan struct{}
	input  chan string

	mu            sync.RWMutex
	status        string
	result        subagentResult
	errMsg        string
	startedAt     int64
	endedAt       int64
	updatedAt     int64
	history       []RunHistoryMsg
	stats         subagentStats
	lastSteerAtMS int64
}

func (t *subagentTask) setStatus(status string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.status = strings.TrimSpace(status)
	now := time.Now().UnixMilli()
	if t.startedAt == 0 {
		t.startedAt = now
	}
	if isSubagentTerminalStatus(status) {
		t.endedAt = now
	}
	t.updatedAt = now
	t.recalculateDerivedStatsLocked()
}

func (t *subagentTask) setResultDetailed(summary string, evidenceRefs []string, structured map[string]any, validation subagentResultValidation, errMsg string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.result.Summary = strings.TrimSpace(summary)
	t.result.EvidenceRefs = cloneStringSlice(evidenceRefs)
	t.result.Structured = cloneAnyMap(structured)
	t.result.Validation = subagentResultValidation{
		Passed: validation.Passed,
		Errors: cloneStringSlice(validation.Errors),
	}
	if validation.Passed {
		t.result.FailureReasonCode = ""
		t.result.FailureReasonDetail = ""
		t.result.Blockers = []string{}
		t.result.SuggestedParentActions = []string{}
	}
	t.errMsg = strings.TrimSpace(errMsg)
	now := time.Now().UnixMilli()
	if t.startedAt == 0 {
		t.startedAt = now
	}
	t.updatedAt = now
	t.recalculateDerivedStatsLocked()
}

func (t *subagentTask) setFailure(reasonCode string, reasonDetail string, summary string, blockers []string, suggestedParentActions []string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.result.FailureReasonCode = strings.TrimSpace(reasonCode)
	t.result.FailureReasonDetail = strings.TrimSpace(reasonDetail)
	t.result.Summary = strings.TrimSpace(summary)
	t.result.Blockers = cloneStringSlice(blockers)
	t.result.SuggestedParentActions = cloneStringSlice(suggestedParentActions)
	if len(t.result.Blockers) == 0 && t.result.FailureReasonDetail != "" {
		t.result.Blockers = []string{t.result.FailureReasonDetail}
	}
	if len(t.result.SuggestedParentActions) == 0 {
		t.result.SuggestedParentActions = []string{
			"Continue autonomously in the parent agent with updated constraints.",
			"Create a replacement subagent with tighter scope and richer trusted inputs.",
		}
	}
	t.result.Validation.Passed = false
	t.errMsg = t.result.FailureReasonDetail
	now := time.Now().UnixMilli()
	if t.startedAt == 0 {
		t.startedAt = now
	}
	t.updatedAt = now
	t.recalculateDerivedStatsLocked()
}

func (t *subagentTask) incrementSteps() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.stats.Steps++
	now := time.Now().UnixMilli()
	if t.startedAt == 0 {
		t.startedAt = now
	}
	t.updatedAt = now
	t.recalculateDerivedStatsLocked()
}

func (t *subagentTask) setExecutionStats(toolCalls int64, tokens int64, cost float64) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if toolCalls < 0 {
		toolCalls = 0
	}
	if tokens < 0 {
		tokens = 0
	}
	if math.IsNaN(cost) || math.IsInf(cost, 0) || cost < 0 {
		cost = 0
	}
	t.stats.ToolCalls = toolCalls
	t.stats.Tokens = tokens
	t.stats.Cost = cost
	t.updatedAt = time.Now().UnixMilli()
	t.recalculateDerivedStatsLocked()
}

func (t *subagentTask) allowSteer(minInterval time.Duration) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	now := time.Now().UnixMilli()
	if t.lastSteerAtMS > 0 && now-t.lastSteerAtMS < minInterval.Milliseconds() {
		return false
	}
	t.lastSteerAtMS = now
	t.updatedAt = now
	return true
}

func (t *subagentTask) recalculateDerivedStatsLocked() {
	endAt := t.endedAt
	if endAt == 0 {
		endAt = time.Now().UnixMilli()
	}
	if t.startedAt > 0 && endAt >= t.startedAt {
		t.stats.ElapsedMS = endAt - t.startedAt
	}
	t.stats.Outcome = strings.TrimSpace(t.status)
}

func (t *subagentTask) appendHistory(user string, assistant string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	user = strings.TrimSpace(user)
	assistant = strings.TrimSpace(assistant)
	if user != "" {
		t.history = append(t.history, RunHistoryMsg{Role: "user", Text: user})
	}
	if assistant != "" {
		t.history = append(t.history, RunHistoryMsg{Role: "assistant", Text: assistant})
	}
	if len(t.history) > 20 {
		t.history = append([]RunHistoryMsg(nil), t.history[len(t.history)-20:]...)
	}
	t.updatedAt = time.Now().UnixMilli()
}

func (t *subagentTask) historySnapshot() []RunHistoryMsg {
	t.mu.RLock()
	defer t.mu.RUnlock()
	if len(t.history) == 0 {
		return nil
	}
	out := make([]RunHistoryMsg, len(t.history))
	copy(out, t.history)
	return out
}

func collectSubagentExecutionStats(child *run, assistantMessageJSON string) subagentExecutionStats {
	stats := subagentExecutionStats{
		toolCalls: countToolCallsFromAssistantMessageJSON(assistantMessageJSON),
	}
	if child == nil {
		return stats
	}
	runtimeToolCalls, runtimeTokens := child.runtimeStatsSnapshot()
	if runtimeToolCalls > 0 || stats.toolCalls == 0 {
		stats.toolCalls = runtimeToolCalls
	}
	if runtimeTokens > 0 {
		stats.tokens = runtimeTokens
	}
	return stats
}

func countToolCallsFromAssistantMessageJSON(messageJSON string) int64 {
	messageJSON = strings.TrimSpace(messageJSON)
	if messageJSON == "" {
		return 0
	}
	var message map[string]any
	if err := json.Unmarshal([]byte(messageJSON), &message); err != nil {
		return 0
	}
	rawBlocks, _ := message["blocks"].([]any)
	if len(rawBlocks) == 0 {
		return 0
	}
	return countToolCallsInBlocks(rawBlocks)
}

func countToolCallsInBlocks(blocks []any) int64 {
	if len(blocks) == 0 {
		return 0
	}
	var total int64
	for _, raw := range blocks {
		block, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		blockType := strings.ToLower(strings.TrimSpace(anyToString(block["type"])))
		if blockType == "tool-call" {
			name := strings.ToLower(strings.TrimSpace(anyToString(block["toolName"])))
			if shouldCountSubagentTool(name) {
				total++
			}
		}
		children, _ := block["children"].([]any)
		total += countToolCallsInBlocks(children)
	}
	return total
}

func shouldCountSubagentTool(toolName string) bool {
	switch strings.ToLower(strings.TrimSpace(toolName)) {
	case "", "sources", "task_complete", "ask_user":
		return false
	default:
		return true
	}
}

func cloneStringSlice(in []string) []string {
	if len(in) == 0 {
		return []string{}
	}
	out := make([]string, len(in))
	copy(out, in)
	return out
}

func cloneMapList(in []map[string]any) []map[string]any {
	if len(in) == 0 {
		return []map[string]any{}
	}
	out := make([]map[string]any, 0, len(in))
	for _, item := range in {
		cp := map[string]any{}
		for k, v := range item {
			cp[k] = v
		}
		out = append(out, cp)
	}
	return out
}

func cloneHistoryList(in []RunHistoryMsg) []map[string]any {
	if len(in) == 0 {
		return []map[string]any{}
	}
	out := make([]map[string]any, 0, len(in))
	for _, item := range in {
		role := strings.TrimSpace(item.Role)
		text := strings.TrimSpace(item.Text)
		if role == "" || text == "" {
			continue
		}
		out = append(out, map[string]any{
			"role": role,
			"text": text,
		})
	}
	return out
}

func cloneRecordList(in []map[string]any) []map[string]any {
	if len(in) == 0 {
		return []map[string]any{}
	}
	out := make([]map[string]any, 0, len(in))
	for _, item := range in {
		out = append(out, cloneAnyMap(item))
	}
	return out
}

func cloneSpec(spec subagentSpec) subagentSpec {
	return subagentSpec{
		SpecID:                   strings.TrimSpace(spec.SpecID),
		Title:                    strings.TrimSpace(spec.Title),
		AgentType:                strings.TrimSpace(spec.AgentType),
		Objective:                strings.TrimSpace(spec.Objective),
		DelegationPromptMarkdown: strings.TrimSpace(spec.DelegationPromptMarkdown),
		TriggerReason:            strings.TrimSpace(spec.TriggerReason),
		ContextMode:              strings.TrimSpace(spec.ContextMode),
		Inputs:                   cloneRecordList(spec.Inputs),
		Constraints:              cloneAnyMap(spec.Constraints),
		Deliverables:             cloneStringSlice(spec.Deliverables),
		DefinitionOfDone:         cloneStringSlice(spec.DefinitionOfDone),
		OutputSchema:             cloneAnyMap(spec.OutputSchema),
		Budget:                   cloneAnyMap(spec.Budget),
		PromptHash:               strings.TrimSpace(spec.PromptHash),
		CreatedAtMS:              spec.CreatedAtMS,
	}
}

func specPreview(spec subagentSpec) map[string]any {
	return map[string]any{
		"spec_id":      strings.TrimSpace(spec.SpecID),
		"title":        strings.TrimSpace(spec.Title),
		"objective":    strings.TrimSpace(spec.Objective),
		"context_mode": strings.TrimSpace(spec.ContextMode),
		"prompt_hash":  strings.TrimSpace(spec.PromptHash),
	}
}

func (t *subagentTask) snapshot() map[string]any {
	t.mu.RLock()
	defer t.mu.RUnlock()

	specCopy := cloneSpec(t.spec)
	resultPayload := map[string]any{
		"summary":                  t.result.Summary,
		"evidence_refs":            cloneStringSlice(t.result.EvidenceRefs),
		"key_files":                cloneMapList(t.result.KeyFiles),
		"open_risks":               cloneStringSlice(t.result.OpenRisks),
		"next_actions":             cloneStringSlice(t.result.NextActions),
		"structured":               cloneAnyMap(t.result.Structured),
		"failure_reason_code":      strings.TrimSpace(t.result.FailureReasonCode),
		"failure_reason_detail":    strings.TrimSpace(t.result.FailureReasonDetail),
		"blockers":                 cloneStringSlice(t.result.Blockers),
		"suggested_parent_actions": cloneStringSlice(t.result.SuggestedParentActions),
		"validation": map[string]any{
			"passed": t.result.Validation.Passed,
			"errors": cloneStringSlice(t.result.Validation.Errors),
		},
	}
	statsPayload := map[string]any{
		"steps":      t.stats.Steps,
		"tool_calls": t.stats.ToolCalls,
		"tokens":     t.stats.Tokens,
		"cost":       t.stats.Cost,
		"elapsed_ms": t.stats.ElapsedMS,
		"outcome":    t.stats.Outcome,
	}
	return map[string]any{
		"id":           t.id,
		"subagent_id":  t.id,
		"task_id":      t.taskID,
		"agent_type":   t.agentType,
		"spec_id":      specCopy.SpecID,
		"title":        specCopy.Title,
		"objective":    specCopy.Objective,
		"context_mode": specCopy.ContextMode,
		"prompt_hash":  specCopy.PromptHash,
		"spec_preview": specPreview(specCopy),
		"spec": map[string]any{
			"spec_id":                    specCopy.SpecID,
			"title":                      specCopy.Title,
			"agent_type":                 specCopy.AgentType,
			"objective":                  specCopy.Objective,
			"delegation_prompt_markdown": specCopy.DelegationPromptMarkdown,
			"trigger_reason":             specCopy.TriggerReason,
			"context_mode":               specCopy.ContextMode,
			"inputs":                     cloneRecordList(specCopy.Inputs),
			"constraints":                cloneAnyMap(specCopy.Constraints),
			"deliverables":               cloneStringSlice(specCopy.Deliverables),
			"definition_of_done":         cloneStringSlice(specCopy.DefinitionOfDone),
			"output_schema":              cloneAnyMap(specCopy.OutputSchema),
			"budget":                     cloneAnyMap(specCopy.Budget),
			"prompt_hash":                specCopy.PromptHash,
			"created_at_ms":              specCopy.CreatedAtMS,
		},
		"delegation_prompt_markdown": specCopy.DelegationPromptMarkdown,
		"deliverables":               cloneStringSlice(specCopy.Deliverables),
		"definition_of_done":         cloneStringSlice(specCopy.DefinitionOfDone),
		"output_schema":              cloneAnyMap(specCopy.OutputSchema),
		"trigger_reason":             t.triggerReason,
		"status":                     t.status,
		"result":                     t.result.Summary,
		"result_struct":              resultPayload,
		"failure_reason_code":        strings.TrimSpace(t.result.FailureReasonCode),
		"failure_reason_detail":      strings.TrimSpace(t.result.FailureReasonDetail),
		"suggested_parent_actions":   cloneStringSlice(t.result.SuggestedParentActions),
		"blockers":                   cloneStringSlice(t.result.Blockers),
		"error":                      t.errMsg,
		"started_at_ms":              t.startedAt,
		"ended_at_ms":                t.endedAt,
		"updated_at_ms":              t.updatedAt,
		"stats":                      statsPayload,
		"history":                    cloneHistoryList(t.history),
	}
}

func (t *subagentTask) eventPayload() map[string]any {
	snapshot := t.snapshot()
	return map[string]any{
		"subagent_id":         snapshot["subagent_id"],
		"task_id":             snapshot["task_id"],
		"agent_type":          snapshot["agent_type"],
		"spec_id":             snapshot["spec_id"],
		"title":               snapshot["title"],
		"objective":           snapshot["objective"],
		"trigger_reason":      snapshot["trigger_reason"],
		"status":              snapshot["status"],
		"failure_reason_code": snapshot["failure_reason_code"],
		"updated_at_ms":       snapshot["updated_at_ms"],
		"stats":               snapshot["stats"],
	}
}

func (t *subagentTask) statusSnapshot() string {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.status
}

type subagentRoleDefaults struct {
	Mode              string
	Allowlist         []string
	MaxSteps          int
	ForceReadonlyExec bool
}

type subagentManager struct {
	mu           sync.RWMutex
	parent       *run
	tasks        map[string]*subagentTask
	taskByTaskID map[string]string
	maxDepth     int
	maxParallel  int
}

func newSubagentManager(parent *run) *subagentManager {
	return &subagentManager{
		parent:       parent,
		tasks:        map[string]*subagentTask{},
		taskByTaskID: map[string]string{},
		maxDepth:     3,
		maxParallel:  5,
	}
}

func isSubagentTerminalStatus(status string) bool {
	switch strings.TrimSpace(status) {
	case subagentStatusCompleted, subagentStatusFailed, subagentStatusCanceled, subagentStatusTimedOut:
		return true
	default:
		return false
	}
}

func isValidSubagentAgentType(agentType string) bool {
	switch strings.TrimSpace(strings.ToLower(agentType)) {
	case subagentAgentTypeExplore, subagentAgentTypeWorker, subagentAgentTypeReviewer:
		return true
	default:
		return false
	}
}

func buildRoleDefaults(agentType string) subagentRoleDefaults {
	switch strings.TrimSpace(strings.ToLower(agentType)) {
	case subagentAgentTypeWorker:
		return subagentRoleDefaults{
			Mode:              "act",
			Allowlist:         defaultSubagentToolAllowlistWorker(),
			MaxSteps:          12,
			ForceReadonlyExec: false,
		}
	case subagentAgentTypeReviewer:
		return subagentRoleDefaults{
			Mode:              "plan",
			Allowlist:         defaultSubagentToolAllowlistReadonly(),
			MaxSteps:          10,
			ForceReadonlyExec: true,
		}
	default:
		return subagentRoleDefaults{
			Mode:              "plan",
			Allowlist:         defaultSubagentToolAllowlistReadonly(),
			MaxSteps:          subagentDefaultMaxSteps,
			ForceReadonlyExec: true,
		}
	}
}

func (m *subagentManager) activeCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	count := 0
	for _, task := range m.tasks {
		if task == nil {
			continue
		}
		if !isSubagentTerminalStatus(task.statusSnapshot()) {
			count++
		}
	}
	return count
}

func (m *subagentManager) getTask(id string) *subagentTask {
	m.mu.RLock()
	defer m.mu.RUnlock()
	id = strings.TrimSpace(id)
	if id == "" {
		return nil
	}
	if task, ok := m.tasks[id]; ok {
		return task
	}
	if subagentID, ok := m.taskByTaskID[id]; ok {
		return m.tasks[subagentID]
	}
	return nil
}

func (m *subagentManager) allTasks() []*subagentTask {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]*subagentTask, 0, len(m.tasks))
	for _, task := range m.tasks {
		if task != nil {
			out = append(out, task)
		}
	}
	return out
}

func (m *subagentManager) addTask(task *subagentTask) {
	if m == nil || task == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.tasks[task.id] = task
	if taskID := strings.TrimSpace(task.taskID); taskID != "" {
		m.taskByTaskID[taskID] = task.id
	}
}

func (m *subagentManager) closeAll() {
	if m == nil {
		return
	}
	for _, task := range m.allTasks() {
		if task == nil {
			continue
		}
		task.cancel()
	}
}

func normalizeSubagentContextMode(raw string) string {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case subagentContextModeIsolated, subagentContextModeMinimalPack, subagentContextModeThreadCompact, subagentContextModeThreadFull:
		return strings.TrimSpace(strings.ToLower(raw))
	default:
		return subagentContextModeIsolated
	}
}

func normalizeUniqueNonEmptyList(in []string) []string {
	if len(in) == 0 {
		return []string{}
	}
	seen := map[string]struct{}{}
	out := make([]string, 0, len(in))
	for _, item := range in {
		value := strings.TrimSpace(item)
		if value == "" {
			continue
		}
		key := strings.ToLower(value)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, value)
	}
	return out
}

func normalizeSubagentSpecInputs(raw any) []map[string]any {
	rawList, ok := raw.([]any)
	if !ok {
		return []map[string]any{}
	}
	out := make([]map[string]any, 0, len(rawList))
	for _, item := range rawList {
		switch typed := item.(type) {
		case string:
			value := strings.TrimSpace(typed)
			if value == "" {
				continue
			}
			out = append(out, map[string]any{"kind": "fact", "value": value})
		case map[string]any:
			kind := strings.TrimSpace(anyToString(typed["kind"]))
			if kind == "" {
				kind = "fact"
			}
			value := strings.TrimSpace(anyToString(typed["value"]))
			if value == "" {
				continue
			}
			entry := map[string]any{
				"kind":  kind,
				"value": value,
			}
			if source := strings.TrimSpace(anyToString(typed["source"])); source != "" {
				entry["source"] = source
			}
			out = append(out, entry)
		}
	}
	if len(out) > 16 {
		out = out[:16]
	}
	return out
}

func marshalSubagentSchemaPretty(schema map[string]any) string {
	if len(schema) == 0 {
		return "{}"
	}
	b, err := json.MarshalIndent(schema, "", "  ")
	if err != nil {
		return "{}"
	}
	return string(b)
}

func computeSHA256(text string) string {
	sum := sha256.Sum256([]byte(text))
	return "sha256:" + hex.EncodeToString(sum[:])
}

func validateSubagentOutputSchemaDefinition(schema map[string]any) error {
	if len(schema) == 0 {
		return errors.New("missing output_schema")
	}
	if strings.TrimSpace(strings.ToLower(anyToString(schema["type"]))) != "object" {
		return errors.New("output_schema.type must be object")
	}
	rawRequired, ok := schema["required"].([]any)
	if !ok || len(rawRequired) == 0 {
		return errors.New("output_schema.required must include at least one key")
	}
	properties, ok := schema["properties"].(map[string]any)
	if !ok || len(properties) == 0 {
		return errors.New("output_schema.properties must be a non-empty object")
	}
	required := normalizeUniqueNonEmptyList(extractStringSlice(rawRequired))
	if len(required) == 0 {
		return errors.New("output_schema.required must include at least one non-empty key")
	}
	for _, key := range required {
		if _, ok := properties[key]; !ok {
			return fmt.Errorf("output_schema.required key %q missing in properties", key)
		}
	}
	return nil
}

func buildSubagentDelegationPrompt(spec subagentSpec) string {
	inputLines := make([]string, 0, len(spec.Inputs))
	for _, input := range spec.Inputs {
		kind := strings.TrimSpace(anyToString(input["kind"]))
		value := strings.TrimSpace(anyToString(input["value"]))
		if value == "" {
			continue
		}
		if kind == "" {
			kind = "fact"
		}
		inputLines = append(inputLines, fmt.Sprintf("- [%s] %s", kind, value))
	}
	if len(inputLines) == 0 {
		inputLines = append(inputLines, "- No additional trusted inputs were provided.")
	}

	deliverableLines := make([]string, 0, len(spec.Deliverables))
	for i, item := range spec.Deliverables {
		deliverableLines = append(deliverableLines, fmt.Sprintf("%d. %s", i+1, item))
	}

	dodLines := make([]string, 0, len(spec.DefinitionOfDone))
	for i, item := range spec.DefinitionOfDone {
		dodLines = append(dodLines, fmt.Sprintf("%d. %s", i+1, item))
	}

	allowedTools := extractStringSlice(spec.Constraints["allowed_tools"])
	readonlyExec := spec.Constraints["readonly_exec"] == true
	noUserInteraction := spec.Constraints["no_user_interaction"] == true
	subdelegateAllowed := spec.Constraints["allow_subdelegate"] == true
	maxSteps := parseIntRaw(spec.Budget["max_steps"], subagentDefaultMaxSteps)
	timeoutSec := parseIntRaw(spec.Budget["timeout_sec"], subagentDefaultTimeoutSec)

	promptParts := []string{
		"# Mission",
		strings.TrimSpace(spec.Objective),
		"",
		"# Context You Can Trust",
		strings.Join(inputLines, "\n"),
		"",
		"# Scope Boundaries",
		fmt.Sprintf("- Context mode: %s", strings.TrimSpace(spec.ContextMode)),
		fmt.Sprintf("- No user interaction: %t", noUserInteraction),
		fmt.Sprintf("- Allow sub-delegation: %t", subdelegateAllowed),
		fmt.Sprintf("- Readonly execution policy: %t", readonlyExec),
		fmt.Sprintf("- Trigger reason: %s", strings.TrimSpace(spec.TriggerReason)),
		"",
		"# Required Deliverables",
		strings.Join(deliverableLines, "\n"),
		"",
		"# Definition of Done",
		strings.Join(dodLines, "\n"),
		"",
		"# Output JSON Contract",
		"Return a JSON object that follows this schema in your final `task_complete.result`:",
		"```json",
		marshalSubagentSchemaPretty(spec.OutputSchema),
		"```",
		"",
		"# Execution Policy",
		fmt.Sprintf("- Allowed tools: %s", strings.Join(allowedTools, ", ")),
		"- Do not ask the user for clarification.",
		"- Use concrete evidence and references in the final result.",
		"",
		"# Budget",
		fmt.Sprintf("- Max steps: %d", maxSteps),
		fmt.Sprintf("- Timeout: %d seconds", timeoutSec),
	}
	return strings.TrimSpace(strings.Join(promptParts, "\n"))
}

func buildSubagentSpec(args map[string]any, agentType string, objective string, triggerReason string, allowedTools []string, maxSteps int, timeoutSec int, forceReadonlyExec bool) (subagentSpec, error) {
	title := strings.TrimSpace(anyToString(args["title"]))
	if title == "" {
		title = objective
	}
	if len([]rune(title)) > 140 {
		title = string([]rune(title)[:140])
	}
	contextMode := normalizeSubagentContextMode(anyToString(args["context_mode"]))

	deliverables := normalizeUniqueNonEmptyList(extractStringSlice(args["deliverables"]))
	if len(deliverables) == 0 {
		return subagentSpec{}, errors.New("missing deliverables")
	}
	definitionOfDone := normalizeUniqueNonEmptyList(extractStringSlice(args["definition_of_done"]))
	if len(definitionOfDone) == 0 {
		return subagentSpec{}, errors.New("missing definition_of_done")
	}

	outputSchema, _ := args["output_schema"].(map[string]any)
	if err := validateSubagentOutputSchemaDefinition(outputSchema); err != nil {
		return subagentSpec{}, err
	}

	specID, err := newToolID()
	if err != nil {
		return subagentSpec{}, err
	}
	specID = "spec_" + strings.TrimPrefix(specID, "tool_")
	spec := subagentSpec{
		SpecID:        specID,
		Title:         strings.TrimSpace(title),
		AgentType:     strings.TrimSpace(agentType),
		Objective:     strings.TrimSpace(objective),
		TriggerReason: strings.TrimSpace(triggerReason),
		ContextMode:   contextMode,
		Inputs:        normalizeSubagentSpecInputs(args["inputs"]),
		Constraints: map[string]any{
			"no_user_interaction": true,
			"allow_subdelegate":   false,
			"allowed_tools":       cloneStringSlice(allowedTools),
			"readonly_exec":       forceReadonlyExec,
		},
		Deliverables:     cloneStringSlice(deliverables),
		DefinitionOfDone: cloneStringSlice(definitionOfDone),
		OutputSchema:     cloneAnyMap(outputSchema),
		Budget:           map[string]any{"max_steps": maxSteps, "timeout_sec": timeoutSec},
		CreatedAtMS:      time.Now().UnixMilli(),
	}
	spec.DelegationPromptMarkdown = buildSubagentDelegationPrompt(spec)
	spec.PromptHash = computeSHA256(spec.DelegationPromptMarkdown)
	return spec, nil
}

func sanitizeReadonlyAllowlist(allowlist []string) []string {
	return sanitizeSubagentToolAllowlist(allowlist, defaultSubagentToolAllowlistReadonly(), true)
}

func sanitizeSubagentToolAllowlist(allowlist []string, fallback []string, readonlyOnly bool) []string {
	defByName := make(map[string]ToolDef)
	for _, def := range builtInToolDefinitions() {
		name := strings.TrimSpace(def.Name)
		if name == "" {
			continue
		}
		defByName[name] = def
	}
	filter := func(source []string) []string {
		if len(source) == 0 {
			return nil
		}
		seen := make(map[string]struct{})
		out := make([]string, 0, len(source))
		for _, rawName := range source {
			name := strings.TrimSpace(rawName)
			if name == "" {
				continue
			}
			if isSubagentDisallowedTool(name) {
				continue
			}
			if def, ok := defByName[name]; ok && readonlyOnly && def.Mutating {
				continue
			}
			if _, ok := seen[name]; ok {
				continue
			}
			seen[name] = struct{}{}
			out = append(out, name)
		}
		return out
	}
	source := allowlist
	if len(source) == 0 {
		source = append([]string(nil), fallback...)
	}
	out := filter(source)
	if len(out) == 0 && len(fallback) > 0 {
		out = filter(fallback)
	}
	return out
}

func isSubagentDisallowedTool(name string) bool {
	switch strings.TrimSpace(name) {
	case "subagents", "write_todos", "ask_user":
		return true
	default:
		return false
	}
}

func (m *subagentManager) create(ctx context.Context, args map[string]any) (map[string]any, error) {
	_ = ctx
	if m == nil || m.parent == nil {
		return nil, errors.New("subagent manager unavailable")
	}
	if m.parent.subagentDepth+1 > m.maxDepth {
		return nil, fmt.Errorf("subagent depth limit reached")
	}
	if m.activeCount() >= m.maxParallel {
		return nil, fmt.Errorf("subagent parallel limit reached")
	}

	objective := strings.TrimSpace(anyToString(args["objective"]))
	if objective == "" {
		return nil, fmt.Errorf("missing objective")
	}
	if strings.TrimSpace(anyToString(args["task_id"])) != "" {
		return nil, fmt.Errorf("task_id is not supported in create action")
	}

	agentType := strings.ToLower(strings.TrimSpace(anyToString(args["agent_type"])))
	if !isValidSubagentAgentType(agentType) {
		return nil, fmt.Errorf("invalid agent_type")
	}
	triggerReason := strings.TrimSpace(anyToString(args["trigger_reason"]))
	if triggerReason == "" {
		return nil, fmt.Errorf("missing trigger_reason")
	}

	defaults := buildRoleDefaults(agentType)
	mode := strings.ToLower(strings.TrimSpace(anyToString(args["mode"])))
	if mode == "" {
		mode = defaults.Mode
	}
	if mode != "act" && mode != "plan" {
		mode = defaults.Mode
	}

	maxSteps := parseIntArg(args, "budget.max_steps", defaults.MaxSteps)
	if maxSteps <= 0 {
		maxSteps = defaults.MaxSteps
	}
	if maxSteps > 32 {
		maxSteps = 32
	}
	timeoutSec := subagentDefaultTimeoutSec

	allowedTools := sanitizeSubagentToolAllowlist(extractStringSlice(args["allowed_tools"]), defaults.Allowlist, defaults.ForceReadonlyExec)
	spec, err := buildSubagentSpec(args, agentType, objective, triggerReason, allowedTools, maxSteps, timeoutSec, defaults.ForceReadonlyExec)
	if err != nil {
		return nil, err
	}

	modelID := strings.TrimSpace(m.parent.currentModelID)
	if modelID == "" && m.parent.cfg != nil {
		if def, ok := m.parent.cfg.ResolvedCurrentModelID(); ok {
			modelID = def
		}
	}
	if modelID == "" {
		return nil, fmt.Errorf("missing model for subagent")
	}

	subagentID, err := newToolID()
	if err != nil {
		return nil, err
	}
	taskID := subagentID

	taskCtx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutSec)*time.Second)
	task := &subagentTask{
		id:                subagentID,
		taskID:            taskID,
		objective:         spec.Objective,
		agentType:         agentType,
		triggerReason:     triggerReason,
		spec:              cloneSpec(spec),
		mode:              mode,
		modelID:           modelID,
		allowedTools:      append([]string(nil), allowedTools...),
		maxSteps:          maxSteps,
		timeoutSec:        timeoutSec,
		forceReadonlyExec: defaults.ForceReadonlyExec,
		ctx:               taskCtx,
		cancel:            cancel,
		doneCh:            make(chan struct{}),
		input:             make(chan string, 8),
		status:            subagentStatusQueued,
		result:            defaultSubagentResult(),
		startedAt:         time.Now().UnixMilli(),
		updatedAt:         time.Now().UnixMilli(),
	}
	task.recalculateDerivedStatsLocked()
	m.addTask(task)
	task.setStatus(subagentStatusRunning)

	beginPayload := task.eventPayload()
	m.parent.persistRunEvent("delegation.create.begin", RealtimeStreamKindLifecycle, beginPayload)
	go m.runTask(task, spec.DelegationPromptMarkdown)

	return map[string]any{
		"status":                     "ok",
		"action":                     subagentActionCreate,
		"subagent_id":                task.id,
		"task_id":                    task.taskID,
		"agent_type":                 task.agentType,
		"title":                      spec.Title,
		"objective":                  spec.Objective,
		"spec_id":                    spec.SpecID,
		"context_mode":               spec.ContextMode,
		"delegation_prompt_markdown": spec.DelegationPromptMarkdown,
		"prompt_hash":                spec.PromptHash,
		"trigger_reason":             task.triggerReason,
		"subagent_status":            task.statusSnapshot(),
	}, nil
}

func (m *subagentManager) runTask(task *subagentTask, firstInput string) {
	if m == nil || m.parent == nil || task == nil {
		return
	}
	defer close(task.doneCh)
	defer task.cancel()
	input := strings.TrimSpace(firstInput)
	if input == "" {
		input = strings.TrimSpace(task.objective)
	}

	if err := task.ctx.Err(); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			task.setStatus(subagentStatusTimedOut)
			task.setFailure(subagentFailureReasonTimedOut, "Subagent timed out before completion.", task.result.Summary, []string{"Execution timed out before completion."}, []string{"Reduce scope and retry with a narrower objective.", "Create a replacement subagent with focused deliverables."})
		} else {
			task.setStatus(subagentStatusCanceled)
			task.setFailure(subagentFailureReasonCanceled, "Subagent was canceled before completion.", task.result.Summary, []string{"Execution was canceled before completion."}, []string{"Re-run the subagent if work is still required."})
		}
		m.parent.persistRunEvent("delegation.create.end", RealtimeStreamKindLifecycle, task.eventPayload())
		return
	}

	var (
		totalToolCalls int64
		totalTokens    int64
		totalCost      float64
		attemptInput   = input
	)

	for attempt := 1; attempt <= 2; attempt++ {
		if err := task.ctx.Err(); err != nil {
			if errors.Is(err, context.DeadlineExceeded) {
				task.setStatus(subagentStatusTimedOut)
				task.setFailure(subagentFailureReasonTimedOut, "Subagent timed out before completion.", task.result.Summary, []string{"Execution timed out before completion."}, []string{"Reduce scope and retry with a narrower objective.", "Create a replacement subagent with focused deliverables."})
			} else {
				task.setStatus(subagentStatusCanceled)
				task.setFailure(subagentFailureReasonCanceled, "Subagent was canceled before completion.", task.result.Summary, []string{"Execution was canceled before completion."}, []string{"Re-run the subagent if work is still required."})
			}
			m.parent.persistRunEvent("delegation.create.end", RealtimeStreamKindLifecycle, task.eventPayload())
			return
		}

		runID, err := NewRunID()
		if err != nil {
			task.setStatus(subagentStatusFailed)
			task.setFailure(subagentFailureReasonRuntimeError, "Subagent run initialization failed.", "", []string{"Unable to allocate a child run identifier."}, []string{"Retry subagent creation."})
			m.parent.persistRunEvent("delegation.create.end", RealtimeStreamKindLifecycle, task.eventPayload())
			return
		}
		messageID, err := newMessageID()
		if err != nil {
			task.setStatus(subagentStatusFailed)
			task.setFailure(subagentFailureReasonRuntimeError, "Subagent message initialization failed.", "", []string{"Unable to allocate a child message identifier."}, []string{"Retry subagent creation."})
			m.parent.persistRunEvent("delegation.create.end", RealtimeStreamKindLifecycle, task.eventPayload())
			return
		}

		task.incrementSteps()
		history := task.historySnapshot()
		child := newRun(runOptions{
			Log:                   m.parent.log,
			StateDir:              m.parent.stateDir,
			FSRoot:                m.parent.fsRoot,
			Shell:                 m.parent.shell,
			AIConfig:              m.parent.cfg,
			SessionMeta:           m.parent.sessionMeta,
			ResolveProviderKey:    m.parent.resolveProviderKey,
			ResolveWebSearchKey:   m.parent.resolveWebSearchKey,
			RunID:                 runID,
			ChannelID:             m.parent.channelID,
			EndpointID:            m.parent.endpointID,
			ThreadID:              m.parent.threadID,
			UserPublicID:          m.parent.userPublicID,
			MessageID:             messageID,
			MaxWallTime:           time.Duration(task.timeoutSec) * time.Second,
			IdleTimeout:           m.parent.idleTimeout,
			ToolApprovalTimeout:   m.parent.toolApprovalTO,
			SubagentDepth:         m.parent.subagentDepth + 1,
			AllowSubagentDelegate: false,
			ToolAllowlist:         append([]string(nil), task.allowedTools...),
			ForceReadonlyExec:     task.forceReadonlyExec,
			NoUserInteraction:     true,
		})

		req := RunRequest{
			Model:     task.modelID,
			Objective: task.objective,
			History:   history,
			Input:     RunInput{Text: attemptInput},
			Options: RunOptions{
				Mode:            task.mode,
				MaxSteps:        task.maxSteps,
				MaxNoToolRounds: nativeDefaultNoToolRounds,
			},
		}

		err = child.run(task.ctx, req)
		assistantMessageJSON, assistantText, _, snapshotErr := child.snapshotAssistantMessageJSON()
		if snapshotErr != nil {
			assistantMessageJSON = ""
			assistantText = ""
		}
		stats := collectSubagentExecutionStats(child, assistantMessageJSON)
		totalToolCalls += stats.toolCalls
		totalTokens += stats.tokens
		totalCost += stats.cost
		task.setExecutionStats(totalToolCalls, totalTokens, totalCost)
		task.appendHistory(attemptInput, assistantText)

		if err != nil {
			reasonCode, reasonDetail := subagentFailureFromRunError(err)
			switch reasonCode {
			case subagentFailureReasonTimedOut:
				task.setStatus(subagentStatusTimedOut)
			case subagentFailureReasonCanceled:
				task.setStatus(subagentStatusCanceled)
			default:
				task.setStatus(subagentStatusFailed)
			}
			task.setFailure(reasonCode, reasonDetail, assistantText, []string{reasonDetail}, []string{
				"Continue in parent agent and collect additional evidence.",
				"Create a replacement subagent with narrower scope and clearer trusted inputs.",
			})
			m.parent.persistRunEvent("delegation.create.end", RealtimeStreamKindLifecycle, task.eventPayload())
			return
		}

		finalReason := strings.TrimSpace(child.getFinalizationReason())
		finalClass := classifyFinalizationReason(finalReason)
		if finalReason == finalizationReasonBlockedNoUserInteraction || finalClass == finalizationClassWaitingUser {
			task.setStatus(subagentStatusFailed)
			task.setFailure(
				subagentFailureReasonBlockedNoUserInteraction,
				"Subagent requested user interaction, but autonomous mode forbids user interaction.",
				assistantText,
				[]string{"Subagent attempted to request user input in autonomous mode."},
				[]string{
					"Continue in parent agent and decide the next step.",
					"Re-delegate with tighter constraints and richer trusted inputs.",
				},
			)
			payload := task.eventPayload()
			payload["reason"] = "no_user_interaction_policy"
			m.parent.persistRunEvent("delegation.create.end", RealtimeStreamKindLifecycle, payload)
			return
		}
		if finalClass == finalizationClassFailure {
			task.setStatus(subagentStatusFailed)
			detail := "Subagent run ended without explicit completion."
			if finalReason != "" {
				detail = fmt.Sprintf("Subagent ended with finalization reason: %s.", finalReason)
			}
			task.setFailure(subagentFailureReasonRuntimeError, detail, assistantText, []string{detail}, []string{
				"Continue in parent agent and summarize partial evidence.",
				"Re-delegate with refined objective and output contract.",
			})
			payload := task.eventPayload()
			payload["reason"] = "subagent_runtime_finalization_failure"
			payload["finalization_reason"] = finalReason
			m.parent.persistRunEvent("delegation.create.end", RealtimeStreamKindLifecycle, payload)
			return
		}

		completion := extractSubagentCompletionPayload(assistantMessageJSON, assistantText)
		hydrateSubagentStructuredResultFromSummary(task.spec, &completion)
		validation := validateSubagentCompletion(task.spec, completion)
		task.setResultDetailed(completion.summary, completion.evidenceRefs, completion.structured, validation, "")
		if validation.Passed {
			task.setStatus(subagentStatusCompleted)
			task.setResultDetailed(completion.summary, completion.evidenceRefs, completion.structured, validation, "")
			m.parent.persistRunEvent("delegation.create.end", RealtimeStreamKindLifecycle, task.eventPayload())
			return
		}

		if attempt >= 2 {
			task.setStatus(subagentStatusFailed)
			detail := "Subagent result contract violation."
			task.setResultDetailed(completion.summary, completion.evidenceRefs, completion.structured, validation, detail)
			task.setFailure(subagentFailureReasonResultContractViolation, detail, completion.summary, cloneStringSlice(validation.Errors), []string{
				"Re-run subagent with a tighter output schema and explicit field examples.",
				"Handle remaining work directly in the parent agent.",
			})
			payload := task.eventPayload()
			payload["reason"] = "result_contract_violation"
			payload["validation_errors"] = cloneStringSlice(validation.Errors)
			m.parent.persistRunEvent("delegation.create.end", RealtimeStreamKindLifecycle, payload)
			return
		}

		attemptInput = buildSubagentRepairPrompt(task.spec, validation)
		m.parent.persistRunEvent("delegation.validation.retry", RealtimeStreamKindLifecycle, map[string]any{
			"subagent_id":        task.id,
			"attempt":            attempt,
			"validation_errors":  cloneStringSlice(validation.Errors),
			"prompt_contract_id": task.spec.SpecID,
		})
	}
}

func sanitizeSubagentFailureDetail(detail string) string {
	detail = strings.TrimSpace(detail)
	if detail == "" {
		return "Subagent ended before producing a valid completion payload."
	}
	return truncateRunes(detail, 240)
}

func subagentFailureFromRunError(err error) (string, string) {
	if err == nil {
		return "", ""
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return subagentFailureReasonTimedOut, "Subagent timed out before completion."
	}
	if errors.Is(err, context.Canceled) {
		return subagentFailureReasonCanceled, "Subagent was canceled before completion."
	}
	msg := strings.TrimSpace(err.Error())
	if msg == "" {
		return subagentFailureReasonRuntimeError, "Subagent run failed before completion."
	}
	if strings.Contains(msg, finalizationReasonBlockedNoUserInteraction) || strings.Contains(msg, "no-user-interaction") || strings.Contains(msg, "ask_user is disabled") {
		return subagentFailureReasonBlockedNoUserInteraction, "Subagent requested user interaction, but autonomous mode forbids user interaction."
	}
	return subagentFailureReasonRuntimeError, sanitizeSubagentFailureDetail(msg)
}

type subagentCompletionPayload struct {
	summary      string
	evidenceRefs []string
	structured   map[string]any
}

func extractSubagentCompletionPayload(messageJSON string, fallbackSummary string) subagentCompletionPayload {
	payload := subagentCompletionPayload{
		summary:      strings.TrimSpace(fallbackSummary),
		evidenceRefs: []string{},
		structured:   map[string]any{},
	}

	messageJSON = strings.TrimSpace(messageJSON)
	if messageJSON == "" {
		if structured := tryParseJSONResultObject(payload.summary); len(structured) > 0 {
			payload.structured = structured
		}
		return payload
	}

	var message map[string]any
	if err := json.Unmarshal([]byte(messageJSON), &message); err != nil {
		if structured := tryParseJSONResultObject(payload.summary); len(structured) > 0 {
			payload.structured = structured
		}
		return payload
	}

	var candidateResultText string
	var candidateEvidenceRefs []string
	var walk func(blocks []any)
	walk = func(blocks []any) {
		for _, raw := range blocks {
			block, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			blockType := strings.ToLower(strings.TrimSpace(anyToString(block["type"])))
			if blockType == "tool-call" && strings.TrimSpace(anyToString(block["toolName"])) == "task_complete" {
				args, _ := block["args"].(map[string]any)
				resultText := strings.TrimSpace(anyToString(args["result"]))
				evidenceRefs := normalizeUniqueNonEmptyList(extractStringSlice(args["evidence_refs"]))
				if resultText != "" {
					candidateResultText = resultText
				}
				if len(evidenceRefs) > 0 {
					candidateEvidenceRefs = evidenceRefs
				}
			}
			children, _ := block["children"].([]any)
			if len(children) > 0 {
				walk(children)
			}
		}
	}
	rawBlocks, _ := message["blocks"].([]any)
	if len(rawBlocks) > 0 {
		walk(rawBlocks)
	}

	if strings.TrimSpace(candidateResultText) != "" {
		payload.summary = strings.TrimSpace(candidateResultText)
	}
	if len(candidateEvidenceRefs) > 0 {
		payload.evidenceRefs = candidateEvidenceRefs
	}
	if structured := tryParseJSONResultObject(payload.summary); len(structured) > 0 {
		payload.structured = structured
	}
	return payload
}

func tryParseJSONResultObject(input string) map[string]any {
	input = strings.TrimSpace(input)
	if input == "" {
		return nil
	}

	parse := func(candidate string) map[string]any {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			return nil
		}
		var out map[string]any
		if err := json.Unmarshal([]byte(candidate), &out); err != nil {
			return nil
		}
		return out
	}

	if parsed := parse(input); len(parsed) > 0 {
		return parsed
	}

	lower := strings.ToLower(input)
	startFence := strings.Index(lower, "```json")
	if startFence >= 0 {
		rest := input[startFence+7:]
		if endFence := strings.Index(rest, "```"); endFence >= 0 {
			if parsed := parse(rest[:endFence]); len(parsed) > 0 {
				return parsed
			}
		}
	}

	open := strings.Index(input, "{")
	close := strings.LastIndex(input, "}")
	if open >= 0 && close > open {
		if parsed := parse(input[open : close+1]); len(parsed) > 0 {
			return parsed
		}
	}
	return nil
}

func hydrateSubagentStructuredResultFromSummary(spec subagentSpec, completion *subagentCompletionPayload) {
	if completion == nil {
		return
	}
	if len(completion.structured) > 0 {
		return
	}
	summary := strings.TrimSpace(completion.summary)
	if summary == "" {
		return
	}
	requiredKeys := normalizeUniqueNonEmptyList(extractStringSlice(spec.OutputSchema["required"]))
	if len(requiredKeys) == 1 && requiredKeys[0] == "summary" {
		completion.structured = map[string]any{
			"summary": summary,
		}
	}
}

func validateSubagentCompletion(spec subagentSpec, completion subagentCompletionPayload) subagentResultValidation {
	validation := subagentResultValidation{
		Passed: true,
		Errors: []string{},
	}
	if strings.TrimSpace(completion.summary) == "" {
		validation.Passed = false
		validation.Errors = append(validation.Errors, "missing result summary")
	}
	if len(spec.OutputSchema) > 0 {
		structured := completion.structured
		if len(structured) == 0 {
			validation.Passed = false
			validation.Errors = append(validation.Errors, "task_complete.result must contain a JSON object matching output_schema")
		} else {
			schemaErrors := validateMapAgainstSchema(structured, spec.OutputSchema, "$")
			if len(schemaErrors) > 0 {
				validation.Passed = false
				validation.Errors = append(validation.Errors, schemaErrors...)
			}
		}
	}
	if len(validation.Errors) > 0 {
		validation.Errors = normalizeUniqueNonEmptyList(validation.Errors)
	}
	return validation
}

func validateMapAgainstSchema(value map[string]any, schema map[string]any, path string) []string {
	return validateValueAgainstSchema(value, schema, path)
}

func validateValueAgainstSchema(value any, schema map[string]any, path string) []string {
	errorsOut := []string{}
	if len(schema) == 0 {
		return errorsOut
	}
	schemaType := strings.TrimSpace(strings.ToLower(anyToString(schema["type"])))
	switch schemaType {
	case "object":
		obj, ok := value.(map[string]any)
		if !ok {
			return []string{fmt.Sprintf("%s must be an object", path)}
		}
		required := normalizeUniqueNonEmptyList(extractStringSlice(schema["required"]))
		for _, key := range required {
			if _, ok := obj[key]; !ok {
				errorsOut = append(errorsOut, fmt.Sprintf("%s missing required key %q", path, key))
			}
		}
		properties, _ := schema["properties"].(map[string]any)
		for key, rawPropSchema := range properties {
			propSchema, ok := rawPropSchema.(map[string]any)
			if !ok {
				continue
			}
			propValue, exists := obj[key]
			if !exists {
				continue
			}
			errorsOut = append(errorsOut, validateValueAgainstSchema(propValue, propSchema, path+"."+key)...)
		}
	case "array":
		arr, ok := value.([]any)
		if !ok {
			switch typed := value.(type) {
			case []string:
				arr = make([]any, 0, len(typed))
				for _, item := range typed {
					arr = append(arr, item)
				}
			default:
				return []string{fmt.Sprintf("%s must be an array", path)}
			}
		}
		minItems := parseIntRaw(schema["minItems"], 0)
		if minItems > 0 && len(arr) < minItems {
			errorsOut = append(errorsOut, fmt.Sprintf("%s must contain at least %d items", path, minItems))
		}
		itemSchema, _ := schema["items"].(map[string]any)
		if len(itemSchema) > 0 {
			for i, item := range arr {
				errorsOut = append(errorsOut, validateValueAgainstSchema(item, itemSchema, fmt.Sprintf("%s[%d]", path, i))...)
			}
		}
	case "string":
		text, ok := value.(string)
		if !ok {
			return []string{fmt.Sprintf("%s must be a string", path)}
		}
		minLength := parseIntRaw(schema["minLength"], 0)
		if minLength > 0 && len([]rune(strings.TrimSpace(text))) < minLength {
			errorsOut = append(errorsOut, fmt.Sprintf("%s must be at least %d characters", path, minLength))
		}
	case "number", "integer":
		switch value.(type) {
		case int, int32, int64, float32, float64, json.Number:
		default:
			errorsOut = append(errorsOut, fmt.Sprintf("%s must be a number", path))
		}
	case "boolean":
		if _, ok := value.(bool); !ok {
			errorsOut = append(errorsOut, fmt.Sprintf("%s must be a boolean", path))
		}
	case "":
		// No explicit type: treat as pass-through.
	default:
		errorsOut = append(errorsOut, fmt.Sprintf("%s schema type %q is not supported", path, schemaType))
	}
	return errorsOut
}

func buildSubagentRepairPrompt(spec subagentSpec, validation subagentResultValidation) string {
	lines := []string{
		"The previous output failed contract validation.",
		"Fix the output and call task_complete again.",
		"",
		"Validation errors:",
	}
	for _, item := range validation.Errors {
		lines = append(lines, "- "+item)
	}
	lines = append(lines,
		"",
		"Requirements:",
		"- Return task_complete.result as a JSON object (or fenced ```json block) that matches the output schema.",
		"- Include concrete evidence_refs.",
		"- Keep the response aligned with mission: "+strings.TrimSpace(spec.Objective),
	)
	return strings.Join(lines, "\n")
}

func (m *subagentManager) sendInput(id string, message string, interrupt bool) (map[string]any, error) {
	if m == nil {
		return nil, errors.New("subagent manager unavailable")
	}
	id = strings.TrimSpace(id)
	message = strings.TrimSpace(message)
	if id == "" || message == "" {
		return nil, fmt.Errorf("missing id or message")
	}
	task := m.getTask(id)
	if task == nil {
		return map[string]any{"id": id, "status": "not_found"}, nil
	}
	if interrupt {
		task.cancel()
	}
	select {
	case task.input <- message:
		m.parent.persistRunEvent("delegation.interaction.begin", RealtimeStreamKindLifecycle, task.eventPayload())
		return task.snapshot(), nil
	default:
		return nil, fmt.Errorf("subagent input queue is full")
	}
}

func (m *subagentManager) wait(ctx context.Context, ids []string) (map[string]any, bool) {
	if m == nil {
		return map[string]any{}, false
	}
	set := map[string]struct{}{}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id != "" {
			set[id] = struct{}{}
		}
	}
	pick := make([]*subagentTask, 0)
	for _, task := range m.allTasks() {
		if task == nil {
			continue
		}
		if len(set) > 0 {
			if _, ok := set[task.id]; !ok {
				continue
			}
		}
		pick = append(pick, task)
	}
	if len(pick) == 0 {
		return map[string]any{}, false
	}
	m.parent.persistRunEvent("delegation.wait.begin", RealtimeStreamKindLifecycle, map[string]any{"targets": len(pick)})
	ticker := time.NewTicker(120 * time.Millisecond)
	defer ticker.Stop()
	for {
		allFinal := true
		for _, task := range pick {
			if task == nil {
				continue
			}
			if !isSubagentTerminalStatus(task.statusSnapshot()) {
				allFinal = false
				break
			}
		}
		if allFinal {
			out := make(map[string]any, len(pick))
			for _, task := range pick {
				out[task.id] = task.snapshot()
			}
			m.parent.persistRunEvent("delegation.wait.end", RealtimeStreamKindLifecycle, map[string]any{"targets": len(pick), "timed_out": false})
			return out, false
		}
		select {
		case <-ctx.Done():
			out := make(map[string]any, len(pick))
			for _, task := range pick {
				out[task.id] = task.snapshot()
			}
			m.parent.persistRunEvent("delegation.wait.end", RealtimeStreamKindLifecycle, map[string]any{"targets": len(pick), "timed_out": true})
			return out, true
		case <-ticker.C:
		}
	}
}

func (m *subagentManager) close(id string) (map[string]any, error) {
	if m == nil {
		return nil, errors.New("subagent manager unavailable")
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, fmt.Errorf("missing id")
	}
	task := m.getTask(id)
	if task == nil {
		return map[string]any{"id": id, "status": "not_found"}, nil
	}
	m.parent.persistRunEvent("delegation.close.begin", RealtimeStreamKindLifecycle, map[string]any{"subagent_id": id})
	task.cancel()
	select {
	case <-task.doneCh:
	case <-time.After(2 * time.Second):
	}
	out := task.snapshot()
	m.parent.persistRunEvent("delegation.close.end", RealtimeStreamKindLifecycle, task.eventPayload())
	return out, nil
}

func parseBoolArg(args map[string]any, key string, fallback bool) bool {
	raw, ok := args[key]
	if !ok {
		return fallback
	}
	switch v := raw.(type) {
	case bool:
		return v
	case string:
		switch strings.ToLower(strings.TrimSpace(v)) {
		case "1", "true", "yes", "y", "on":
			return true
		case "0", "false", "no", "n", "off":
			return false
		default:
			return fallback
		}
	default:
		return fallback
	}
}

func (m *subagentManager) manage(ctx context.Context, args map[string]any) (map[string]any, error) {
	if m == nil {
		return nil, errors.New("subagent manager unavailable")
	}
	action := strings.ToLower(strings.TrimSpace(anyToString(args["action"])))
	if action == "" {
		return nil, fmt.Errorf("missing action")
	}
	m.parent.persistRunEvent("delegation.manage.begin", RealtimeStreamKindLifecycle, map[string]any{"action": action})
	var out map[string]any
	var err error
	switch action {
	case subagentActionCreate:
		out, err = m.create(ctx, args)
	case subagentActionWait:
		out, err = m.manageWait(ctx, args)
	case subagentActionList:
		out, err = m.manageList(args)
	case subagentActionInspect:
		out, err = m.manageInspect(args)
	case subagentActionSteer:
		out, err = m.manageSteer(args)
	case subagentActionTerminate:
		out, err = m.manageTerminate(args)
	case subagentActionTerminateAll:
		out, err = m.manageTerminateAll(args)
	default:
		err = fmt.Errorf("unsupported action %q", action)
	}
	if err != nil {
		return nil, err
	}
	m.parent.persistRunEvent("delegation.manage.end", RealtimeStreamKindLifecycle, map[string]any{
		"action": action,
		"status": strings.TrimSpace(anyToString(out["status"])),
	})
	return out, nil
}

func sortTasksByUpdatedDesc(tasks []*subagentTask) {
	sort.Slice(tasks, func(i, j int) bool {
		left := tasks[i].snapshot()
		right := tasks[j].snapshot()
		leftUpdated := parseIntRaw(left["updated_at_ms"], 0)
		rightUpdated := parseIntRaw(right["updated_at_ms"], 0)
		if leftUpdated == rightUpdated {
			leftStart := parseIntRaw(left["started_at_ms"], 0)
			rightStart := parseIntRaw(right["started_at_ms"], 0)
			return leftStart > rightStart
		}
		return leftUpdated > rightUpdated
	})
}

func (m *subagentManager) manageList(args map[string]any) (map[string]any, error) {
	runningOnly := parseBoolArg(args, "running_only", false)
	limit := parseIntArg(args, "limit", 50)
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	tasks := m.allTasks()
	sortTasksByUpdatedDesc(tasks)

	items := make([]map[string]any, 0, len(tasks))
	counts := map[string]int{
		subagentStatusQueued:    0,
		subagentStatusRunning:   0,
		subagentStatusWaiting:   0,
		subagentStatusCompleted: 0,
		subagentStatusFailed:    0,
		subagentStatusCanceled:  0,
		subagentStatusTimedOut:  0,
	}
	for _, task := range tasks {
		if task == nil {
			continue
		}
		snapshot := task.snapshot()
		status := strings.TrimSpace(anyToString(snapshot["status"]))
		if _, ok := counts[status]; ok {
			counts[status]++
		}
		if runningOnly && isSubagentTerminalStatus(status) {
			continue
		}
		item := map[string]any{
			"subagent_id":    snapshot["subagent_id"],
			"task_id":        snapshot["task_id"],
			"spec_id":        snapshot["spec_id"],
			"title":          snapshot["title"],
			"objective":      snapshot["objective"],
			"context_mode":   snapshot["context_mode"],
			"prompt_hash":    snapshot["prompt_hash"],
			"spec_preview":   snapshot["spec_preview"],
			"agent_type":     snapshot["agent_type"],
			"trigger_reason": snapshot["trigger_reason"],
			"status":         status,
			"updated_at_ms":  snapshot["updated_at_ms"],
			"stats":          snapshot["stats"],
		}
		items = append(items, item)
		if len(items) >= limit {
			break
		}
	}
	return map[string]any{
		"status":             "ok",
		"action":             subagentActionList,
		"total":              len(tasks),
		"running_only":       runningOnly,
		"queued":             counts[subagentStatusQueued],
		"running":            counts[subagentStatusRunning],
		"waiting_input":      counts[subagentStatusWaiting],
		"completed":          counts[subagentStatusCompleted],
		"failed":             counts[subagentStatusFailed],
		"canceled":           counts[subagentStatusCanceled],
		"timed_out":          counts[subagentStatusTimedOut],
		"items":              items,
		"updated_at_unix_ms": time.Now().UnixMilli(),
	}, nil
}

func (m *subagentManager) manageWait(ctx context.Context, args map[string]any) (map[string]any, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	timeoutMS := parseIntArg(args, "timeout_ms", 30_000)
	if timeoutMS < 10_000 {
		timeoutMS = 10_000
	}
	if timeoutMS > 300_000 {
		timeoutMS = 300_000
	}
	ids := extractStringSlice(args["ids"])
	waitCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutMS)*time.Millisecond)
	defer cancel()
	snapshots, timedOut := m.wait(waitCtx, ids)
	return map[string]any{
		"status":     "ok",
		"action":     subagentActionWait,
		"ids":        ids,
		"timeout_ms": timeoutMS,
		"timed_out":  timedOut,
		"snapshots":  snapshots,
	}, nil
}

func (m *subagentManager) manageInspect(args map[string]any) (map[string]any, error) {
	target := strings.TrimSpace(anyToString(args["target"]))
	task := m.getTask(target)
	if task == nil {
		return map[string]any{
			"status": "not_found",
			"action": subagentActionInspect,
			"target": target,
		}, nil
	}
	return map[string]any{
		"status": "ok",
		"action": subagentActionInspect,
		"target": target,
		"item":   task.snapshot(),
	}, nil
}

func (m *subagentManager) manageSteer(args map[string]any) (map[string]any, error) {
	target := strings.TrimSpace(anyToString(args["target"]))
	message := strings.TrimSpace(anyToString(args["message"]))
	interrupt := parseBoolArg(args, "interrupt", false)
	if target == "" || message == "" {
		return nil, fmt.Errorf("missing target or message")
	}
	task := m.getTask(target)
	if task == nil {
		return map[string]any{
			"status": "not_found",
			"action": subagentActionSteer,
			"target": target,
		}, nil
	}
	if isSubagentTerminalStatus(task.statusSnapshot()) {
		return map[string]any{
			"status":      "already_terminal",
			"action":      subagentActionSteer,
			"subagent_id": task.id,
			"target":      target,
		}, nil
	}
	if !task.allowSteer(subagentSteerMinInterval) {
		return map[string]any{
			"status":      "rate_limited",
			"action":      subagentActionSteer,
			"subagent_id": task.id,
			"target":      target,
		}, nil
	}
	snapshot, err := m.sendInput(task.id, message, interrupt)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"status":      "ok",
		"action":      subagentActionSteer,
		"subagent_id": task.id,
		"target":      target,
		"accepted":    true,
		"snapshot":    snapshot,
	}, nil
}

func (m *subagentManager) manageTerminate(args map[string]any) (map[string]any, error) {
	target := strings.TrimSpace(anyToString(args["target"]))
	if target == "" {
		return nil, fmt.Errorf("missing target")
	}
	task := m.getTask(target)
	if task == nil {
		return map[string]any{
			"status": "not_found",
			"action": subagentActionTerminate,
			"target": target,
		}, nil
	}
	if isSubagentTerminalStatus(task.statusSnapshot()) {
		return map[string]any{
			"status":      "already_terminal",
			"action":      subagentActionTerminate,
			"target":      target,
			"subagent_id": task.id,
			"snapshot":    task.snapshot(),
		}, nil
	}
	snapshot, err := m.close(task.id)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"status":      "ok",
		"action":      subagentActionTerminate,
		"target":      target,
		"subagent_id": task.id,
		"killed":      true,
		"snapshot":    snapshot,
	}, nil
}

func (m *subagentManager) manageTerminateAll(args map[string]any) (map[string]any, error) {
	scope := strings.ToLower(strings.TrimSpace(anyToString(args["scope"])))
	if scope == "" {
		scope = "current_run"
	}
	if scope != "current_run" {
		return nil, fmt.Errorf("forbidden scope")
	}

	tasks := m.allTasks()
	killedCount := 0
	alreadyTerminalCount := 0
	affectedIDs := make([]string, 0, len(tasks))

	for _, task := range tasks {
		if task == nil {
			continue
		}
		affectedIDs = append(affectedIDs, task.id)
		if isSubagentTerminalStatus(task.statusSnapshot()) {
			alreadyTerminalCount++
			continue
		}
		if _, err := m.close(task.id); err != nil {
			return nil, err
		}
		killedCount++
	}

	return map[string]any{
		"status":                 "ok",
		"action":                 subagentActionTerminateAll,
		"scope":                  scope,
		"killed_count":           killedCount,
		"already_terminal_count": alreadyTerminalCount,
		"affected_ids":           affectedIDs,
	}, nil
}

func parseIntArg(args map[string]any, key string, fallback int) int {
	if len(args) == 0 {
		return fallback
	}
	if !strings.Contains(key, ".") {
		return parseIntRaw(args[key], fallback)
	}
	parts := strings.Split(key, ".")
	current := any(args)
	for _, part := range parts {
		m, ok := current.(map[string]any)
		if !ok {
			return fallback
		}
		current = m[part]
	}
	return parseIntRaw(current, fallback)
}

func parseIntRaw(v any, fallback int) int {
	switch x := v.(type) {
	case int:
		return x
	case int64:
		return int(x)
	case float64:
		return int(x)
	case float32:
		return int(x)
	default:
		return fallback
	}
}

func defaultSubagentToolAllowlistReadonly() []string {
	defs := builtInToolDefinitions()
	out := make([]string, 0, len(defs))
	for _, def := range defs {
		if def.Mutating {
			continue
		}
		name := strings.TrimSpace(def.Name)
		if name == "" {
			continue
		}
		if isSubagentDisallowedTool(name) {
			continue
		}
		out = append(out, name)
	}
	return out
}

func defaultSubagentToolAllowlistWorker() []string {
	defs := builtInToolDefinitions()
	out := make([]string, 0, len(defs))
	for _, def := range defs {
		name := strings.TrimSpace(def.Name)
		if name == "" {
			continue
		}
		if isSubagentDisallowedTool(name) {
			continue
		}
		out = append(out, name)
	}
	return out
}
