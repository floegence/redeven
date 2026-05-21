package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/ai/threadstore"
	aitools "github.com/floegence/redeven/internal/ai/tools"
)

const (
	activityTimelineBlockType     = "activity-timeline"
	activityTimelineSchemaVersion = 1
)

func (r *run) ensureActivityTimelineBlockIndex(preferred int) int {
	if r == nil {
		return -1
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.activityTimelineStarted {
		return r.activityBlockIndex
	}
	idx := preferred
	if idx < 0 {
		idx = r.nextBlockIndex
	}
	if idx < 0 {
		idx = 0
	}
	r.activityBlockIndex = idx
	r.activityTimelineStarted = true
	if r.nextBlockIndex <= idx {
		r.nextBlockIndex = idx + 1
	}
	return idx
}

func (r *run) reserveActivityTimelineBlockIndexLocked() int {
	if r == nil {
		return -1
	}
	if r.activityTimelineStarted {
		return r.activityBlockIndex
	}
	idx := r.nextBlockIndex
	if idx < 0 {
		idx = 0
	}
	r.activityBlockIndex = idx
	r.activityTimelineStarted = true
	r.nextBlockIndex = idx + 1
	return idx
}

func (r *run) projectAndPersistToolActivity(preferredIdx int, block ToolCallBlock) (int, ActivityTimelineBlock) {
	idx := r.ensureActivityTimelineBlockIndex(preferredIdx)
	now := time.Now().UnixMilli()
	item := r.activityItemFromToolBlock(block, now)

	r.muAssistant.Lock()
	if r.activityItems == nil {
		r.activityItems = make(map[string]ActivityItem)
	}
	itemID := strings.TrimSpace(item.ItemID)
	if itemID == "" {
		itemID = strings.TrimSpace(block.ToolID)
	}
	if itemID == "" {
		itemID = fmt.Sprintf("activity_%d", len(r.activityOrder)+1)
	}
	item.ItemID = itemID
	if _, ok := r.activityItems[itemID]; !ok {
		r.activityOrder = append(r.activityOrder, itemID)
	}
	r.activityItems[itemID] = item
	timeline := r.buildActivityTimelineLocked(now)
	r.persistEnsureIndex(idx)
	r.assistantBlocks[idx] = timeline
	r.muAssistant.Unlock()

	r.persistActivityProjectionEvents(idx, item, timeline)
	r.persistActivityItem(item, len(r.activityOrder)-1, now)
	return idx, timeline
}

func (r *run) persistActivityProjectionEvents(blockIndex int, item ActivityItem, timeline ActivityTimelineBlock) {
	if r == nil {
		return
	}
	r.persistRunEvent("activity.item.projected", RealtimeStreamKindTool, map[string]any{
		"block_index": blockIndex,
		"item_id":     strings.TrimSpace(item.ItemID),
		"group_id":    strings.TrimSpace(item.GroupID),
		"tool_id":     strings.TrimSpace(item.ToolID),
		"tool_name":   strings.TrimSpace(item.ToolName),
		"kind":        strings.TrimSpace(item.Kind),
		"renderer":    strings.TrimSpace(item.Renderer),
		"status":      strings.TrimSpace(item.Status),
		"severity":    strings.TrimSpace(item.Severity),
	})
	for _, group := range timeline.Groups {
		if strings.TrimSpace(group.GroupID) != strings.TrimSpace(item.GroupID) {
			continue
		}
		r.persistRunEvent("activity.group.updated", RealtimeStreamKindTool, map[string]any{
			"block_index": blockIndex,
			"group_id":    strings.TrimSpace(group.GroupID),
			"renderer":    strings.TrimSpace(group.Renderer),
			"status":      strings.TrimSpace(group.Status),
			"severity":    strings.TrimSpace(group.Severity),
			"item_count":  len(group.Items),
		})
		break
	}
	r.persistRunEvent("activity.timeline.persisted", RealtimeStreamKindTool, map[string]any{
		"block_index":   blockIndex,
		"run_id":        strings.TrimSpace(timeline.RunID),
		"message_id":    strings.TrimSpace(timeline.MessageID),
		"status":        strings.TrimSpace(timeline.Summary.Status),
		"group_count":   len(timeline.Groups),
		"total_items":   timeline.Summary.TotalItems,
		"visible_items": timeline.Summary.VisibleItems,
	})
}

func (r *run) activityItemFromToolBlock(block ToolCallBlock, now int64) ActivityItem {
	toolName := strings.TrimSpace(block.ToolName)
	toolID := strings.TrimSpace(block.ToolID)
	spec := aitools.MustPresentationSpec(toolName)
	if block.RequiresApproval {
		spec.Risk = "approval"
	}
	if spec.Grouping.GroupKey == "" {
		spec.Grouping.GroupKey = string(spec.Kind)
	}
	status := activityStatusFromToolBlock(block)
	severity := activitySeverity(status, block.RequiresApproval, block.ApprovalState)
	args := cloneAnyMap(block.Args)
	payload := map[string]any{}
	if isInteractionTool(toolName) {
		payload = interactionPayloadFromToolBlock(block)
	}
	label, description := summarizeToolActivity(toolName, args, block.Result, block.Error, status)
	targets := activityTargetsForTool(toolName, args, block.Result)
	chips := activityChipsForTool(toolName, block, status)
	detailRefs := r.activityDetailRefsForTool(spec, toolID)
	startedAt := now
	if block.StartedAt != nil && !block.StartedAt.IsZero() {
		startedAt = block.StartedAt.UnixMilli()
	}
	endedAt := int64(0)
	if status == "success" || status == "error" {
		endedAt = now
	}
	return ActivityItem{
		ItemID:           toolID,
		GroupID:          activityGroupID(spec, toolName),
		ToolID:           toolID,
		ToolName:         toolName,
		Kind:             string(spec.Kind),
		Renderer:         spec.Renderer,
		Status:           status,
		Severity:         severity,
		Label:            label,
		Description:      description,
		TargetRefs:       targets,
		Chips:            chips,
		DetailRefs:       detailRefs,
		RequiresApproval: block.RequiresApproval,
		ApprovalState:    strings.TrimSpace(block.ApprovalState),
		Payload:          payload,
		StartedAtUnixMS:  startedAt,
		EndedAtUnixMS:    endedAt,
	}
}

func (r *run) buildActivityTimelineLocked(now int64) ActivityTimelineBlock {
	groupByID := make(map[string]*ActivityGroup)
	groupOrder := make([]string, 0, len(r.activityOrder))
	total := 0
	firstStarted := int64(0)
	lastEnded := int64(0)
	for _, itemID := range r.activityOrder {
		item, ok := r.activityItems[itemID]
		if !ok {
			continue
		}
		total++
		if item.StartedAtUnixMS > 0 && (firstStarted == 0 || item.StartedAtUnixMS < firstStarted) {
			firstStarted = item.StartedAtUnixMS
		}
		if item.EndedAtUnixMS > lastEnded {
			lastEnded = item.EndedAtUnixMS
		}
		groupID := strings.TrimSpace(item.GroupID)
		if groupID == "" {
			groupID = "activity"
			item.GroupID = groupID
		}
		group := groupByID[groupID]
		if group == nil {
			group = &ActivityGroup{
				GroupID:         groupID,
				Kind:            item.Kind,
				Renderer:        item.Renderer,
				Status:          item.Status,
				Severity:        item.Severity,
				DefaultOpen:     itemDefaultOpen(item),
				StartedAtUnixMS: item.StartedAtUnixMS,
				EndedAtUnixMS:   item.EndedAtUnixMS,
			}
			groupByID[groupID] = group
			groupOrder = append(groupOrder, groupID)
		}
		group.Items = append(group.Items, item)
		group.Status = rollupActivityStatus(group.Status, item.Status)
		group.Severity = rollupActivitySeverity(group.Severity, item.Severity)
		group.DefaultOpen = group.DefaultOpen || itemDefaultOpen(item)
		if item.StartedAtUnixMS > 0 && (group.StartedAtUnixMS == 0 || item.StartedAtUnixMS < group.StartedAtUnixMS) {
			group.StartedAtUnixMS = item.StartedAtUnixMS
		}
		if item.EndedAtUnixMS > group.EndedAtUnixMS {
			group.EndedAtUnixMS = item.EndedAtUnixMS
		}
	}
	groups := make([]ActivityGroup, 0, len(groupOrder))
	for _, groupID := range groupOrder {
		group := groupByID[groupID]
		if group == nil {
			continue
		}
		group.Title, group.Subtitle = activityGroupTitle(*group)
		group.Chips = activityGroupChips(*group)
		groups = append(groups, *group)
	}
	duration := int64(0)
	if firstStarted > 0 {
		end := lastEnded
		if end <= 0 {
			end = now
		}
		if end >= firstStarted {
			duration = end - firstStarted
		}
	}
	summary := ActivitySummary{
		Status:       activitySummaryStatus(groups),
		TotalItems:   total,
		VisibleItems: total,
		DurationMS:   duration,
		Label:        activitySummaryLabel(groups, total),
	}
	return ActivityTimelineBlock{
		Type:          activityTimelineBlockType,
		SchemaVersion: activityTimelineSchemaVersion,
		RunID:         strings.TrimSpace(r.id),
		MessageID:     strings.TrimSpace(r.messageID),
		Summary:       summary,
		Groups:        groups,
	}
}

func (r *run) persistActivityItem(item ActivityItem, orderIndex int, now int64) {
	if r == nil || r.threadsDB == nil {
		return
	}
	summaryJSON := marshalPersistJSON(map[string]any{
		"label":             item.Label,
		"description":       item.Description,
		"chips":             item.Chips,
		"requires_approval": item.RequiresApproval,
		"approval_state":    item.ApprovalState,
		"metrics":           item.Metrics,
	}, 3000)
	detailRefsJSON := marshalPersistJSON(item.DetailRefs, 3000)
	targetRefsJSON := marshalPersistJSON(item.TargetRefs, 3000)
	payloadJSON := marshalPersistJSON(item.Payload, 5000)
	ctx, cancel := context.WithTimeout(context.Background(), r.persistTimeout())
	defer cancel()
	_ = r.threadsDB.UpsertActivityItem(ctx, threadstore.ActivityItemRecord{
		EndpointID:      strings.TrimSpace(r.endpointID),
		ThreadID:        strings.TrimSpace(r.threadID),
		RunID:           strings.TrimSpace(r.id),
		MessageID:       strings.TrimSpace(r.messageID),
		GroupID:         strings.TrimSpace(item.GroupID),
		ItemID:          strings.TrimSpace(item.ItemID),
		ToolID:          strings.TrimSpace(item.ToolID),
		ToolName:        strings.TrimSpace(item.ToolName),
		Kind:            strings.TrimSpace(item.Kind),
		Renderer:        strings.TrimSpace(item.Renderer),
		Status:          strings.TrimSpace(item.Status),
		Severity:        strings.TrimSpace(item.Severity),
		SummaryJSON:     summaryJSON,
		DetailRefsJSON:  detailRefsJSON,
		TargetRefsJSON:  targetRefsJSON,
		PayloadJSON:     payloadJSON,
		OrderIndex:      orderIndex,
		StartedAtUnixMs: item.StartedAtUnixMS,
		EndedAtUnixMs:   item.EndedAtUnixMS,
		UpdatedAtUnixMs: now,
	})
}

func activityGroupID(spec aitools.ToolPresentationSpec, toolName string) string {
	groupKey := strings.TrimSpace(spec.Grouping.GroupKey)
	if groupKey == "" {
		groupKey = string(spec.Kind)
	}
	if groupKey == "" {
		groupKey = strings.TrimSpace(toolName)
	}
	if groupKey == "" {
		groupKey = "activity"
	}
	return strings.ReplaceAll(groupKey, ".", "_")
}

func activityStatusFromToolBlock(block ToolCallBlock) string {
	if block.RequiresApproval && strings.TrimSpace(block.ApprovalState) == "required" {
		return "waiting"
	}
	if activityBlockWaitingUser(block) {
		return "waiting"
	}
	switch block.Status {
	case ToolCallStatusPending:
		return "pending"
	case ToolCallStatusRunning, ToolCallStatusRecovering:
		return "running"
	case ToolCallStatusError:
		return "error"
	case ToolCallStatusSuccess:
		return "success"
	default:
		return "running"
	}
}

func activityBlockWaitingUser(block ToolCallBlock) bool {
	result, _ := block.Result.(map[string]any)
	raw, ok := result["waiting_user"]
	if !ok {
		return false
	}
	switch v := raw.(type) {
	case bool:
		return v
	case string:
		return strings.EqualFold(strings.TrimSpace(v), "true")
	default:
		return false
	}
}

func activitySeverity(status string, requiresApproval bool, approvalState string) string {
	if status == "error" {
		return "error"
	}
	if status == "waiting" || (requiresApproval && strings.TrimSpace(approvalState) == "required") {
		return "blocking"
	}
	if status == "running" || status == "pending" {
		return "normal"
	}
	return "quiet"
}

func isInteractionTool(toolName string) bool {
	switch strings.TrimSpace(toolName) {
	case "ask_user", "exit_plan_mode", "task_complete":
		return true
	default:
		return false
	}
}

func interactionPayloadFromToolBlock(block ToolCallBlock) map[string]any {
	payload := map[string]any{}
	if len(block.Args) > 0 {
		for key, value := range block.Args {
			payload[key] = value
		}
	}
	if result, ok := block.Result.(map[string]any); ok {
		for _, key := range []string{"questions", "source", "reason_code", "required_from_user", "evidence_refs", "interaction_contract", "waiting_prompt", "waiting_user", "summary"} {
			if value, exists := result[key]; exists {
				payload[key] = value
			}
		}
	}
	return payload
}

func summarizeToolActivity(toolName string, args map[string]any, result any, errText string, status string) (string, string) {
	if strings.TrimSpace(errText) != "" && status == "error" {
		return humanToolName(toolName) + " failed", truncateRunes(strings.TrimSpace(errText), 160)
	}
	switch strings.TrimSpace(toolName) {
	case "terminal.exec":
		command := strings.TrimSpace(anyToString(args["command"]))
		if command == "" {
			command = "command"
		}
		return "Ran command", truncateRunes(command, 180)
	case "file.read":
		path := compactPath(anyToString(args["file_path"]))
		if path == "" {
			path = "file"
		}
		return "Read " + path, ""
	case "file.edit":
		path := compactPath(anyToString(args["file_path"]))
		if path == "" {
			path = "file"
		}
		return "Edited " + path, ""
	case "file.write":
		path := compactPath(anyToString(args["file_path"]))
		if path == "" {
			path = "file"
		}
		return "Wrote " + path, ""
	case "apply_patch":
		return "Applied patch", activityPatchSummary(args)
	case "web.search":
		query := strings.TrimSpace(anyToString(args["query"]))
		return "Searched the web", truncateRunes(query, 160)
	case "knowledge.search":
		query := strings.TrimSpace(anyToString(args["query"]))
		return "Searched knowledge", truncateRunes(query, 160)
	case "sources":
		return "Collected sources", sourcesCountDescription(result)
	case "write_todos":
		return "Updated todos", todosCountDescription(args, result)
	case "subagents":
		action := strings.TrimSpace(anyToString(args["action"]))
		if action == "" {
			action = "updated"
		}
		return "Managed subagents", action
	case "ask_user":
		return "Input requested", askUserQuestionSummary(args, result)
	case "exit_plan_mode":
		return "Mode switch requested", exitPlanSummary(args, result)
	case "task_complete":
		if status == "waiting" {
			return "Completion approval requested", truncateRunes(anyToString(args["result"]), 180)
		}
		return "Completion acknowledged", truncateRunes(anyToString(args["result"]), 180)
	case "use_skill":
		name := strings.TrimSpace(anyToString(args["name"]))
		if name == "" {
			name = "skill"
		}
		return "Loaded " + name, ""
	default:
		return humanToolName(toolName), ""
	}
}

func activityTargetsForTool(toolName string, args map[string]any, result any) []ActivityTargetRef {
	switch strings.TrimSpace(toolName) {
	case "file.read", "file.edit", "file.write":
		if path := strings.TrimSpace(anyToString(args["file_path"])); path != "" {
			return []ActivityTargetRef{{Kind: "file", Label: compactPath(path), Path: path}}
		}
	case "terminal.exec":
		if command := strings.TrimSpace(anyToString(args["command"])); command != "" {
			return []ActivityTargetRef{{Kind: "command", Label: truncateRunes(command, 80)}}
		}
	case "web.search":
		if query := strings.TrimSpace(anyToString(args["query"])); query != "" {
			return []ActivityTargetRef{{Kind: "query", Label: truncateRunes(query, 80)}}
		}
	case "sources":
		return sourceTargets(result)
	}
	return nil
}

func activityChipsForTool(toolName string, block ToolCallBlock, status string) []ActivityChip {
	chips := []ActivityChip{{Kind: "status", Label: statusLabel(status), Tone: statusTone(status)}}
	if strings.TrimSpace(toolName) == "terminal.exec" {
		if result, ok := block.Result.(map[string]any); ok {
			if code := anyToString(result["exit_code"]); strings.TrimSpace(code) != "" {
				chips = append(chips, ActivityChip{Kind: "exit_code", Label: "exit", Value: strings.TrimSpace(code), Tone: exitCodeTone(code)})
			}
			if ms := anyToString(result["duration_ms"]); strings.TrimSpace(ms) != "" {
				chips = append(chips, ActivityChip{Kind: "duration", Label: formatDurationLabel(ms)})
			}
		}
	}
	if block.RequiresApproval {
		state := strings.TrimSpace(block.ApprovalState)
		if state == "" {
			state = "required"
		}
		chips = append(chips, ActivityChip{Kind: "mode", Label: "approval", Value: state, Tone: "warning"})
	}
	return chips
}

func (r *run) activityDetailRefsForTool(spec aitools.ToolPresentationSpec, toolID string) []ActivityDetailRef {
	toolID = strings.TrimSpace(toolID)
	if toolID == "" {
		return nil
	}
	runID := strings.TrimSpace(r.id)
	detailKind := activityDetailKindForPresentation(spec)
	if detailKind == "terminal_output" {
		return []ActivityDetailRef{{
			RefID:     "terminal_output:" + toolID,
			Kind:      "terminal_output",
			ToolID:    toolID,
			FetchMode: "endpoint",
			Endpoint:  "/_redeven_proxy/api/ai/runs/" + runID + "/tools/" + toolID + "/output",
			Title:     "Command output",
		}}
	}
	return []ActivityDetailRef{{
		RefID:     "tool_detail:" + toolID,
		Kind:      detailKind,
		ToolID:    toolID,
		FetchMode: "endpoint",
		Endpoint:  "/_redeven_proxy/api/ai/runs/" + runID + "/tools/" + toolID + "/detail",
		Title:     "Tool detail",
	}}
}

func activityDetailKindForPresentation(spec aitools.ToolPresentationSpec) string {
	switch strings.TrimSpace(spec.Renderer) {
	case "command":
		return "terminal_output"
	case "todos":
		return "todo_delta"
	case "file_change", "file_context":
		return "file_change"
	case "sources", "knowledge":
		return "web_results"
	default:
		return "structured_fields"
	}
}

func itemDefaultOpen(item ActivityItem) bool {
	return item.Status == "waiting" || item.Status == "error" || item.RequiresApproval
}

func rollupActivityStatus(current string, next string) string {
	rank := map[string]int{"error": 5, "waiting": 4, "running": 3, "pending": 2, "success": 1, "": 0}
	if rank[next] > rank[current] {
		return next
	}
	return current
}

func rollupActivitySeverity(current string, next string) string {
	rank := map[string]int{"error": 4, "blocking": 3, "warning": 2, "normal": 1, "quiet": 0, "": 0}
	if rank[next] > rank[current] {
		return next
	}
	return current
}

func activityGroupTitle(group ActivityGroup) (string, string) {
	count := len(group.Items)
	switch group.Renderer {
	case "command":
		return pluralize("Ran command", "Ran commands", count), countSubtitle(count)
	case "file_context", "context_search", "skill":
		return pluralize("Explored context", "Explored context", count), countSubtitle(count)
	case "file_change":
		return pluralize("Changed file", "Changed files", count), countSubtitle(count)
	case "sources", "knowledge":
		return pluralize("Researched source", "Researched sources", count), countSubtitle(count)
	case "todos":
		return "Updated todos", ""
	case "subagent_group":
		return pluralize("Delegated task", "Delegated tasks", count), countSubtitle(count)
	case "blocking_prompt":
		return "Needs input", ""
	case "run_signal":
		return "Run signal", ""
	default:
		return pluralize("Activity", "Activities", count), countSubtitle(count)
	}
}

func activityGroupChips(group ActivityGroup) []ActivityChip {
	if len(group.Items) <= 1 {
		return nil
	}
	return []ActivityChip{{Kind: "count", Label: fmt.Sprintf("%d items", len(group.Items))}}
}

func activitySummaryStatus(groups []ActivityGroup) string {
	status := "success"
	for _, group := range groups {
		status = rollupActivityStatus(status, group.Status)
	}
	if status == "" {
		return "success"
	}
	return status
}

func activitySummaryLabel(groups []ActivityGroup, total int) string {
	if total <= 0 {
		return "No tool activity"
	}
	counts := make(map[string]int)
	for _, group := range groups {
		counts[group.Renderer] += len(group.Items)
	}
	parts := make([]string, 0, 4)
	if n := counts["command"]; n > 0 {
		parts = append(parts, fmt.Sprintf("%d command%s", n, pluralSuffix(n)))
	}
	if n := counts["file_context"] + counts["context_search"] + counts["skill"]; n > 0 {
		parts = append(parts, fmt.Sprintf("%d context step%s", n, pluralSuffix(n)))
	}
	if n := counts["file_change"]; n > 0 {
		parts = append(parts, fmt.Sprintf("%d change%s", n, pluralSuffix(n)))
	}
	if n := counts["sources"] + counts["knowledge"]; n > 0 {
		parts = append(parts, fmt.Sprintf("%d research step%s", n, pluralSuffix(n)))
	}
	if len(parts) == 0 {
		return fmt.Sprintf("%d activity item%s", total, pluralSuffix(total))
	}
	return strings.Join(parts, " · ")
}

func activityPromptSnapshotFromBlock(block any, messageID string) (*RequestUserInputPrompt, bool) {
	timeline, ok := activityTimelineFromAny(block)
	if !ok {
		return nil, false
	}
	messageID = strings.TrimSpace(messageID)
	if messageID == "" {
		messageID = strings.TrimSpace(timeline.MessageID)
	}
	for gi := len(timeline.Groups) - 1; gi >= 0; gi-- {
		items := timeline.Groups[gi].Items
		for ii := len(items) - 1; ii >= 0; ii-- {
			item := items[ii]
			switch strings.TrimSpace(item.ToolName) {
			case "ask_user":
				if prompt := requestUserInputPromptFromAnyValue(item.Payload, messageID, strings.TrimSpace(item.ToolID)); prompt != nil {
					return prompt, item.Status == "waiting"
				}
				questions := parseAskUserQuestionsAny(item.Payload["questions"])
				if len(questions) > 0 {
					return normalizeRequestUserInputPrompt(&RequestUserInputPrompt{
						MessageID: strings.TrimSpace(messageID),
						ToolID:    strings.TrimSpace(item.ToolID),
						Questions: questions,
					}), item.Status == "waiting"
				}
			case "exit_plan_mode":
				if prompt := requestUserInputPromptFromAnyValue(item.Payload["waiting_prompt"], messageID, strings.TrimSpace(item.ToolID)); prompt != nil {
					return prompt, item.Status == "waiting"
				}
			}
		}
	}
	return nil, false
}

func activityAskUserSummaryFromBlock(block any) string {
	prompt, _ := activityPromptSnapshotFromBlock(block, "")
	if prompt == nil {
		return ""
	}
	return formatRequestUserInputAssistantSummary(*prompt)
}

func activityTimelineFromAny(block any) (ActivityTimelineBlock, bool) {
	switch v := block.(type) {
	case ActivityTimelineBlock:
		if strings.TrimSpace(v.Type) == activityTimelineBlockType {
			return v, true
		}
	case *ActivityTimelineBlock:
		if v != nil && strings.TrimSpace(v.Type) == activityTimelineBlockType {
			return *v, true
		}
	case map[string]any:
		if strings.TrimSpace(anyToString(v["type"])) != activityTimelineBlockType {
			return ActivityTimelineBlock{}, false
		}
		raw, err := json.Marshal(v)
		if err != nil {
			return ActivityTimelineBlock{}, false
		}
		var out ActivityTimelineBlock
		if err := json.Unmarshal(raw, &out); err != nil {
			return ActivityTimelineBlock{}, false
		}
		return out, true
	}
	return ActivityTimelineBlock{}, false
}

func humanToolName(toolName string) string {
	name := strings.TrimSpace(toolName)
	if name == "" {
		return "Tool"
	}
	name = strings.ReplaceAll(name, "_", " ")
	name = strings.ReplaceAll(name, ".", " ")
	parts := strings.Fields(name)
	for i, part := range parts {
		parts[i] = strings.ToUpper(part[:1]) + part[1:]
	}
	return strings.Join(parts, " ")
}

func compactPath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	base := filepath.Base(path)
	if base == "." || base == string(filepath.Separator) || base == "" {
		return truncateRunes(path, 80)
	}
	return truncateRunes(base, 80)
}

