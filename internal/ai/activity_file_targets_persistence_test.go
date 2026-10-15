package ai

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v7/config"
	"github.com/floegence/floret/v7/florettest"
	"github.com/floegence/floret/v7/identity"
	"github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/storage"
	"github.com/floegence/floret/v7/threadquery"
	fltools "github.com/floegence/floret/v7/tools"
	"github.com/floegence/redeven/internal/config"
)

func TestHistoricalFileTargetsSurviveCanonicalCompactionForkAndRestart(t *testing.T) {
	ctx := t.Context()
	svc := newTestService(t, &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Name: "OpenAI", Type: "openai", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}})
	meta := testSendTurnMeta()
	var executions atomic.Int32
	answer := func(text string) florettest.Step {
		return florettest.Step{Events: []provider.Event{{Type: provider.EventDelta, Text: text}, {Type: provider.EventDone, Reason: "stop"}}}
	}
	gateway := florettest.NewScriptedGateway(provider.Identity{Provider: "test", Model: "files", StateCompatibilityKey: "files:v1"}, provider.Capabilities{Reasoning: provider.ReasoningUnsupported},
		florettest.Step{Events: []provider.Event{{Type: provider.EventToolCalls, ToolCalls: []provider.ToolCall{{ID: "read-confirmed", Name: "read_file", Args: "{}"}}}, {Type: provider.EventDone, Reason: "tool_calls"}}}, answer("Historical file read."), answer("Acknowledged."), answer("Acknowledged."), answer("The missing file was read. Preserve its historical snapshot."))
	tool := fltools.Define[map[string]any](fltools.Definition{Name: "read_file", InputSchema: fltools.StrictObject(nil, nil), ReadOnly: true, Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}}, nil, nil, func(context.Context, fltools.Invocation[map[string]any]) (fltools.Result, error) {
		executions.Add(1)
		return fltools.Result{Text: "{\"status\":\"success\",\"data\":{\"file_path\":\"/unmounted/历史/a.txt\"}}", Activity: &fltools.ActivityPresentation{Label: "a.txt", Renderer: fltools.ActivityRendererFile, Payload: fltools.FileActivityPayload{Content: "immutable historical snapshot"}}}, nil
	})
	database := filepath.Join(t.TempDir(), "canonical.sqlite")
	open := func() (*flruntime.Host, flruntime.ThreadService) {
		host, err := flruntime.Open(ctx, flruntime.Options{Storage: storage.SQLite(database)})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = host.Shutdown(context.Background()) })
		runtime, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) {
			return flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "files", Name: "Files"}, SystemPrompt: "Test file history.", Context: flconfig.ContextPolicy{ContextWindowTokens: 256000, CompactedContextTargetTokens: 2000, RecentTailTokens: 100, RecentUserTokens: 100, ReservedSummaryTokens: 1000}}, gateway, flruntime.WithAgentTools(tool), flruntime.WithAgentEffectAuthorization(flruntime.EffectAuthorizationGateFunc(func(ctx context.Context, request flruntime.EffectAuthorizationRequest, effect flruntime.AuthorizedEffect) (flruntime.EffectDispatchResult, error) {
				return effect(ctx, flruntime.EffectAuthorizationProof{EffectAttemptID: request.EffectAttemptID, RequestFingerprint: request.RequestFingerprint, ThreadID: request.ThreadID, TurnID: request.TurnID, RunID: request.RunID, ToolCallID: request.ToolCallID, PolicyRevision: "test", AuditReference: "test", AuditHash: "test", AuthorizedAt: time.Now().UTC()})
			})))
		}))
		if err != nil {
			t.Fatal(err)
		}
		return host, runtime
	}
	host, runtime := open()
	svc.threadRuntime = runtime
	created, err := svc.CreateThread(ctx, meta, "Files", "", "", svc.agentHomeDir)
	if err != nil {
		t.Fatal(err)
	}
	for index := 0; index < 3; index++ {
		text := "Read the file"
		if index > 0 {
			text = strings.Repeat("Long acknowledged history. ", 1200)
		}
		_, err := runtime.Send(ctx, flruntime.SendInput{ThreadID: identity.ThreadID(created.ThreadID), RequestKey: flruntime.RequestKey(string(rune('a' + index))), Input: flruntime.UserInput{Text: text}})
		if err != nil {
			t.Fatal(err)
		}
		waitForFloretThreadIdle(t, runtime, identity.ThreadID(created.ThreadID))
	}
	check := func(threadID identity.ThreadID) {
		t.Helper()
		view, err := runtime.View(ctx, threadID)
		if err != nil {
			t.Fatal(err)
		}
		before, _ := json.Marshal(view.Items)
		reader := runtime.(flruntime.ThreadQueryReader)
		scope := threadquery.Scope{Authority: "immutable-test", ThreadIDs: []identity.ThreadID{threadID}}
		records, err := reader.Query(ctx, scope, threadquery.QueryInput{Object: threadquery.ToolCalls, Filter: threadquery.Filter{ThreadIDs: []identity.ThreadID{threadID}}, Limit: 200})
		if err != nil {
			t.Fatal(err)
		}
		if len(records.Records) != 1 {
			t.Fatalf("canonical records=%+v", records)
		}
		rawBefore, err := reader.Read(ctx, scope, threadquery.ReadInput{Ref: records.Records[0].Ref})
		if err != nil {
			t.Fatal(err)
		}
		hydrated, err := svc.hydrateFileActivityTargets(ctx, meta, threadID.String(), view.Items)
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, item := range hydrated {
			if item.Activity != nil && item.Activity.ToolID == "read-confirmed" {
				found = true
				if p := item.Activity.Presentation; p == nil || len(p.TargetRefs) != 1 || p.TargetRefs[0].Path != "/unmounted/历史/a.txt" || p.Payload.(fltools.FileActivityPayload).Content != "immutable historical snapshot" {
					t.Fatalf("historical target=%+v", p)
				}
			}
		}
		if !found {
			t.Fatal("historical tool is missing")
		}
		after, _ := json.Marshal(view.Items)
		if string(before) != string(after) {
			t.Fatal("source view mutated")
		}
		unchanged, err := runtime.View(ctx, threadID)
		if err != nil {
			t.Fatal(err)
		}
		after, _ = json.Marshal(unchanged.Items)
		if string(before) != string(after) {
			t.Fatal("canonical view mutated")
		}
		rawAfter, err := reader.Read(ctx, scope, threadquery.ReadInput{Ref: records.Records[0].Ref})
		if err != nil {
			t.Fatal(err)
		}
		a, _ := json.Marshal(rawBefore.Chunks)
		b, _ := json.Marshal(rawAfter.Chunks)
		if string(a) != string(b) {
			t.Fatal("canonical result bytes changed")
		}
		if executions.Load() != 1 {
			t.Fatalf("history executed tool %d times", executions.Load())
		}
	}
	check(identity.ThreadID(created.ThreadID))
	_, err = runtime.(flruntime.ThreadContextCompactor).CompactContext(ctx, flruntime.CompactContextInput{ThreadID: identity.ThreadID(created.ThreadID), RequestKey: "compact"})
	if err != nil {
		t.Fatal(err)
	}
	waitForFloretThreadIdle(t, runtime, identity.ThreadID(created.ThreadID))
	contextView, err := runtime.(flruntime.ThreadContextReader).Context(ctx, identity.ThreadID(created.ThreadID))
	if err != nil {
		t.Fatal(err)
	}
	if len(contextView.Compactions) != 1 || contextView.Compactions[0].Status != "compacted" {
		t.Fatalf("compaction=%+v", contextView.Compactions)
	}
	check(identity.ThreadID(created.ThreadID))
	fork, err := svc.ForkThread(ctx, meta, created.ThreadID, "Forked files")
	if err != nil {
		t.Fatal(err)
	}
	check(identity.ThreadID(fork.ThreadID))
	if err := host.Shutdown(ctx); err != nil {
		t.Fatal(err)
	}
	_, runtime = open()
	svc.threadRuntime = runtime
	check(identity.ThreadID(created.ThreadID))
	check(identity.ThreadID(fork.ThreadID))
}
