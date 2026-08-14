package ai

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/floegence/floret/v4/identity"
	flruntime "github.com/floegence/floret/v4/runtime"
	"github.com/floegence/redeven/internal/session"
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

	subagentActionSpawn     = "spawn"
	subagentActionWait      = "wait"
	subagentActionList      = "list"
	subagentActionInspect   = "inspect"
	subagentActionSendInput = "send_input"
	subagentActionClose     = "close"
	subagentActionCloseAll  = "close_all"

	subagentContextModeMissionOnly = "mission_only"
	subagentContextModeFullHistory = "full_history"

	subagentDefaultTimeoutMS = 300_000
	subagentMaxTimeoutMS     = 1_200_000
)

type subagentRuntime interface {
	manage(context.Context, string, map[string]any) (map[string]any, error)
	release()
	snapshots(context.Context) ([]subagentSnapshot, error)
}

type subagentCapabilityContract struct {
	VisibleTools          []string
	HiddenControlTools    []string
	HiddenToolSet         map[string]struct{}
	AllowSpawnSubagents   bool
	AllowUserApproval     bool
	AllowUserInput        bool
	FinalHandoffBudget    int
	ProgressSummaryBudget int
}

type subagentSnapshot struct {
	ThreadID        string
	Path            string
	TaskName        string
	TaskDescription string
	ParentThreadID  string
	ParentTurnID    string
	AgentType       string
	ContextMode     string
	Status          string
	LatestTurnID    string
	LastMessage     string
	WaitingPrompt   string
	QueuedInputs    int
	CreatedAtMS     int64
	UpdatedAtMS     int64
	Closed          bool
	CanSendInput    bool
	CanInterrupt    bool
	CanClose        bool
}

// floretSubagentRuntime is a product tool adapter over ordinary child Threads.
// It owns no child lifecycle state; Floret ThreadService is the sole owner.
type floretSubagentRuntime struct {
	mu      sync.Mutex
	service *Service
	parent  *run
	closed  bool
}

func newFloretSubagentRuntime(parent *run) *floretSubagentRuntime {
	return &floretSubagentRuntime{parent: parent}
}

func newServiceFloretSubagentRuntime(service *Service, parent *run) *floretSubagentRuntime {
	return &floretSubagentRuntime{service: service, parent: parent}
}

func (runtime *floretSubagentRuntime) attachParentRun(parent *run) {
	if runtime == nil || parent == nil {
		return
	}
	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	if !runtime.closed {
		runtime.parent = parent
	}
}

func (runtime *floretSubagentRuntime) parentRun() *run {
	if runtime == nil {
		return nil
	}
	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	return runtime.parent
}

func (runtime *floretSubagentRuntime) boundaries() (*Service, *run, flruntime.ThreadService, error) {
	if runtime == nil {
		return nil, nil, nil, errors.New("subagent runtime unavailable")
	}
	runtime.mu.Lock()
	service, parent, closed := runtime.service, runtime.parent, runtime.closed
	runtime.mu.Unlock()
	if closed || service == nil || parent == nil || service.threadRuntime == nil {
		return nil, nil, nil, errors.New("subagent runtime unavailable")
	}
	return service, parent, service.threadRuntime, nil
}

func (runtime *floretSubagentRuntime) manage(ctx context.Context, toolCallID string, args map[string]any) (map[string]any, error) {
	action := strings.ToLower(strings.TrimSpace(anyToString(args["action"])))
	switch action {
	case subagentActionSpawn:
		return runtime.spawn(ctx, toolCallID, args)
	case subagentActionWait:
		return runtime.wait(ctx, args)
	case subagentActionList:
		return runtime.list(ctx, args)
	case subagentActionInspect:
		return runtime.inspect(ctx, args)
	case subagentActionSendInput:
		return runtime.sendInput(ctx, toolCallID, args)
	case subagentActionClose:
		return runtime.close(ctx, toolCallID, args)
	case subagentActionCloseAll:
		return runtime.closeAll(ctx, toolCallID, args)
	default:
		return nil, fmt.Errorf("unsupported action %q", action)
	}
}