func activityPatchSummary(args map[string]any) string {
	patch := strings.TrimSpace(anyToString(args["patch"]))
	if patch == "" {
		return ""
	}
	lines := strings.Split(patch, "\n")
	paths := make([]string, 0, 4)
	for _, line := range lines {
		line = strings.TrimSpace(line)
		for _, prefix := range []string{"*** Add File:", "*** Update File:", "*** Delete File:"} {
			if strings.HasPrefix(line, prefix) {
				path := compactPath(strings.TrimSpace(strings.TrimPrefix(line, prefix)))
				if path != "" {
					paths = append(paths, path)
				}
			}
		}
		if len(paths) >= 3 {
			break
		}
	}
	if len(paths) == 0 {
		return ""
	}
	return strings.Join(paths, ", ")
}

func sourcesCountDescription(result any) string {
	count := len(sourceTargets(result))
	if count <= 0 {
		return ""
	}
	return fmt.Sprintf("%d source%s", count, pluralSuffix(count))
}

func sourceTargets(result any) []ActivityTargetRef {
	rec, _ := result.(map[string]any)
	rawItems, _ := rec["sources"].([]SourceRef)
	targets := make([]ActivityTargetRef, 0, len(rawItems))
	for _, src := range rawItems {
		url := strings.TrimSpace(src.URL)
		if url == "" {
			continue
		}
		label := strings.TrimSpace(src.Title)
		if label == "" {
			label = url
		}
		targets = append(targets, ActivityTargetRef{Kind: "url", Label: truncateRunes(label, 80), URI: url})
	}
	if len(targets) > 0 {
		return targets
	}
	if arr, ok := rec["sources"].([]any); ok {
		for _, item := range arr {
			m, _ := item.(map[string]any)
			url := strings.TrimSpace(anyToString(m["url"]))
			if url == "" {
				continue
			}
			label := strings.TrimSpace(anyToString(m["title"]))
			if label == "" {
				label = url
			}
			targets = append(targets, ActivityTargetRef{Kind: "url", Label: truncateRunes(label, 80), URI: url})
		}
	}
	return targets
}

