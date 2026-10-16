package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v7/config"
	"github.com/floegence/floret/v7/florettest"
	"github.com/floegence/floret/v7/identity"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/storage"
	fltools "github.com/floegence/floret/v7/tools"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

// Only explicit management reads may consult the child inventory. No child runs.
type delegationContextThreadService struct {
	flruntime.ThreadService
	summaries []flruntime.ThreadSummary
	readErr   error
	reads     atomic.Int32
}

func (s *delegationContextThreadService) List(context.Context, flruntime.ThreadScope) ([]flruntime.ThreadSummary, error) {
	s.reads.Add(1)
	return append([]flruntime.ThreadSummary(nil), s.summaries...), s.readErr
}

func delegationContextDone() florettest.Step {
	return florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventDelta, Text: "done"}, {Type: flprovider.EventDone, Reason: "stop"}}}
}

func delegationContextCall(id, args string) florettest.Step {
	return florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventToolCalls, ToolCalls: []flprovider.ToolCall{{ID: id, Name: "subagents", Args: args}}}, {Type: flprovider.EventDone, Reason: "tool_calls"}}}
}

func delegationContextGateway(steps ...florettest.Step) *florettest.ScriptedGateway {
	return florettest.NewScriptedGateway(flprovider.Identity{Provider: "test", Model: "delegation-context", StateCompatibilityKey: "test:delegation-context:v1"}, flprovider.Capabilities{Reasoning: flprovider.ReasoningUnsupported}, steps...)
}

func delegationContextThread(t *testing.T, gateway *florettest.ScriptedGateway, surface flruntime.ToolSurfaceProvider) flruntime.ThreadService {
	t.Helper()
	agent, err := flruntime.NewAgent(flconfig.AgentConfig{
		Profile:      flconfig.AgentProfile{ID: "delegation-context", Name: "Delegation Context"},
		SystemPrompt: "Test Flower context and canonical management results.",
		Context:      flconfig.ContextPolicy{ContextWindowTokens: flconfig.DefaultContextWindowTokens},
	}, gateway, flruntime.WithAgentDynamicToolSurface(surface), flruntime.WithAgentEffectAuthorization(floretAllowTestEffect))
	if err != nil {
		t.Fatal(err)
	}
	host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: storage.Memory()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = host.Shutdown(context.Background()) })
	service, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) { return agent, nil }))
	if err != nil {
		t.Fatal(err)
	}
	return service
}

func delegationContextSend(t *testing.T, service flruntime.ThreadService, threadID identity.ThreadID, key string, snapshot *flruntime.ModelContextSnapshot) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	updates, err := service.Subscribe(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer updates.Close()
	if _, err := service.Send(ctx, flruntime.SendInput{ThreadID: threadID, RequestKey: flruntime.RequestKey(key), Input: flruntime.UserInput{Text: key, ModelContextSnapshot: snapshot}}); err != nil {
		t.Fatal(err)
	}
	for {
		view, err := service.View(ctx, threadID)
		if err != nil {
			t.Fatal(err)
		}
		if view.Activity == flruntime.ThreadActivityIdle {
			if view.LastOutcome == nil || *view.LastOutcome != flruntime.TurnOutcomeCompleted {
				t.Fatalf("turn outcome=%v failure=%+v", view.LastOutcome, view.Failure)
			}
			return
		}
		if _, err := updates.Next(ctx); err != nil {
			t.Fatal(err)
		}
	}
}

func delegationContextUpdates(request flprovider.Request) []string {
	var out []string
	for _, message := range request.Messages {
		if message.Role == flprovider.RoleUser && strings.HasPrefix(message.Text, "Model context update (") {
			out = append(out, message.Text)
		}
	}
	return out
}