func (runtime *floretSubagentRuntime) spawn(ctx context.Context, toolCallID string, args map[string]any) (map[string]any, error) {
	service, parent, threads, err := runtime.boundaries()
	if err != nil {
		return nil, err
	}
	taskName := strings.TrimSpace(anyToString(args["task_name"]))
	taskDescription := strings.TrimSpace(anyToString(args["task_description"]))
	message := strings.TrimSpace(anyToString(args["message"]))
	if taskName == "" || taskDescription == "" || message == "" {
		return nil, errors.New("subagents spawn requires task_name, task_description, and message")
	}
	agentType := normalizeSubagentAgentType(anyToString(args["agent_type"]))
	contextMode := normalizeSubagentContextMode(anyToString(args["context_mode"]))
	requestKey, err := subagentPublicationID(parent.threadID, parent.turnID, toolCallID)
	if err != nil {
		return nil, err
	}
	prompt := buildFlowerSubagentPrompt(flowerSubagentPromptSpec{
		AgentType: agentType, TaskName: taskName, Message: message, ContextMode: contextMode,
	})
	parentID := identity.ThreadID(strings.TrimSpace(parent.threadID))
	parentTurnID := identity.TurnID(strings.TrimSpace(parent.turnID))
	var child flruntime.ThreadView
	if contextMode == subagentContextModeFullHistory {
		child, err = threads.Fork(ctxOrBackground(ctx), flruntime.ForkThreadInput{
			SourceThreadID: parentID, ParentThreadID: parentID, ParentTurnID: parentTurnID,
			TaskName: taskName, TaskDescription: taskDescription, HostProfileRef: agentType,
			ForkMode: contextMode, RequestKey: flruntime.RequestKey(requestKey),
		})
	} else {
		child, err = threads.Create(ctxOrBackground(ctx), flruntime.CreateThreadInput{
			ParentThreadID: parentID, ParentTurnID: parentTurnID, TaskName: taskName,
			TaskDescription: taskDescription, HostProfileRef: agentType, ForkMode: contextMode,
			RequestKey: flruntime.RequestKey(requestKey),
		})
	}
	if err != nil {
		return nil, err
	}
	if err := service.ensureChildThreadSettings(ctx, parent, child.ThreadID.String(), parentID.String()); err != nil {
		return nil, err
	}
	_, _ = threads.SetTitle(ctxOrBackground(ctx), flruntime.SetTitleInput{
		ThreadID: child.ThreadID, Title: taskName, RequestKey: flruntime.RequestKey(requestKey + ":title"),
	})
	sendKey := requestKey + ":input"
	request := runtime.childEffectRequest(parent, child.ThreadID.String(), sendKey, prompt, agentType)
	service.floretEffects.put(child.ThreadID, sendKey, request)
	result, err := threads.Send(ctxOrBackground(ctx), flruntime.SendInput{
		ThreadID: child.ThreadID, Input: flruntime.UserInput{Text: prompt}, RequestKey: flruntime.RequestKey(sendKey),
	})
	if err != nil {
		service.floretEffects.drop(child.ThreadID, sendKey)
		return nil, err
	}
	summary, err := runtime.snapshotForView(ctx, result)
	if err != nil {
		return nil, err
	}
	runtime.publishParent(ctx)
	item := boundedSubagentItem(subagentSnapshotPayload(summary))
	return trimSubagentToolResult(map[string]any{
		"status": "ok", "action": subagentActionSpawn, "accepted": true,
		"thread_id": summary.ThreadID, "agent_type": summary.AgentType,
		"context_mode": summary.ContextMode, "task_name": summary.TaskName,
		"task_description": summary.TaskDescription, "items": []map[string]any{item},
	}), nil
}

func (runtime *floretSubagentRuntime) childEffectRequest(parent *run, childID, requestKey, text, agentType string) floretEffectRequest {
	meta := session.Meta{}
	if parent.sessionMeta != nil {
		meta = *parent.sessionMeta
	}
	permission := permissionTypeString(parent.currentPermissionType())
	if agentType != subagentAgentTypeWorker {
		permission = permissionTypeString(FlowerPermissionReadonly)
	}
	return floretEffectRequest{meta: meta, req: SendUserTurnRequest{
		ClientRequestID: requestKey, ThreadID: childID, Model: strings.TrimSpace(parent.currentModelID),
		Input: RunInput{Text: text}, Options: RunOptions{NoUserInteraction: true, PermissionType: permission},
	}}
}

func (service *Service) ensureChildThreadSettings(ctx context.Context, parent *run, childID, parentID string) error {
	if service == nil || service.threadsDB == nil || parent == nil {
		return errors.New("child thread catalog is unavailable")
	}
	existing, err := service.threadsDB.GetThreadSettingsByCanonicalThreadID(ctxOrBackground(ctx), childID)
	if err != nil || existing != nil {
		return err
	}
	parentSettings, err := service.threadsDB.GetThreadSettings(ctxOrBackground(ctx), parent.endpointID, parentID)
	if err != nil {
		return err
	}
	if parentSettings == nil {
		return sql.ErrNoRows
	}
	child := *parentSettings
	child.ThreadID = childID
	child.ParentThreadID = parentID
	child.PinnedAtUnixMs = 0
	child.SettingsCreatedAtUnixMs = 0
	child.SettingsUpdatedAtUnixMs = 0
	return service.threadsDB.CreateThreadSettings(ctxOrBackground(ctx), child)
}