func todosCountDescription(args map[string]any, result any) string {
	count := 0
	if rec, ok := result.(map[string]any); ok {
		if arr, ok := rec["todos"].([]any); ok {
			count = len(arr)
		}
	}
	if count == 0 {
		if arr, ok := args["todos"].([]any); ok {
			count = len(arr)
		}
	}
	if count <= 0 {
		return ""
	}
	return fmt.Sprintf("%d item%s", count, pluralSuffix(count))
}

func askUserQuestionSummary(args map[string]any, result any) string {
	questions := extractAskUserQuestions(args, result)
	if len(questions) == 0 {
		return ""
	}
	if len(questions) == 1 {
		return truncateRunes(strings.TrimSpace(questions[0].Question), 180)
	}
	return fmt.Sprintf("%d questions", len(questions))
}

func exitPlanSummary(args map[string]any, result any) string {
	if rec, ok := result.(map[string]any); ok {
		if summary := strings.TrimSpace(anyToString(rec["summary"])); summary != "" {
			return truncateRunes(summary, 180)
		}
	}
	return truncateRunes(anyToString(args["summary"]), 180)
}

func statusLabel(status string) string {
	switch status {
	case "pending":
		return "Pending"
	case "running":
		return "Running"
	case "waiting":
		return "Waiting"
	case "error":
		return "Error"
	default:
		return "Done"
	}
}

func statusTone(status string) string {
	switch status {
	case "error":
		return "error"
	case "waiting":
		return "warning"
	case "running", "pending":
		return "info"
	default:
		return "success"
	}
}

func exitCodeTone(code string) string {
	if strings.TrimSpace(code) == "0" {
		return "success"
	}
	return "error"
}

func formatDurationLabel(ms string) string {
	ms = strings.TrimSpace(ms)
	if ms == "" {
		return ""
	}
	return ms + "ms"
}

func pluralize(one string, many string, count int) string {
	if count == 1 {
		return one
	}
	return many
}

func pluralSuffix(count int) string {
	if count == 1 {
		return ""
	}
	return "s"
}

func countSubtitle(count int) string {
	if count <= 1 {
		return ""
	}
	return fmt.Sprintf("%d items", count)
}