func TestFlowerProviderContextIgnoresChildInventoryChanges(t *testing.T) {
	root := t.TempDir()
	children := &delegationContextThreadService{}
	r := newRun(runOptions{WorkingDir: root, AgentHomeDir: root, Shell: "/bin/sh", RunID: "run-context", ThreadID: "thread-parent"})
	r.ensureSkillManager().userHome = root
	r.subagentRuntime = newServiceFloretSubagentRuntime(&Service{threadRuntime: children}, r)
	r.product.currentSettings = func(context.Context) (*threadstore.ThreadSettings, error) {
		return &threadstore.ThreadSettings{PermissionType: string(FlowerPermissionFullAccess)}, nil
	}
	now := time.Unix(0, 0)
	for index := range 5 {
		children.summaries = append(children.summaries, flruntime.ThreadSummary{ID: identity.ThreadID(fmt.Sprintf("child-%d", index)), TaskName: fmt.Sprintf("CHILD_TASK_%d", index), Activity: flruntime.ThreadActivityActive, CreatedAt: now, UpdatedAt: now.Add(time.Duration(index) * time.Second), LastItemPreview: "CHILD_PREVIEW_INITIAL"})
	}
	steps := []struct {
		name   string
		change func()
	}{
		{"initial", func() {}},
		{"running_preview_one", func() { children.summaries[0].LastItemPreview = "CHILD_PREVIEW_ONE" }},
		{"running_preview_two", func() { children.summaries[4].LastItemPreview = "CHILD_PREVIEW_TWO" }},
		{"preview_selection", func() {
			children.summaries[0].UpdatedAt = time.Unix(100, 0)
			children.summaries[1].UpdatedAt = time.Unix(200, 0)
		}},
		{"alternating_order", func() {
			children.summaries[4].UpdatedAt = time.Unix(300, 0)
			children.summaries[2].LastItemPreview = "CHILD_PREVIEW_THREE"
		}},
		{"counts_and_states", func() {
			completed := flruntime.TurnOutcomeCompleted
			children.summaries[0].Activity = flruntime.ThreadActivityIdle
			children.summaries[0].LastOutcome = &completed
			children.summaries[1].Attention.InputCount = 1
			children.summaries = children.summaries[:4]
		}},
		{"read_failure", func() { children.readErr = errors.New("PRIVATE_CHILD_READ_ERROR_ONE") }},
		{"changed_error", func() { children.readErr = errors.New("PRIVATE_CHILD_READ_ERROR_TWO") }},
		{"read_recovery", func() { children.readErr = nil }},
	}
	providerSteps := make([]florettest.Step, len(steps))
	for index := range providerSteps {
		providerSteps[index] = florettest.Step{Events: []flprovider.Event{
			{Type: flprovider.EventToolCalls, ToolCalls: []flprovider.ToolCall{{ID: fmt.Sprintf("advance-%d", index), Name: "advance_fixture", Args: fmt.Sprintf("{\"step\":%d}", index)}}},
			{Type: flprovider.EventDone, Reason: "tool_calls"},
		}}
	}
	providerSteps[len(providerSteps)-1] = delegationContextDone()
	stepIndex := 0
	advance := fltools.Define[map[string]any](fltools.Definition{Name: "advance_fixture", InputSchema: fltools.StrictObject(map[string]any{"step": map[string]any{"type": "integer"}}, []string{"step"}), Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}}, nil, nil, func(context.Context, fltools.Invocation[map[string]any]) (fltools.Result, error) {
		stepIndex++
		steps[stepIndex].change()
		return fltools.Result{Text: fmt.Sprintf("fixture advanced to %d", stepIndex)}, nil
	})
	liveSurface := r.liveFloretToolSurface(runToolSurfaceConfig{})
	gateway := delegationContextGateway(providerSteps...)
	service := delegationContextThread(t, gateway, func(ctx context.Context, request flruntime.ToolSurfaceRequest) (flruntime.ToolSurface, error) {
		surface, err := liveSurface(ctx, request)
		if err != nil {
			return flruntime.ToolSurface{}, err
		}
		if err := surface.Tools.Register(advance); err != nil {
			return flruntime.ToolSurface{}, err
		}
		return surface, nil
	})
	created, err := service.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "create"})
	if err != nil {
		t.Fatal(err)
	}
	delegationContextSend(t, service, created.ThreadID, "observe-context-churn", nil)
	requests := gateway.Requests()
	if len(requests) != len(steps) || stepIndex != len(steps)-1 {
		t.Fatalf("requests=%d fixture changes=%d", len(requests), stepIndex)
	}
	var baseline []string
	for index, step := range steps {
		updates := delegationContextUpdates(requests[index])
		if index == 0 {
			baseline = updates
		}
		if len(updates) != 1 || !reflect.DeepEqual(updates, baseline) {
			t.Fatalf("%s: child change appended model context: %v", step.name, updates)
		}
		for _, forbidden := range []string{"Delegation state", "Subagent counts:", "Active subagent", "CHILD_TASK_", "CHILD_PREVIEW_", "PRIVATE_CHILD_READ_ERROR", "objective:"} {
			for _, message := range requests[index].Messages {
				if strings.Contains(message.Text, forbidden) {
					t.Fatalf("%s: provider received %q", step.name, forbidden)
				}
			}
		}
		if !strings.Contains(updates[0], "Subagent delegation available: true") {
			t.Fatal("delegation capability was lost")
		}
		var hasTool bool
		for _, def := range requests[index].Tools {
			if def.Name == "subagents" {
				hasTool = true
			}
		}
		if !hasTool {
			t.Fatal("subagents tool definition was lost")
		}
	}
	if got := children.reads.Load(); got != 0 {
		t.Fatalf("provider preparation read child inventory %d times", got)
	}
}