func (runtime *floretSubagentRuntime) childSummary(ctx context.Context, childID string) (flruntime.ThreadSummary, error) {
	_, parent, threads, err := runtime.boundaries()
	if err != nil {
		return flruntime.ThreadSummary{}, err
	}
	parentID := identity.ThreadID(strings.TrimSpace(parent.threadID))
	items, err := threads.List(ctxOrBackground(ctx), flruntime.ThreadScope{ParentID: &parentID})
	if err != nil {
		return flruntime.ThreadSummary{}, err
	}
	for _, item := range items {
		if item.ID.String() == strings.TrimSpace(childID) {
			return item, nil
		}
	}
	return flruntime.ThreadSummary{}, sql.ErrNoRows
}

func (runtime *floretSubagentRuntime) sendInput(ctx context.Context, toolCallID string, args map[string]any) (map[string]any, error) {
	service, parent, threads, err := runtime.boundaries()
	if err != nil {
		return nil, err
	}
	target := strings.TrimSpace(anyToString(args["target"]))
	message := strings.TrimSpace(anyToString(args["message"]))
	if target == "" || message == "" {
		return nil, errors.New("subagents send_input requires target and message")
	}
	summary, err := runtime.childSummary(ctx, target)
	if err != nil {
		return nil, errors.New("SubAgent target is not owned by the current parent")
	}
	requestKey, err := subagentInputRequestID(parent.threadID, target, toolCallID)
	if err != nil {
		return nil, err
	}
	if parseBoolArg(args, "interrupt", false) {
		if _, err := threads.Cancel(ctxOrBackground(ctx), flruntime.CancelInput{
			ThreadID: summary.ID, RequestKey: flruntime.RequestKey(requestKey + ":cancel"),
		}); err != nil {
			return nil, err
		}
	}
	request := runtime.childEffectRequest(parent, target, requestKey, message, summary.HostProfileRef)
	service.floretEffects.put(summary.ID, requestKey, request)
	result, err := threads.Send(ctxOrBackground(ctx), flruntime.SendInput{
		ThreadID: summary.ID, Input: flruntime.UserInput{Text: message}, RequestKey: flruntime.RequestKey(requestKey),
	})
	if err != nil {
		service.floretEffects.drop(summary.ID, requestKey)
		return nil, err
	}
	snapshot, err := runtime.snapshotForView(ctx, result)
	if err != nil {
		return nil, err
	}
	runtime.publishParent(ctx)
	return trimSubagentToolResult(map[string]any{
		"status": "ok", "action": subagentActionSendInput, "target": target,
		"thread_id": target, "accepted": true,
		"items": []map[string]any{boundedSubagentItem(subagentSnapshotPayload(snapshot))},
	}), nil
}

func (runtime *floretSubagentRuntime) close(ctx context.Context, toolCallID string, args map[string]any) (map[string]any, error) {
	_, parent, threads, err := runtime.boundaries()
	if err != nil {
		return nil, err
	}
	target := strings.TrimSpace(anyToString(args["target"]))
	summary, err := runtime.childSummary(ctx, target)
	if err != nil {
		return nil, err
	}
	result, err := threads.Cancel(ctxOrBackground(ctx), flruntime.CancelInput{
		ThreadID:   summary.ID,
		RequestKey: flruntime.RequestKey(subagentCloseOperationID(parent.threadID, target, "user_close", toolCallID)),
	})
	if err != nil {
		return nil, err
	}
	snapshot, err := runtime.snapshotForView(ctx, result)
	if err != nil {
		return nil, err
	}
	runtime.publishParent(ctx)
	return trimSubagentToolResult(map[string]any{
		"status": "ok", "action": subagentActionClose, "target": target,
		"thread_id": target, "closed": true, "stopped": true,
		"items": []map[string]any{boundedSubagentItem(subagentSnapshotPayload(snapshot))},
	}), nil
}

