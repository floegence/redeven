package ai

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v7/config"
	"github.com/floegence/floret/v7/florettest"
	"github.com/floegence/floret/v7/identity"
	"github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/storage"
	fltools "github.com/floegence/floret/v7/tools"
	"github.com/floegence/redeven/internal/config"
)

func TestTaskFilesCanonicalDeliverySurvivesForkAndRestart(t *testing.T) {
	ctx := t.Context()
	svc := newTestService(t, &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Name: "OpenAI", Type: "openai", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}})
	meta := testSendTurnMeta()
	path := filepath.Join(svc.agentHomeDir, "report.txt")
	if err := os.WriteFile(path, []byte("final report"), 0600); err != nil {
		t.Fatal(err)
	}
	gateway := florettest.NewScriptedGateway(provider.Identity{Provider: "test", Model: "files", StateCompatibilityKey: "files:v1"}, provider.Capabilities{Reasoning: provider.ReasoningUnsupported},
		florettest.Step{Events: []provider.Event{{Type: provider.EventToolCalls, ToolCalls: []provider.ToolCall{{ID: "present", Name: "file.present", Args: "{}"}}}, {Type: provider.EventDone, Reason: "tool_calls"}}},
		florettest.Step{Events: []provider.Event{{Type: provider.EventDelta, Text: "Report delivered."}, {Type: provider.EventDone, Reason: "stop"}}})
	tool := fltools.Define[map[string]any](fltools.Definition{Name: "file.present", InputSchema: fltools.StrictObject(nil, nil), ReadOnly: true, Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}}, nil, nil, func(ctx context.Context, call fltools.Invocation[map[string]any]) (fltools.Result, error) {
		r := newRun(runOptions{StateDir: svc.stateDir, AgentHomeDir: svc.agentHomeDir, WorkingDir: svc.agentHomeDir, FilesystemScope: svc.scope, ThreadID: call.ThreadID.String(), RunID: call.RunID.String(), TurnID: call.TurnID.String(), EndpointID: meta.EndpointID})
		if err := r.observeFloretCanonicalIdentity(call.RunID.String(), call.ThreadID.String(), call.TurnID.String()); err != nil {
			return fltools.Result{}, err
		}
		data, err := r.presentFile(ctx, path, "Report")
		if err != nil {
			return fltools.Result{}, err
		}
		encoded, err := json.Marshal(map[string]any{"status": "success", "data": data})
		return fltools.Result{Text: string(encoded)}, err
	})
	database := filepath.Join(t.TempDir(), "canonical.sqlite")
	open := func() (*flruntime.Host, flruntime.ThreadService) {
		host, err := flruntime.Open(ctx, flruntime.Options{Storage: storage.SQLite(database)})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = host.Shutdown(context.Background()) })
		runtime, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) {
			return flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "files", Name: "Files"}, SystemPrompt: "Present the report.", Context: flconfig.ContextPolicy{ContextWindowTokens: flconfig.DefaultContextWindowTokens}}, gateway, flruntime.WithAgentTools(tool), flruntime.WithAgentEffectAuthorization(flruntime.EffectAuthorizationGateFunc(func(ctx context.Context, req flruntime.EffectAuthorizationRequest, effect flruntime.AuthorizedEffect) (flruntime.EffectDispatchResult, error) {
				return effect(ctx, flruntime.EffectAuthorizationProof{EffectAttemptID: req.EffectAttemptID, RequestFingerprint: req.RequestFingerprint, ThreadID: req.ThreadID, TurnID: req.TurnID, RunID: req.RunID, ToolCallID: req.ToolCallID, PolicyRevision: "test", AuditReference: "test", AuditHash: "test", AuthorizedAt: time.Now().UTC()})
			})))
		}))
		if err != nil {
			t.Fatal(err)
		}
		return host, runtime
	}
	host, runtime := open()
	svc.threadRuntime = runtime
	thread, err := svc.CreateThread(ctx, meta, "Files", "", "", svc.agentHomeDir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = runtime.Send(ctx, flruntime.SendInput{ThreadID: identity.ThreadID(thread.ThreadID), RequestKey: "deliver", Input: flruntime.UserInput{Text: "Present report"}}); err != nil {
		t.Fatal(err)
	}
	waitForFloretThreadIdle(t, runtime, identity.ThreadID(thread.ThreadID))
	check := func(id, status string) {
		t.Helper()
		files, e := svc.GetTaskFiles(ctx, meta, id, "")
		if e != nil || len(files.Files) != 1 {
			t.Fatalf("files %+v: %v", files, e)
		}
		if files.Files[0].Status != status || files.Files[0].ThreadID != thread.ThreadID {
			t.Fatalf("delivery %+v", files.Files[0])
		}
	}
	check(thread.ThreadID, "available")
	sourceFiles, err := prepareTaskFiles(svc.stateDir, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(sourceFiles.Scratch, "retained.csv"), []byte("27"), 0600); err != nil {
		t.Fatal(err)
	}
	fork, err := svc.ForkThreadWithOptions(ctx, meta, thread.ThreadID, ForkThreadRequest{ClientRequestID: "fork", Title: "Fork"})
	if err != nil {
		t.Fatal(err)
	}
	check(fork.ThreadID, "available")
	if err = host.Shutdown(ctx); err != nil {
		t.Fatal(err)
	}
	host, runtime = open()
	svc.threadRuntime = runtime
	check(thread.ThreadID, "available")
	check(fork.ThreadID, "available")
	if err = os.WriteFile(path, []byte("edited final report"), 0600); err != nil {
		t.Fatal(err)
	}
	check(thread.ThreadID, "changed")
	if err = svc.CleanTaskFiles(ctx, meta, thread.ThreadID); err != nil {
		t.Fatal(err)
	}
	check(fork.ThreadID, "changed")
	if err = svc.DeleteThread(ctx, meta, thread.ThreadID, false); err != nil {
		t.Fatal(err)
	}
	check(fork.ThreadID, "changed")
	childFiles, _ := taskFiles(svc.stateDir, fork.ThreadID)
	if bytes, e := os.ReadFile(filepath.Join(childFiles.Scratch, "retained.csv")); e != nil || string(bytes) != "27" {
		t.Fatalf("fork lost working files after restart/delete: %q %v", bytes, e)
	}
	if err = os.Remove(path); err != nil {
		t.Fatal(err)
	}
	check(fork.ThreadID, "missing")
}