func TestFlowerProviderContextRemovesExistingDelegationOnce(t *testing.T) {
	root := t.TempDir()
	r := newRun(runOptions{WorkingDir: root, AgentHomeDir: root})
	r.ensureSkillManager().userHome = root
	now := func() time.Time { return time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC) }
	previous, err := r.collectModelContextSnapshot(t.Context(), FlowerPermissionFullAccess, now)
	if err != nil {
		t.Fatal(err)
	}
	previous.Sections = append(previous.Sections, flruntime.ModelContextSection{Key: "delegation", Title: "Delegation state", Text: "OLD_CHILD_OVERVIEW"})
	var upgraded atomic.Bool
	gateway := delegationContextGateway(delegationContextDone(), delegationContextDone(), delegationContextDone())
	service := delegationContextThread(t, gateway, func(ctx context.Context, request flruntime.ToolSurfaceRequest) (flruntime.ToolSurface, error) {
		if !upgraded.Load() {
			return flruntime.ToolSurface{ModelContextSnapshot: previous}, nil
		}
		snapshot, err := r.collectModelContextSnapshot(ctx, FlowerPermissionFullAccess, now)
		return flruntime.ToolSurface{ModelContextSnapshot: snapshot}, err
	})
	created, err := service.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "create-existing"})
	if err != nil {
		t.Fatal(err)
	}
	delegationContextSend(t, service, created.ThreadID, "before-upgrade", previous)
	before := gateway.Requests()[0]
	upgraded.Store(true)
	delegationContextSend(t, service, created.ThreadID, "after-upgrade", nil)
	delegationContextSend(t, service, created.ThreadID, "unchanged", nil)
	requests := gateway.Requests()
	if len(requests) != 3 {
		t.Fatalf("requests=%d", len(requests))
	}
	old := delegationContextUpdates(before)
	if len(old) != 1 || !strings.Contains(old[0], "OLD_CHILD_OVERVIEW") {
		t.Fatalf("old context=%v", old)
	}
	for index, request := range requests[1:] {
		updates := delegationContextUpdates(request)
		if len(updates) != 2 || updates[0] != old[0] {
			t.Fatalf("request %d rewrote history or repeated removal: %v", index+1, updates)
		}
		var delta struct {
			Sections []flruntime.ModelContextSection
			Removed  []string
		}
		if err := json.Unmarshal([]byte(strings.SplitN(updates[1], "\n", 2)[1]), &delta); err != nil {
			t.Fatal(err)
		}
		if len(delta.Sections) != 0 || !reflect.DeepEqual(delta.Removed, []string{"delegation"}) {
			t.Fatalf("removal=%+v", delta)
		}
	}
	current, err := service.(flruntime.ThreadContextReader).Context(t.Context(), created.ThreadID)
	if err != nil || current.ModelContext == nil {
		t.Fatalf("current context=%+v err=%v", current.ModelContext, err)
	}
	for _, section := range current.ModelContext.Snapshot.Sections {
		if section.Key == "delegation" {
			t.Fatal("delegation remains current")
		}
	}
}