func (runtime *floretSubagentRuntime) closeAll(ctx context.Context, toolCallID string, _ map[string]any) (map[string]any, error) {
	_, parent, threads, err := runtime.boundaries()
	if err != nil {
		return nil, err
	}
	snapshots, err := runtime.snapshots(ctx)
	if err != nil {
		return nil, err
	}
	items := make([]map[string]any, 0, len(snapshots))
	affected := make([]string, 0, len(snapshots))
	for _, snapshot := range snapshots {
		if !isSubagentTerminalStatus(snapshot.Status) {
			result, cancelErr := threads.Cancel(ctxOrBackground(ctx), flruntime.CancelInput{
				ThreadID:   identity.ThreadID(snapshot.ThreadID),
				RequestKey: flruntime.RequestKey(subagentCloseOperationID(parent.threadID, snapshot.ThreadID, "parent_close_all", toolCallID)),
			})
			if cancelErr != nil {
				return nil, cancelErr
			}
			snapshot, err = runtime.snapshotForView(ctx, result)
			if err != nil {
				return nil, err
			}
		}
		affected = append(affected, snapshot.ThreadID)
		items = append(items, boundedSubagentItem(subagentSnapshotPayload(snapshot)))
	}
	runtime.publishParent(ctx)
	out := subagentBoundedResult(subagentActionCloseAll, items)
	out["scope"] = "current_run"
	out["closed_count"] = len(affected)
	out["stopped_count"] = len(affected)
	out["affected_ids"] = affected
	return trimSubagentToolResult(out), nil
}

func (runtime *floretSubagentRuntime) wait(ctx context.Context, args map[string]any) (map[string]any, error) {
	_, _, threads, err := runtime.boundaries()
	if err != nil {
		return nil, err
	}
	requested, effective, source := subagentTimeoutDecision(args)
	targets := normalizeSubagentThreadIDs(args["ids"])
	waitCtx, cancel := context.WithTimeout(ctxOrBackground(ctx), time.Duration(effective)*time.Millisecond)
	defer cancel()
	subscription, err := threads.Subscribe(waitCtx)
	if err != nil {
		return nil, err
	}
	defer subscription.Close()
	timedOut := false
	var snapshots []subagentSnapshot
	for {
		snapshots, err = runtime.snapshots(waitCtx)
		if err != nil {
			if errors.Is(err, context.DeadlineExceeded) {
				timedOut = true
				break
			}
			return nil, err
		}
		selected := selectSubagentSnapshots(snapshots, targets)
		if allSubagentsTerminal(selected) {
			snapshots = selected
			break
		}
		if _, err = subscription.Next(waitCtx); err != nil {
			if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
				timedOut = true
				snapshots = selected
				break
			}
			return nil, err
		}
	}
	items := boundedSubagentStatusItems(snapshots)
	out := map[string]any{
		"status": "ok", "action": subagentActionWait, "ids": targets, "target_ids": targets,
		"requested_timeout_ms": requested, "effective_timeout_ms": effective,
		"timeout_ms": effective, "timeout_source": source, "timed_out": timedOut,
		"detail_omitted": true, "detail_strategy": "thread_view", "items": items,
		"counts": subagentModelStatusCounts(items), "agent_count": len(items),
	}
	return trimSubagentToolResult(out), nil
}

func selectSubagentSnapshots(items []subagentSnapshot, targets []string) []subagentSnapshot {
	if len(targets) == 0 {
		return items
	}
	wanted := make(map[string]struct{}, len(targets))
	for _, target := range targets {
		wanted[strings.TrimSpace(target)] = struct{}{}
	}
	out := make([]subagentSnapshot, 0, len(targets))
	for _, item := range items {
		if _, ok := wanted[item.ThreadID]; ok {
			out = append(out, item)
		}
	}
	return out
}

func allSubagentsTerminal(items []subagentSnapshot) bool {
	for _, item := range items {
		if !isSubagentTerminalStatus(item.Status) {
			return false
		}
	}
	return true
}

func (runtime *floretSubagentRuntime) list(ctx context.Context, args map[string]any) (map[string]any, error) {
	snapshots, err := runtime.snapshots(ctx)
	if err != nil {
		return nil, err
	}
	runningOnly := parseBoolArg(args, "running_only", false)
	limit := parseIntArg(args, "limit", 50)
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	items := make([]map[string]any, 0, len(snapshots))
	for _, snapshot := range snapshots {
		if runningOnly && isSubagentTerminalStatus(snapshot.Status) {
			continue
		}
		items = append(items, subagentListPayload(snapshot))
		if len(items) == limit {
			break
		}
	}
	out := subagentBoundedResult(subagentActionList, items)
	out["total"] = len(snapshots)
	out["running_only"] = runningOnly
	out["updated_at_unix_ms"] = time.Now().UnixMilli()
	return trimSubagentToolResult(out), nil
}

