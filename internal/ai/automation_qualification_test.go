package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/automation"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

// This opt-in qualification uses the configured real provider in a disposable
// local state. Fixtures contain task data, never credentials or production writes.
func TestE2E_AutomationRealProviderSharedContext(t *testing.T) {
	if os.Getenv("REDEVEN_AUTOMATION_REAL_MODEL") != "1" {
		t.Skip("requires explicit real-model qualification")
	}
	provider, model, key := loadPromptQualificationProfile(t)
	root := t.TempDir()
	home := filepath.Join(root, "home")
	if err := os.MkdirAll(home, 0700); err != nil {
		t.Fatal(err)
	}
	provider.ModelSelection = nil
	provider.Models = []config.AIProviderModel{model}
	modelID := provider.ID + "/" + model.ModelName
	store, err := automation.Open(filepath.Join(root, "automation.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	meta := testSendTurnMeta()
	owner, _ := automation.OwnerFromSession(meta)
	opts := Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: filepath.Join(root, "ai"), AgentHomeDir: home, Shell: "/bin/sh", Config: &config.AIConfig{CurrentModelID: modelID, Providers: []config.AIProvider{provider}}, ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{MaxAttemptDuration: 2 * time.Minute, FirstOutputTimeout: time.Minute, IdleTimeout: time.Minute}, ResolveProviderAPIKey: func(id string) (string, bool, error) { return key, id == provider.ID, nil }, Automation: store, AutomationAuthorize: func(ctx context.Context, o automation.Owner, r automation.Run) (*session.Meta, error) {
		g, e := store.GrantVersion(ctx, o, r.WorkflowID, r.DefinitionVersion)
		if e != nil || !g.Enabled || !g.ExpiresAt.After(time.Now()) {
			return nil, automation.ErrUnauthorized
		}
		return meta, nil
	}}
	svc, err := NewService(opts)
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	nodes := []automation.Node{{ID: "inspect", Title: "Inspect clusters", Kind: "parallel", Concurrency: 2, Instruction: "Read your assigned item. Report its cluster_id and observed health exactly. Submit JSON with cluster_id and healthy. Do not infer unobserved facts.", Items: []automation.Item{{ID: "alpha", Label: "Alpha", Data: json.RawMessage(`{"cluster_id":"alpha","healthy":true}`)}, {ID: "beta", Label: "Beta", Data: json.RawMessage(`{"cluster_id":"beta","healthy":false}`)}}, OutputSchema: json.RawMessage(`{"type":"object","required":["cluster_id","healthy"],"properties":{"cluster_id":{"type":"string"},"healthy":{"type":"boolean"}},"additionalProperties":false}`)}, {ID: "summary", Title: "Summarize shared observations", Kind: "agent", DependsOn: []string{"inspect"}, Instruction: "Read the shared workflow context with automation_read_context to find both cluster inspection results. Submit {total:2,healthy:1,unhealthy:1}. These counts must come from the preceding confirmed results.", OutputSchema: json.RawMessage(`{"type":"object","required":["total","healthy","unhealthy"],"properties":{"total":{"const":2},"healthy":{"const":1},"unhealthy":{"const":1}},"additionalProperties":false}`)}, {ID: "report", Title: "Inspection report", Kind: "render", DependsOn: []string{"summary"}, Template: `<h1>{{.Title}}</h1>{{range index .Inputs "summary"}}<p>Coverage {{.total}}; healthy {{.healthy}}; unhealthy {{.unhealthy}}</p>{{end}}`}, {ID: "save", Title: "Save report", Kind: "deliver", DependsOn: []string{"report"}, Tool: "artifact.save"}}
	definition := automation.Definition{Title: "Real-model inspection qualification", Goal: "Inspect both clusters using shared evidence and save the report", Model: modelID, WorkingDirectory: home, MaxConcurrent: 2, TimeoutSeconds: 480, Nodes: nodes}
	w, err := store.Create(t.Context(), owner, "qualification", definition)
	if err != nil {
		t.Fatal(err)
	}
	pub, err := store.Publish(t.Context(), owner, w.ID, w.Revision, automation.Grant{Enabled: true, Model: modelID, WorkingDirectory: home, ExpiresAt: time.Now().Add(time.Hour), Authority: automation.GrantAuthority{Namespace: meta.NamespacePublicID, App: "qualification", Read: true, Write: true, Execute: true}})
	if err != nil {
		t.Fatal(err)
	}
	run, err := store.CreateRun(t.Context(), owner, w.ID, "qualification-run", pub.Version, "test", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	engine := &automation.Engine{Store: store, Executor: AutomationExecutor{Service: svc}}
	ctx, cancel := context.WithTimeout(t.Context(), 9*time.Minute)
	defer cancel()
	for ctx.Err() == nil {
		if err := engine.Step(ctx, owner, run.ID); err != nil {
			t.Fatal(err)
		}
		run, err = store.Run(ctx, owner, run.ID)
		if err != nil {
			t.Fatal(err)
		}
		if run.Status == "completed" || run.Status == "failed" || run.Status == "partial" || run.Status == "canceled" {
			break
		}
		select {
		case <-ctx.Done():
		case <-time.After(250 * time.Millisecond):
		}
	}
	if run.Status != "completed" || len(run.Artifacts) != 1 {
		t.Fatalf("qualification status %s: %+v", run.Status, run.Attempts)
	}
	if out := os.Getenv("REDEVEN_AUTOMATION_REPORT_DIR"); out != "" {
		if err := os.MkdirAll(out, 0700); err != nil {
			t.Fatal(err)
		}
		raw, _ := json.MarshalIndent(run, "", "  ")
		if err := os.WriteFile(filepath.Join(out, "real-provider-inspection.json"), raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
}