func TestFlowerProviderContextKeepsCapabilityAndPermissionRefresh(t *testing.T) {
	root := t.TempDir()
	r := newRun(runOptions{WorkingDir: root, AgentHomeDir: root, RunID: "run-permissions", ThreadID: "thread-permissions"})
	r.ensureSkillManager().userHome = root
	permission := FlowerPermissionFullAccess
	r.product.currentSettings = func(context.Context) (*threadstore.ThreadSettings, error) {
		return &threadstore.ThreadSettings{PermissionType: string(permission)}, nil
	}
	gateway := delegationContextGateway(delegationContextDone(), delegationContextDone(), delegationContextDone())
	service := delegationContextThread(t, gateway, r.liveFloretToolSurface(runToolSurfaceConfig{}))
	created, err := service.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "create-permissions"})
	if err != nil {
		t.Fatal(err)
	}
	delegationContextSend(t, service, created.ThreadID, "enabled", nil)
	r.allowSubagentDelegate = false
	permission = FlowerPermissionReadonly
	delegationContextSend(t, service, created.ThreadID, "restricted", nil)
	delegationContextSend(t, service, created.ThreadID, "still-restricted", nil)
	requests := gateway.Requests()
	for index, request := range requests {
		hasSubagents := false
		for _, def := range request.Tools {
			if def.Name == "subagents" {
				hasSubagents = true
				if !strings.Contains(def.Description, "handoffs[].content") {
					t.Fatal("handoff tool contract lost")
				}
			}
		}
		if hasSubagents != (index == 0) {
			t.Fatalf("request %d: subagents=%t", index, hasSubagents)
		}
		updates := delegationContextUpdates(request)
		if index == 0 {
			if len(updates) != 1 || !strings.Contains(updates[0], "Subagent delegation available: true") {
				t.Fatalf("initial facts=%v", updates)
			}
		} else {
			if len(updates) != 2 || !strings.Contains(updates[1], "Subagent delegation available: false") || !strings.Contains(updates[1], "Permission type: readonly") {
				t.Fatalf("restricted facts=%v", updates)
			}
			if !strings.Contains(request.Messages[0].Text, "readonly") {
				t.Fatal("permission instructions did not refresh")
			}
			for _, def := range request.Tools {
				if def.Name == "file.write" {
					t.Fatal("readonly request retained file.write")
				}
			}
		}
	}
}