func (runtime *floretSubagentRuntime) inspect(ctx context.Context, args map[string]any) (map[string]any, error) {
	targets := collectInspectTargets(args)
	snapshots, err := runtime.snapshots(ctx)
	if err != nil {
		return nil, err
	}
	selected := selectSubagentSnapshots(snapshots, targets)
	items := make([]map[string]any, 0, len(selected))
	for _, snapshot := range selected {
		items = append(items, boundedSubagentItem(subagentSnapshotPayload(snapshot)))
	}
	out := subagentBoundedResult(subagentActionInspect, items)
	out["requested_ids"] = targets
	out["requested_count"] = len(targets)
	out["found_count"] = len(items)
	out["missing_count"] = len(targets) - len(items)
	if len(items) == 0 {
		out["status"] = "not_found"
	} else if len(items) != len(targets) {
		out["status"] = "partial"
	}
	return trimSubagentToolResult(out), nil
}

func (runtime *floretSubagentRuntime) snapshots(ctx context.Context) ([]subagentSnapshot, error) {
	_, parent, threads, err := runtime.boundaries()
	if err != nil {
		return nil, err
	}
	parentID := identity.ThreadID(strings.TrimSpace(parent.threadID))
	summaries, err := threads.List(ctxOrBackground(ctx), flruntime.ThreadScope{ParentID: &parentID})
	if err != nil {
		return nil, err
	}
	out := make([]subagentSnapshot, 0, len(summaries))
	for _, summary := range summaries {
		view, viewErr := threads.View(ctxOrBackground(ctx), summary.ID)
		if viewErr != nil {
			return nil, viewErr
		}
		out = append(out, subagentSnapshotFromThread(summary, view))
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].UpdatedAtMS == out[j].UpdatedAtMS {
			return out[i].CreatedAtMS > out[j].CreatedAtMS
		}
		return out[i].UpdatedAtMS > out[j].UpdatedAtMS
	})
	return out, nil
}

func (runtime *floretSubagentRuntime) snapshotForView(ctx context.Context, view flruntime.ThreadView) (subagentSnapshot, error) {
	summary, err := runtime.childSummary(ctx, view.ThreadID.String())
	if err != nil {
		return subagentSnapshot{}, err
	}
	return subagentSnapshotFromThread(summary, view), nil
}

func subagentSnapshotFromThread(summary flruntime.ThreadSummary, view flruntime.ThreadView) subagentSnapshot {
	status := subagentStatusQueued
	closed := false
	switch {
	case view.Attention.InputCount > 0 || view.Attention.ApprovalCount > 0:
		status = subagentStatusWaiting
	case view.Activity == flruntime.ThreadActivityActive:
		status = subagentStatusRunning
	case view.LastOutcome == nil:
		status = subagentStatusQueued
	case *view.LastOutcome == flruntime.TurnOutcomeCompleted:
		status, closed = subagentStatusCompleted, true
	case *view.LastOutcome == flruntime.TurnOutcomeCancelled || *view.LastOutcome == flruntime.TurnOutcomeInterrupted:
		status, closed = subagentStatusCanceled, true
	default:
		status, closed = subagentStatusFailed, true
	}
	lastMessage := ""
	for index := len(view.Items) - 1; index >= 0; index-- {
		if text := strings.TrimSpace(view.Items[index].Text); text != "" {
			lastMessage = text
			break
		}
	}
	waitingPrompt := ""
	for _, interaction := range view.Interactions {
		if !interaction.Resolved && interaction.Input != nil {
			waitingPrompt = strings.TrimSpace(interaction.Input.Summary)
			break
		}
	}
	return subagentSnapshot{
		ThreadID: summary.ID.String(), TaskName: summary.TaskName, TaskDescription: summary.TaskDescription,
		ParentThreadID: summary.ParentThreadID.String(), ParentTurnID: summary.ParentTurnID.String(),
		AgentType: normalizeSubagentAgentType(summary.HostProfileRef), ContextMode: normalizeSubagentContextMode(summary.ForkMode),
		Status: status, LatestTurnID: view.TurnID.String(), LastMessage: lastMessage, WaitingPrompt: waitingPrompt,
		QueuedInputs: len(view.Queue), CreatedAtMS: timeUnixMS(summary.CreatedAt), UpdatedAtMS: timeUnixMS(summary.UpdatedAt),
		Closed: closed, CanSendInput: !closed, CanInterrupt: view.Activity == flruntime.ThreadActivityActive,
		CanClose: !closed,
	}
}

func (runtime *floretSubagentRuntime) publishParent(ctx context.Context) {
	service, parent, _, err := runtime.boundaries()
	if err == nil {
		service.broadcastThreadSummary(parent.endpointID, parent.threadID)
	}
}

func (runtime *floretSubagentRuntime) release() {
	if runtime == nil {
		return
	}
	runtime.mu.Lock()
	runtime.closed = true
	runtime.parent = nil
	runtime.service = nil
	runtime.mu.Unlock()
}

