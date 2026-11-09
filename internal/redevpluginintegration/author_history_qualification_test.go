package redevpluginintegration

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/plugincreation"
	"github.com/floegence/redeven/internal/session"
)

// This opt-in acceptance lane opens only an explicitly isolated, consistent
// history snapshot. It uses published owners, a new author workspace, real
// provider requests and high reasoning. Source stores and projects stay intact.
func TestPluginOriginalHistoryContinuesAfterDisconnect(t *testing.T) {
	if os.Getenv("REDEVEN_PLUGIN_HISTORY_QUALIFICATION") != "1" {
		t.Skip("explicit original-history model qualification")
	}
	snapshot, thread, profile, root := os.Getenv("REDEVEN_PLUGIN_HISTORY_SNAPSHOT"), os.Getenv("REDEVEN_PLUGIN_HISTORY_THREAD"), os.Getenv("REDEVEN_FLOWER_CONTEXT_SOURCE_STATE_ROOT"), os.Getenv("REDEVEN_PLUGIN_HISTORY_REPORT_DIR")
	if snapshot == "" || thread == "" || profile == "" || root == "" {
		t.Fatal("isolated snapshot, thread, source profile and fresh report directory are required")
	}
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "ai"), 0700); err != nil {
		t.Fatal(err)
	}
	src, err := os.Open(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	dst, err := os.OpenFile(filepath.Join(root, "ai/floret_threads.sqlite"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		src.Close()
		t.Fatal(err)
	}
	_, err = io.Copy(dst, src)
	src.Close()
	dst.Close()
	if err != nil {
		t.Fatal(err)
	}
	// Canonical historical image/attachment references need the corresponding
	// product-owned immutable media bytes in this isolated root as well.
	for _, relative := range []string{"computer/keyframes", "ai/uploads"} {
		source := filepath.Join(profile, relative)
		if _, err := os.Stat(source); os.IsNotExist(err) {
			continue
		}
		if err := os.CopyFS(filepath.Join(root, relative), os.DirFS(source)); err != nil {
			t.Fatal(err)
		}
	}
	var original config.Config
	raw, err := os.ReadFile(filepath.Join(profile, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(raw, &original); err != nil || original.AI == nil {
		t.Fatal("model profile unavailable")
	}
	hashes := map[string][32]byte{"config.json": sha256.Sum256(raw)}
	raw, err = os.ReadFile(filepath.Join(profile, "secrets.json"))
	if err != nil {
		t.Fatal(err)
	}
	hashes["secrets.json"] = sha256.Sum256(raw)
	var credentials struct {
		AI struct {
			ProviderAPIKeys map[string]string `json:"provider_api_keys"`
		} `json:"ai"`
	}
	if err = json.Unmarshal(raw, &credentials); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for name, hash := range hashes {
			b, e := os.ReadFile(filepath.Join(profile, name))
			if e != nil || sha256.Sum256(b) != hash {
				t.Errorf("source profile changed: %s", name)
			}
		}
	})
	var provider config.AIProvider
	var model config.AIProviderModel
	for _, p := range original.AI.Providers {
		if p.Type == "deepseek" {
			for _, m := range p.EffectiveModels() {
				if m.ModelName == "deepseek-flash" {
					provider = p
					model = m
				}
			}
		}
	}
	key := credentials.AI.ProviderAPIKeys[provider.ID]
	if provider.ID == "" || key == "" {
		t.Fatal("configured DeepSeek Flash unavailable")
	}
	provider.ModelSelection = nil
	provider.Models = []config.AIProviderModel{model}
	modelID := provider.ID + "/" + model.ModelName
	meta := &session.Meta{ChannelID: "qualification-original", EndpointID: "env_local", NamespacePublicID: "ns_local", UserPublicID: "user_local", FloeApp: "com.floegence.redeven.agent", CodeSpaceID: "env-ui", CanRead: true, CanWrite: true, CanExecute: true}
	var live atomic.Pointer[session.Meta]
	live.Store(meta)
	ps, err := plugincreation.Open(filepath.Join(root, "drafts.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer ps.Close()
	product := plugincreation.New(ps)
	opts := ownerScopeTestOptions(t, root)
	opts.PermissionPolicy = testPermissionPolicy(t, "execute_read_write")
	opts.PluginCreation = product
	opts.ResolveSessionMeta = func(id string) (*session.Meta, bool) { m := live.Load(); return m, m != nil && m.ChannelID == id }
	integration, err := New(t.Context(), opts)
	if err != nil {
		t.Fatal(err)
	}
	defer integration.Close()
	draft, err := product.Create(t.Context(), meta, "original-history-qualification")
	if err != nil {
		t.Fatal(err)
	}
	owner, _ := plugincreation.OwnerFromSession(meta)
	_, err = ps.FreezeLaunch(t.Context(), owner, draft.ID, "history", "{}")
	if err != nil {
		t.Fatal(err)
	}
	_, err = ps.BindThread(t.Context(), owner, draft.ID, "history", thread)
	if err != nil {
		t.Fatal(err)
	}
	_, err = integration.author.AuthorOperation(t.Context(), meta, draft.WorkspaceID, "initialize", map[string]any{"slug": "history-qualification", "display_name": "History qualification", "template": "web"})
	if err != nil {
		t.Fatal(err)
	}
	scope, err := product.SourceScope(t.Context(), meta, draft.ID)
	if err != nil {
		t.Fatal(err)
	}
	settings, err := threadstore.Open(filepath.Join(root, "ai/threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	err = settings.CreateThreadSettings(t.Context(), threadstore.ThreadSettings{ThreadID: thread, EndpointID: meta.EndpointID, NamespacePublicID: meta.NamespacePublicID, ModelID: modelID, PermissionType: "full_access", WorkingDir: scope.Directory, ReasoningSelectionJSON: `{"level":"high"}`})
	settings.Close()
	if err != nil {
		t.Fatal(err)
	}
	media := ai.NewComputerUseRuntime(ai.NewTargetRegistry(), nil, filepath.Join(root, "computer/keyframes"))
	defer media.Close()
	open := func() *ai.Service {
		svc, e := ai.NewService(ai.Options{StateDir: root, AgentHomeDir: root, PluginCreation: product, TargetToolExecutor: media, Shell: "/bin/sh", Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), Config: &config.AIConfig{CurrentModelID: modelID, Providers: []config.AIProvider{provider}}, ResolveProviderAPIKey: func(id string) (string, bool, error) { return key, id == provider.ID, nil }, ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{MaxAttemptDuration: 3 * time.Minute, FirstOutputTimeout: 2 * time.Minute, IdleTimeout: time.Minute}})
		if e != nil {
			t.Fatal(e)
		}
		return svc
	}
	svc := open()
	defer func() { _ = svc.Close() }()
	ctx, cancel := context.WithTimeout(t.Context(), 8*time.Minute)
	defer cancel()
	before, err := svc.GetFlowerThreadDetail(ctx, meta, thread)
	if err != nil {
		t.Fatal(err)
	}
	if len(before.Current.Items) < 400 {
		t.Fatalf("not the original long history: %d items", len(before.Current.Items))
	}
	report := map[string]any{"initial_items": len(before.Current.Items), "model": modelID, "reasoning": "high", "source_thread": thread, "real_model": true}
	defer func() {
		report["passed"] = !t.Failed()
		data, _ := json.MarshalIndent(report, "", "  ")
		_ = os.WriteFile(filepath.Join(root, "report.json"), data, 0600)
	}()
	for turn := 0; turn < 2; turn++ {
		request := ai.SendUserTurnRequest{StorageGeneration: svc.StorageGeneration(), ThreadID: thread, ClientRequestID: fmt.Sprintf("qualification-%d", turn), Input: ai.RunInput{Text: "This is an explicit read-only continuation qualification in an isolated copy of the original history. Do not resume the earlier UI editing task. Call plugin_author_get_status for the current managed workspace. Report its source directory and finish with CONTINUED. Do not modify files, build, install, delegate or request user input."}, Options: ai.RunOptions{NoUserInteraction: true, MaxOutputTokens: 2048, ReasoningSelection: config.AIReasoningSelection{Level: config.AIReasoningLevelHigh}, ToolAllowlist: []string{"plugin_author_get_status"}}}
		receipt, e := svc.SendUserTurn(ctx, meta, request)
		if e != nil {
			t.Fatal(e)
		}
		live.Store(nil)
		deadline := time.Now().Add(3 * time.Minute)
		for {
			view, e := svc.GetThread(ctx, meta, thread)
			if e != nil {
				t.Fatal(e)
			}
			if view.RunStatus == "failed" {
				t.Fatalf("original history continuation failed: %s %s", view.RunErrorCode, view.RunError)
			}
			if view.RunStatus == "success" {
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("continuation timed out")
			}
			time.Sleep(200 * time.Millisecond)
		}
		after, e := svc.GetFlowerThreadDetail(ctx, meta, thread)
		if e != nil {
			t.Fatal(e)
		}
		if after.Current.TurnID.String() != receipt.TurnID || after.Current.Failure != nil {
			t.Fatalf("terminal mismatch: %+v", after.Current.Failure)
		}
		for i, item := range before.Current.Items {
			if i >= len(after.Current.Items) || after.Current.Items[i].ID != item.ID {
				t.Fatal("historical item identity changed")
			}
		}
		found := false
		for _, item := range after.Current.Items {
			if item.TurnID.String() == receipt.TurnID && item.Activity != nil && item.Activity.ToolName == "plugin_author_get_status" {
				if item.Activity.Status != "success" {
					t.Fatalf("author status tool failed: %+v", item.Activity)
				}
				found = true
			}
		}
		if !found {
			t.Fatal("model did not exercise the author tool")
		}
		report[fmt.Sprintf("turn_%d", turn)] = receipt.TurnID
		report[fmt.Sprintf("turn_%d_tool_success", turn)] = found
		data, _ := json.MarshalIndent(after, "", "  ")
		_ = os.WriteFile(filepath.Join(root, fmt.Sprintf("turn-%d.json", turn)), data, 0600)
		if turn == 0 {
			if e = svc.Close(); e != nil {
				t.Fatal(e)
			}
			next := *meta
			next.ChannelID = "qualification-reconnected"
			meta = &next
			live.Store(meta)
			svc = open()
		}
	}
}