func TestFlowerSubagentResultsReachProviderWithoutAutomaticOverview(t *testing.T) {
	for _, action := range []string{subagentActionList, subagentActionInspect, subagentActionWait} {
		t.Run(action, func(t *testing.T) {
			now := time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC)
			completed := completedSubagentTestSummary("child-completed", "Evidence Review", "FINAL_PREVIEW_ONLY", now)
			completed.TaskDescription = "ACTUAL_TASK_DESCRIPTION"
			final := "EXACT_FINAL_DELIVERY:" + strings.Repeat("evidence ", 1200)
			failed := completedSubagentTestSummary("child-failed", "Failed Review", "failure preview", now)
			failedOutcome := flruntime.TurnOutcomeFailed
			failed.LastOutcome = &failedOutcome
			failed.Failure = &flruntime.ThreadTurnFailure{Code: flruntime.ThreadTurnFailureEffectOutcomeUnknown, Message: "EFFECT_OUTCOME_UNKNOWN_DO_NOT_REPLAY"}
			cancelled := completedSubagentTestSummary("child-cancelled", "Cancelled Review", "cancelled preview", now)
			cancelledOutcome := flruntime.TurnOutcomeCancelled
			cancelled.LastOutcome = &cancelledOutcome
			waiting := completedSubagentTestSummary("child-waiting", "Waiting Review", "waiting preview", now)
			waiting.LastOutcome = nil
			waiting.Activity = flruntime.ThreadActivityActive
			waiting.Attention.InputCount = 1
			waiting.PendingInput = &flruntime.InputPresentation{Summary: "INPUT_REQUIRED_FROM_USER"}
			approval := waiting
			approval.ID = "child-approval"
			approval.Attention.InputCount = 0
			approval.Attention.ApprovalCount = 1
			approval.PendingInput = nil
			adapter, _ := newSubagentHandoffTestAdapter(t, []flruntime.ThreadSummary{completed, failed, cancelled, waiting, approval}, map[identity.ThreadID]flruntime.ThreadView{completed.ID: completedSubagentTestView(completed, final)})
			definition := fltools.Definition{Name: "subagents", InputSchema: fltools.StrictObject(map[string]any{"action": map[string]any{"type": "string"}}, []string{"action"}), Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}}
			tool := fltools.Define[map[string]any](definition, nil, nil, func(ctx context.Context, inv fltools.Invocation[map[string]any]) (fltools.Result, error) {
				data, err := adapter.manage(ctx, inv.CallID, map[string]any{"action": action, "timeout_ms": 1})
				if err != nil {
					return fltools.Result{}, err
				}
				return floretToolResultFromFlower(nil, ToolResult{ToolID: inv.CallID, ToolName: "subagents", Status: toolResultStatusSuccess, Data: data})
			})
			root := t.TempDir()
			r := newRun(runOptions{WorkingDir: root, AgentHomeDir: root})
			r.ensureSkillManager().userHome = root
			r.subagentRuntime = adapter
			args, _ := json.Marshal(map[string]any{"action": action})
			gateway := delegationContextGateway(delegationContextCall("read-children", string(args)), delegationContextDone())
			service := delegationContextThread(t, gateway, func(ctx context.Context, _ flruntime.ToolSurfaceRequest) (flruntime.ToolSurface, error) {
				snapshot, err := r.collectModelContextSnapshot(ctx, FlowerPermissionFullAccess, func() time.Time { return now })
				return flruntime.ToolSurface{Tools: fltools.NewRegistry(tool), ModelContextSnapshot: snapshot}, err
			})
			created, err := service.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "create-results"})
			if err != nil {
				t.Fatal(err)
			}
			delegationContextSend(t, service, created.ThreadID, "read-results", nil)
			requests := gateway.Requests()
			if len(requests) != 2 {
				t.Fatalf("requests=%d", len(requests))
			}
			if updates := delegationContextUpdates(requests[1]); len(updates) != 1 || strings.Contains(updates[0], "Delegation state") {
				t.Fatalf("automatic overview=%v", updates)
			}
			var resultText string
			for _, message := range requests[1].Messages {
				if message.ToolResult != nil && message.ToolResult.CallID == "read-children" {
					resultText = message.ToolResult.Text
				}
			}
			var envelope struct {
				Truncated bool
				Data      json.RawMessage
			}
			if err := json.Unmarshal([]byte(resultText), &envelope); err != nil {
				t.Fatal(err)
			}
			var data struct {
				Items []struct {
					ThreadID           string                       `json:"thread_id"`
					Status             string                       `json:"status"`
					TaskDescription    string                       `json:"task_description"`
					LastMessagePreview string                       `json:"last_message_preview"`
					WaitingPrompt      string                       `json:"waiting_prompt"`
					Failure            *flruntime.ThreadTurnFailure `json:"failure"`
				} `json:"items"`
				Handoffs []struct {
					Content  string `json:"content"`
					ThreadID string `json:"thread_id"`
					TurnID   string `json:"turn_id"`
					RunID    string `json:"run_id"`
				} `json:"handoffs"`
				TimedOut bool `json:"timed_out"`
			}
			if err := json.Unmarshal(envelope.Data, &data); err != nil {
				t.Fatal(err)
			}
			if envelope.Truncated || len(data.Items) != 5 {
				t.Fatalf("lost management result: %s", resultText)
			}
			byID := map[string]int{}
			for index, item := range data.Items {
				byID[item.ThreadID] = index
			}
			if !reflect.DeepEqual(data.Items[byID[failed.ID.String()]].Failure, failed.Failure) || data.Items[byID[cancelled.ID.String()]].Status != subagentStatusCanceled {
				t.Fatalf("failure or cancellation lost: %s", resultText)
			}
			if data.Items[byID[waiting.ID.String()]].Status != subagentStatusWaiting || data.Items[byID[approval.ID.String()]].Status != subagentStatusWaiting {
				t.Fatalf("interaction status lost: %s", resultText)
			}
			item := data.Items[byID[completed.ID.String()]]
			if item.TaskDescription != completed.TaskDescription || item.LastMessagePreview != completed.LastItemPreview {
				t.Fatalf("task description and preview conflated: %+v", item)
			}
			if action != subagentActionList {
				if len(data.Handoffs) != 1 || data.Handoffs[0].Content != final || data.Handoffs[0].ThreadID != completed.ID.String() || data.Handoffs[0].TurnID != completed.TurnID.String() || data.Handoffs[0].RunID != completed.RunID.String() {
					t.Fatal("complete canonical handoff lost in provider request")
				}
				if data.Items[byID[waiting.ID.String()]].WaitingPrompt != "INPUT_REQUIRED_FROM_USER" {
					t.Fatal("input request summary lost")
				}
			}
			if action == subagentActionWait && !data.TimedOut {
				t.Fatal("wait timeout lost")
			}
		})
	}
}