func (runtime *floretSubagentRuntime) closeAllExisting(ctx context.Context) error {
	_, err := runtime.closeAll(ctx, "runtime_close", nil)
	return err
}

func (runtime *floretSubagentRuntime) refreshSubagentsPatch(ctx context.Context, _ ...subagentSnapshot) {
	runtime.publishParent(ctx)
}

func (service *Service) ListFlowerSubagents(ctx context.Context, meta *session.Meta, parentThreadID string) ([]FlowerSubagentSummary, error) {
	if service == nil {
		return nil, errors.New("nil service")
	}
	if err := requireRead(meta); err != nil {
		return nil, err
	}
	parentThreadID = strings.TrimSpace(parentThreadID)
	if parentThreadID == "" || strings.TrimSpace(meta.EndpointID) == "" {
		return nil, errors.New("invalid request")
	}
	settings, err := service.threadsDB.GetThreadSettings(ctxOrBackground(ctx), meta.EndpointID, parentThreadID)
	if err != nil || settings == nil {
		if err == nil {
			err = sql.ErrNoRows
		}
		return nil, err
	}
	return service.listFlowerSubagentsForParent(ctx, identity.ThreadID(parentThreadID))
}

func (service *Service) listFlowerSubagentsForParent(ctx context.Context, parentID identity.ThreadID) ([]FlowerSubagentSummary, error) {
	if service == nil || service.threadRuntime == nil || strings.TrimSpace(parentID.String()) == "" {
		return nil, errors.New("invalid child thread inventory request")
	}
	summaries, err := service.threadRuntime.List(ctxOrBackground(ctx), flruntime.ThreadScope{ParentID: &parentID})
	if err != nil {
		return nil, err
	}
	out := make([]FlowerSubagentSummary, 0, len(summaries))
	for _, summary := range summaries {
		view, viewErr := service.threadRuntime.View(ctxOrBackground(ctx), summary.ID)
		if viewErr != nil {
			return nil, viewErr
		}
		out = append(out, flowerSubagentSummaryFromSnapshot(subagentSnapshotFromThread(summary, view)))
	}
	return out, nil
}

func flowerSubagentSummaryFromSnapshot(snapshot subagentSnapshot) FlowerSubagentSummary {
	return FlowerSubagentSummary{
		ParentThreadID: snapshot.ParentThreadID, ThreadID: snapshot.ThreadID,
		TaskName: snapshot.TaskName, TaskDescription: snapshot.TaskDescription,
		AgentType: snapshot.AgentType, ContextMode: snapshot.ContextMode, Status: snapshot.Status,
		LastMessage: snapshot.LastMessage, WaitingPrompt: snapshot.WaitingPrompt, QueuedInputs: snapshot.QueuedInputs,
		CanSendInput: snapshot.CanSendInput, CanInterrupt: snapshot.CanInterrupt, CanClose: snapshot.CanClose,
		CreatedAtUnixMs: snapshot.CreatedAtMS, UpdatedAtUnixMs: snapshot.UpdatedAtMS,
	}
}

func (service *Service) publishFlowerSubagentsPatch(ctx context.Context, endpointID, parentThreadID string) {
	if service != nil {
		service.broadcastThreadSummary(strings.TrimSpace(endpointID), strings.TrimSpace(parentThreadID))
	}
}

