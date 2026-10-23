package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v7/config"
	"github.com/floegence/floret/v7/florettest"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/storage"
	fltools "github.com/floegence/floret/v7/tools"
)

func TestTerminalReadPublishedFloretRepeatSafety(t *testing.T) {
	for _, tc := range []struct {
		name      string
		waitMS    int64
		mixed     bool
		completed bool
		canceled  bool
	}{
		{name: "quiet waits then exit", waitMS: 10, completed: true},
		{name: "immediate empty reads remain bounded"},
		{name: "wait cannot excuse repeated effect", waitMS: 10, mixed: true},
		{name: "stop interrupts the default wait", waitMS: terminalProcessModelReadWaitMS, canceled: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			process := newTerminalReadWaitTestProcess(4)
			process.command = "git push origin main"
			r := &run{host: runHostCapabilities{terminal: terminalReadWaitTestHost{process: process}}, endpointID: process.endpointID, threadID: process.threadID, sessionMeta: testSendTurnMeta()}
			var terminalDef ToolDef
			for _, candidate := range builtInToolDefinitions() {
				if candidate.Name == "terminal.read" {
					terminalDef = candidate
					break
				}
			}
			snapshot := buildPermissionSnapshot(FlowerPermissionFullAccess, []ToolDef{terminalDef}, nil)
			snapshot.SnapshotID = "terminal-wait-test"
			definition, err := floretToolDefinitionForSnapshot(terminalDef, snapshot)
			if err != nil {
				t.Fatal(err)
			}
			if !definition.ReadOnly || definition.OpenWorld || len(definition.Effects) != 1 || definition.Effects[0] != fltools.EffectRead {
				t.Fatalf("terminal observation has mutating definition: %+v", definition)
			}
			var reads, effects atomic.Int32
			started := make(chan struct{})
			read := fltools.Define[map[string]any](definition, nil, nil, func(ctx context.Context, inv fltools.Invocation[map[string]any]) (fltools.Result, error) {
				count := reads.Add(1)
				if count == 1 {
					close(started)
				}
				if count == 6 {
					process.mu.Lock()
					process.status = terminalProcessStatusSuccess
					process.endedAt = time.Now()
					process.cond.Broadcast()
					process.mu.Unlock()
				}
				if tc.canceled {
					ctx = contextWithToolAuthorizationSnapshot(ctx, snapshot)
					ctx = contextWithFloretToolExecutionAuthorization(ctx, inv.CallID, inv.Name, "read-attempt", snapshot, ApprovalDecisionAllow, true, nil)
					handler := &builtInToolHandler{r: r, toolName: inv.Name}
					result, err := handler.Execute(ctx, ToolCall{ID: inv.CallID, Name: inv.Name, Args: inv.Args})
					if err != nil {
						return fltools.Result{}, err
					}
					return floretToolResultFromFlower(r, result)
				}
				payload, err := r.toolTerminalReadWithWait(ctx, anyToString(inv.Args["process_id"]), readInt64Field(inv.Args, "after_seq"), tc.waitMS)
				if err != nil {
					return fltools.Result{}, err
				}
				return floretToolResultFromFlower(r, ToolResult{ToolID: inv.CallID, ToolName: inv.Name, Status: toolResultStatusSuccess, Data: payload, activityInput: inv.Args})
			})
			write := fltools.Define[struct{}](fltools.Definition{Name: "write_fixture", InputSchema: fltools.StrictObject(nil, nil), Effects: []fltools.Effect{fltools.EffectWrite}, Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}}, nil, nil, func(context.Context, fltools.Invocation[struct{}]) (fltools.Result, error) {
				effects.Add(1)
				return fltools.Result{Text: "written"}, nil
			})
			var steps []florettest.Step
			args := fmt.Sprintf("{%q:%q,%q:%q,%q:4}", "process_id", process.id, "description", "Wait for push", "after_seq")
			for i := 0; i < 6; i++ {
				calls := []flprovider.ToolCall{{ID: fmt.Sprintf("read-%d", i), Name: "terminal.read", Args: args}}
				if tc.mixed {
					calls = append(calls, flprovider.ToolCall{ID: fmt.Sprintf("write-%d", i), Name: "write_fixture", Args: "{}"})
				}
				steps = append(steps, florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventToolCalls, ToolCalls: calls}, {Type: flprovider.EventDone, Reason: "tool_calls"}}})
			}
			steps = append(steps, florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventDelta, Text: "Push confirmed complete."}, {Type: flprovider.EventDone, Reason: "stop"}}})
			gateway := florettest.NewScriptedGateway(flprovider.Identity{Provider: "test", Model: "terminal-wait", StateCompatibilityKey: "test:terminal-wait:v1"}, flprovider.Capabilities{Reasoning: flprovider.ReasoningUnsupported}, steps...)
			agent, err := flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "terminal-wait", Name: "Terminal Wait"}, SystemPrompt: "Wait for the existing command to finish.", Context: flconfig.ContextPolicy{ContextWindowTokens: flconfig.DefaultContextWindowTokens}}, gateway, flruntime.WithAgentTools(read, write), flruntime.WithAgentEffectAuthorization(floretAllowTestEffect), flruntime.WithAgentLoopLimits(flruntime.LoopLimits{NoProgressLimit: 2, DuplicateToolLimit: 3}))
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
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			updates, err := service.Subscribe(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer updates.Close()
			thread, err := service.Create(ctx, flruntime.CreateThreadInput{RequestKey: "create-wait"})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := service.Send(ctx, flruntime.SendInput{ThreadID: thread.ThreadID, RequestKey: "send-wait", Input: flruntime.UserInput{Text: "Wait for push"}}); err != nil {
				t.Fatal(err)
			}
			if tc.canceled {
				select {
				case <-started:
				case <-ctx.Done():
					t.Fatal(ctx.Err())
				}
				if _, err := service.Cancel(ctx, flruntime.CancelInput{ThreadID: thread.ThreadID, RequestKey: "stop-wait", Mode: flruntime.CancelModeGraceful}); err != nil {
					t.Fatal(err)
				}
			}
			var view flruntime.ThreadView
			for {
				view, err = service.View(ctx, thread.ThreadID)
				if err != nil {
					t.Fatal(err)
				}
				if view.Activity == flruntime.ThreadActivityIdle && view.LastOutcome != nil {
					break
				}
				if _, err := updates.Next(ctx); err != nil {
					t.Fatal(err)
				}
			}
			if tc.canceled {
				if *view.LastOutcome != flruntime.TurnOutcomeCancelled || view.Failure != nil || reads.Load() != 1 || len(gateway.Requests()) != 1 || process.Snapshot().Status != terminalProcessStatusRunning {
					t.Fatalf("stop did not cancel only the waiting execution: outcome=%v failure=%+v reads=%d requests=%d", view.LastOutcome, view.Failure, reads.Load(), len(gateway.Requests()))
				}
			} else if tc.completed {
				if *view.LastOutcome != flruntime.TurnOutcomeCompleted || reads.Load() != 6 || len(gateway.Requests()) != 7 {
					t.Fatalf("quiet command did not finish: outcome=%v failure=%+v reads=%d requests=%d", view.LastOutcome, view.Failure, reads.Load(), len(gateway.Requests()))
				}
				raw, err := json.Marshal(gateway.Requests()[6].Messages)
				if err != nil {
					t.Fatal(err)
				}
				if strings.Contains(string(raw), process.command) || !strings.Contains(string(raw), "wait_expired") {
					t.Fatalf("provider continuation lost concise wait facts: %s", raw)
				}
			} else if *view.LastOutcome != flruntime.TurnOutcomeFailed || view.Failure == nil || view.Failure.Reason != flruntime.ThreadTurnFailureRepeatedToolCalls || reads.Load() >= 6 || effects.Load() >= 6 {
				t.Fatalf("repeat safety weakened: outcome=%v failure=%+v reads=%d effects=%d", view.LastOutcome, view.Failure, reads.Load(), effects.Load())
			}
		})
	}
}