func (service *Service) GetFlowerSubagentDetail(ctx context.Context, meta *session.Meta, parentThreadID, childThreadID string, afterOrdinal int64, limit int) (*FlowerSubagentDetailResponse, error) {
	if service == nil {
		return nil, errors.New("nil service")
	}
	if err := requireRead(meta); err != nil {
		return nil, err
	}
	parentThreadID, childThreadID = strings.TrimSpace(parentThreadID), strings.TrimSpace(childThreadID)
	if parentThreadID == "" || childThreadID == "" || afterOrdinal < 0 {
		return nil, errors.New("invalid request")
	}
	parentID := identity.ThreadID(parentThreadID)
	summaries, err := service.threadRuntime.List(ctxOrBackground(ctx), flruntime.ThreadScope{ParentID: &parentID})
	if err != nil {
		return nil, err
	}
	var summary *flruntime.ThreadSummary
	for index := range summaries {
		if summaries[index].ID.String() == childThreadID {
			summary = &summaries[index]
			break
		}
	}
	if summary == nil {
		return nil, sql.ErrNoRows
	}
	view, err := service.threadRuntime.View(ctxOrBackground(ctx), summary.ID)
	if err != nil {
		return nil, err
	}
	snapshot := subagentSnapshotFromThread(*summary, view)
	messages := make([]FlowerTimelineMessage, 0, len(view.Items)+1)
	rows := make([]FlowerSubagentTimelineRow, 0, len(view.Items)+1)
	for _, item := range view.Items {
		if item.Kind != flruntime.ThreadItemUser && item.Kind != flruntime.ThreadItemAssistant {
			continue
		}
		role := "user"
		if item.Kind == flruntime.ThreadItemAssistant {
			role = "assistant"
		}
		message := FlowerTimelineMessage{
			MessageID: item.ID, ThreadID: childThreadID, TurnID: item.TurnID.String(), Role: role,
			Content: item.Text, Status: "success", Live: false, ActiveCursor: false,
		}
		messages = append(messages, message)
		rows = append(rows, FlowerSubagentTimelineRow{
			Ordinal: int64(len(rows) + 1), Kind: "message", Type: role,
			Message: &FlowerSubagentDetailMessage{Role: role, Text: item.Text, Preview: truncateRunes(item.Text, 240)},
		})
	}
	if draft := strings.TrimSpace(view.AssistantDraft); draft != "" {
		messages = append(messages, FlowerTimelineMessage{
			MessageID: "draft:" + view.TurnID.String(), ThreadID: childThreadID, TurnID: view.TurnID.String(),
			Role: "assistant", Content: draft, Status: "streaming", Live: true, ActiveCursor: true,
		})
	}
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	start := int(afterOrdinal)
	if start > len(rows) {
		start = len(rows)
	}
	end := start + limit
	if end > len(rows) {
		end = len(rows)
	}
	return &FlowerSubagentDetailResponse{
		Summary: flowerSubagentSummaryFromSnapshot(snapshot), Messages: messages, Timeline: rows[start:end],
		NextOrdinal: int64(end), HasMore: end < len(rows), RetainedFrom: 0, GeneratedAtMs: time.Now().UnixMilli(),
	}, nil
}

func subagentBoundedResult(action string, items []map[string]any) map[string]any {
	return map[string]any{"status": "ok", "action": action, "items": boundedSubagentItems(items)}
}

func boundedSubagentItems(items []map[string]any) []map[string]any {
	if items == nil {
		return []map[string]any{}
	}
	if len(items) > 200 {
		items = items[:200]
	}
	return items
}

func boundedSubagentStatusItems(snapshots []subagentSnapshot) []map[string]any {
	items := make([]map[string]any, 0, len(snapshots))
	for _, snapshot := range snapshots {
		items = append(items, boundedSubagentItem(subagentSnapshotPayload(snapshot)))
	}
	return items
}

func boundedSubagentItem(item map[string]any) map[string]any {
	if item == nil {
		return map[string]any{}
	}
	out := make(map[string]any, len(item))
	for key, value := range item {
		out[key] = value
	}
	for _, key := range []string{"last_message", "waiting_prompt", "task_description"} {
		out[key] = truncateRunes(strings.TrimSpace(anyToString(out[key])), 600)
	}
	return out
}

func trimSubagentToolResult(out map[string]any) map[string]any { return out }

func subagentTimeoutDecision(args map[string]any) (int, int, string) {
	requested := parseIntArg(args, "timeout_ms", 0)
	if requested <= 0 {
		return requested, subagentDefaultTimeoutMS, "default"
	}
	if requested > subagentMaxTimeoutMS {
		return requested, subagentMaxTimeoutMS, "clamped"
	}
	return requested, requested, "requested"
}

func normalizeSubagentContextMode(raw string) string {
	if strings.EqualFold(strings.TrimSpace(raw), subagentContextModeFullHistory) {
		return subagentContextModeFullHistory
	}
	return subagentContextModeMissionOnly
}

func normalizeSubagentAgentType(raw string) string {
	value := strings.ToLower(strings.TrimSpace(raw))
	switch value {
	case subagentAgentTypeExplore, subagentAgentTypeWorker, subagentAgentTypeReviewer:
		return value
	default:
		return subagentAgentTypeExplore
	}
}

func isValidSubagentAgentType(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	return value == subagentAgentTypeExplore || value == subagentAgentTypeWorker || value == subagentAgentTypeReviewer
}

func isSubagentTerminalStatus(status string) bool {
	switch strings.TrimSpace(status) {
	case subagentStatusCompleted, subagentStatusFailed, subagentStatusCanceled, subagentStatusTimedOut:
		return true
	default:
		return false
	}
}

func subagentSnapshotPayload(snapshot subagentSnapshot) map[string]any {
	return map[string]any{
		"id": snapshot.ThreadID, "thread_id": snapshot.ThreadID, "agent_type": snapshot.AgentType,
		"context_mode": snapshot.ContextMode, "task_name": snapshot.TaskName,
		"task_description": snapshot.TaskDescription, "status": snapshot.Status,
		"last_message": snapshot.LastMessage, "waiting_prompt": snapshot.WaitingPrompt,
		"queued_inputs": snapshot.QueuedInputs, "parent_thread_id": snapshot.ParentThreadID,
		"parent_turn_id": snapshot.ParentTurnID, "latest_turn_id": snapshot.LatestTurnID,
		"started_at_ms": snapshot.CreatedAtMS, "created_at_ms": snapshot.CreatedAtMS,
		"updated_at_ms": snapshot.UpdatedAtMS, "closed": snapshot.Closed,
		"can_send_input": snapshot.CanSendInput, "can_interrupt": snapshot.CanInterrupt,
		"can_close": snapshot.CanClose,
	}
}

func subagentListPayload(snapshot subagentSnapshot) map[string]any {
	payload := subagentSnapshotPayload(snapshot)
	return map[string]any{
		"thread_id": payload["thread_id"], "task_name": payload["task_name"],
		"task_description": payload["task_description"], "agent_type": payload["agent_type"],
		"context_mode": payload["context_mode"], "status": payload["status"],
		"updated_at_ms": payload["updated_at_ms"], "last_message": payload["last_message"],
		"can_send_input": payload["can_send_input"], "can_interrupt": payload["can_interrupt"],
		"can_close": payload["can_close"],
	}
}

func subagentModelStatusCounts(items []map[string]any) map[string]int {
	out := map[string]int{}
	for _, item := range items {
		out[strings.TrimSpace(anyToString(item["status"]))]++
	}
	return out
}

func timeUnixMS(value time.Time) int64 {
	if value.IsZero() {
		return 0
	}
	return value.UnixMilli()
}

func subagentCloseOperationID(parentThreadID, childThreadID, reason, seed string) string {
	return subagentStableID("subagent_close_", parentThreadID, childThreadID, reason, seed)
}

func subagentPublicationID(parentThreadID, parentTurnID, toolCallID string) (string, error) {
	if strings.TrimSpace(parentThreadID) == "" || strings.TrimSpace(parentTurnID) == "" || strings.TrimSpace(toolCallID) == "" {
		return "", errors.New("SubAgent publication identity is incomplete")
	}
	return subagentStableID("subagent_publication_", parentThreadID, parentTurnID, toolCallID), nil
}

func subagentInputRequestID(parentThreadID, childThreadID, toolCallID string) (string, error) {
	if strings.TrimSpace(parentThreadID) == "" || strings.TrimSpace(childThreadID) == "" || strings.TrimSpace(toolCallID) == "" {
		return "", errors.New("SubAgent input request identity is incomplete")
	}
	return subagentStableID("subagent_input_", parentThreadID, childThreadID, toolCallID), nil
}

func subagentStableID(prefix string, values ...string) string {
	for index := range values {
		values[index] = strings.TrimSpace(values[index])
	}
	sum := sha256.Sum256([]byte(strings.Join(values, "\x00")))
	return prefix + hex.EncodeToString(sum[:18])
}

type flowerSubagentPromptSpec struct {
	AgentType   string
	TaskName    string
	Message     string
	ContextMode string
	Contract    subagentCapabilityContract
}

func buildFlowerSubagentPrompt(spec flowerSubagentPromptSpec) string {
	lines := []string{
		"# Delegated Mission", strings.TrimSpace(spec.Message), "", "# Role",
		subagentRolePrompt(spec.AgentType), "", "# Operating Contract",
		"- You are working for the parent Flower thread, not directly for the end user.",
		"- Finish the delegated slice independently and verify concrete claims with tools when needed.",
		"- Do not delegate, spawn child work, or ask the user for input.",
		"- Return a focused final handoff with summary, evidence, verification, open risks, and parent actions.",
	}
	if normalizeSubagentContextMode(spec.ContextMode) == subagentContextModeFullHistory {
		lines = append(lines, "- Use the inherited parent history only when it is relevant to this mission.")
	} else {
		lines = append(lines, "- Work from this mission and current evidence; parent history is not included.")
	}
	if len(spec.Contract.VisibleTools) > 0 {
		lines = append(lines, "- Available tools: "+strings.Join(spec.Contract.VisibleTools, ", "))
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}

func subagentRolePrompt(agentType string) string {
	switch normalizeSubagentAgentType(agentType) {
	case subagentAgentTypeWorker:
		return "Worker: implement or verify the assigned slice within the parent policy."
	case subagentAgentTypeReviewer:
		return "Reviewer: independently inspect evidence and report precise, actionable findings."
	default:
		return "Explorer: investigate the bounded question and report findings without changing the workspace."
	}
}
