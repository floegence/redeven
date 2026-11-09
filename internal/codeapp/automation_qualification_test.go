package codeapp

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/automation"
	"github.com/floegence/redeven/internal/codeapp/appserver"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/settings"
	"github.com/floegence/redevplugin/v3/pkg/schedule"
)

// Exercises real provider turns, real HTTP tools and durable scheduling with no
// browser/session bearer. Cluster endpoints are explicitly controlled test APIs.
func TestE2E_AutomationScheduledHTTPReportsAndRestart(t *testing.T) {
	if os.Getenv("REDEVEN_AUTOMATION_REAL_MODEL") != "1" {
		t.Skip("requires explicit real-model qualification")
	}
	source := os.Getenv("REDEVEN_FLOWER_CONTEXT_SOURCE_STATE_ROOT")
	cfg, err := config.Load(filepath.Join(source, "config.json"))
	if err != nil || cfg.AI == nil {
		t.Fatal("configured model unavailable")
	}
	sourceConfig, err := os.ReadFile(filepath.Join(source, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	sourceSecrets, err := os.ReadFile(filepath.Join(source, "secrets.json"))
	if err != nil {
		t.Fatal(err)
	}
	sourceSecretsDigest := sha256.Sum256(sourceSecrets)
	defer func() {
		after, e := os.ReadFile(filepath.Join(source, "config.json"))
		if e != nil || string(after) != string(sourceConfig) {
			t.Error("source config changed")
		}
		secretsAfter, e := os.ReadFile(filepath.Join(source, "secrets.json"))
		if e != nil || sha256.Sum256(secretsAfter) != sourceSecretsDigest {
			t.Error("source credentials changed")
		}
	}()
	providerID := os.Getenv("REDEVEN_FLOWER_PROMPT_PROVIDER_ID")
	var provider config.AIProvider
	var model config.AIProviderModel
	for _, p := range cfg.AI.Providers {
		if p.ID == providerID && p.Type == "deepseek" {
			for _, m := range p.EffectiveModels() {
				if m.ModelName == "deepseek-flash" {
					provider, model = p, m
				}
			}
		}
	}
	if provider.ID == "" {
		t.Fatal("explicit DeepSeek qualification provider unavailable")
	}
	key, found, err := settings.NewSecretsStore(filepath.Join(source, "secrets.json")).GetAIProviderAPIKey(provider.ID)
	if err != nil || !found || key == "" {
		t.Fatal("credential unavailable")
	}
	provider.ModelSelection = nil
	provider.Models = []config.AIProviderModel{model}
	modelID := provider.ID + "/" + model.ModelName
	root := t.TempDir()
	home := filepath.Join(root, "home")
	if err = os.MkdirAll(home, 0700); err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(root, "config.json")
	local := &config.Config{LocalEnvironmentPublicID: "acceptance-env", PermissionPolicy: &config.PermissionPolicy{SchemaVersion: 1, LocalMax: &config.PermissionSet{Read: true, Write: true, Execute: true}}}
	if err = config.Save(configPath, local); err != nil {
		t.Fatal(err)
	}
	owner := automation.Owner{User: "acceptance-user", Environment: local.LocalEnvironmentPublicID}
	storePath := filepath.Join(root, "workflows.sqlite")
	plansPath := filepath.Join(root, "schedules.sqlite")
	var store *automation.Store
	var plans *schedule.Store
	var ready *aiReadinessController
	var executor *automationExecutor
	var engine *automation.Engine
	var schedules *automation.Schedules
	open := func() {
		store, err = automation.Open(storePath)
		if err != nil {
			t.Fatal(err)
		}
		plans, err = schedule.Open(plansPath)
		if err != nil {
			t.Fatal(err)
		}
		authority := automationAuthority(store, configPath)
		opts := ai.Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: filepath.Join(root, "ai"), AgentHomeDir: home, Shell: "/bin/sh", Config: &config.AIConfig{CurrentModelID: modelID, Providers: []config.AIProvider{provider}}, ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{MaxAttemptDuration: 2 * time.Minute, FirstOutputTimeout: time.Minute, IdleTimeout: time.Minute}, ResolveProviderAPIKey: func(id string) (string, bool, error) { return key, id == provider.ID, nil }, Automation: store, AutomationAuthorize: authority}
		ready = newAIReadinessController(context.Background(), opts, nil, nil)
		ready.Start()
		waitForAIReadinessState(t, ready, appserver.AIReadinessReady)
		executor = &automationExecutor{provider: ready, store: store, configPath: configPath}
		engine = &automation.Engine{Store: store, Executor: executor}
		schedules = &automation.Schedules{Store: store, Plans: plans, Authorize: executor.Authorize}
	}
	closeAll := func() {
		if ready != nil {
			_ = ready.Close()
			ready = nil
		}
		if plans != nil {
			_ = plans.Close()
			plans = nil
		}
		if store != nil {
			_ = store.Close()
			store = nil
		}
	}
	open()
	defer closeAll()
	ctx, cancel := context.WithTimeout(t.Context(), 14*time.Minute)
	defer cancel()
	var sourceReads atomic.Int32
	sourceServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sourceReads.Add(1)
		if r.URL.Path == "/missing" {
			http.Error(w, "controlled missing source", 503)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"cluster_id":"`+strings.TrimPrefix(r.URL.Path, "/")+`","healthy":true,"observed_at":"`+time.Now().UTC().Format(time.RFC3339)+`"}`)
	}))
	defer sourceServer.Close()
	runToEnd := func(id string) automation.Run {
		for ctx.Err() == nil {
			if err = engine.Step(ctx, owner, id); err != nil {
				t.Fatal(err)
			}
			r, e := store.Run(ctx, owner, id)
			if e != nil {
				t.Fatal(e)
			}
			if r.Status == "completed" || r.Status == "partial" || r.Status == "failed" || r.Status == "canceled" {
				for _, attempt := range r.Attempts {
					t.Logf("node=%s state=%s error=%s", attempt.NodeID, attempt.State, attempt.Error)
					if attempt.State == "failed" && attempt.ThreadID != "" {
						service, leaseCtx, _, release, leaseErr := ready.AcquireAIService(ctx)
						if leaseErr != nil {
							t.Fatal(leaseErr)
						}
						meta, authorityErr := automationAuthority(store, configPath)(leaseCtx, owner, r)
						if authorityErr != nil {
							release()
							t.Fatal(authorityErr)
						}
						view, readErr := service.GetFlowerThreadDetail(leaseCtx, meta, attempt.ThreadID)
						release()
						if readErr != nil {
							t.Fatal(readErr)
						}
						t.Logf("canonical failure=%+v", view.Current.Failure)
					}
				}
				return r
			}
			select {
			case <-ctx.Done():
			case <-time.After(150 * time.Millisecond):
			}
		}
		t.Fatal("workflow qualification deadline")
		return automation.Run{}
	}
	publish := func(request string, d automation.Definition, tools []string) automation.Workflow {
		w, e := store.Create(ctx, owner, request, d)
		if e != nil {
			t.Fatal(e)
		}
		_, e = store.Publish(ctx, owner, w.ID, w.Revision, automation.Grant{Enabled: true, Tools: tools, Model: d.Model, WorkingDirectory: d.WorkingDirectory, ExpiresAt: time.Now().Add(time.Hour), Authority: automation.GrantAuthority{Namespace: "acceptance", App: "automation-qualification", Read: true, Write: true, Execute: true}})
		if e != nil {
			t.Fatal(e)
		}
		w, e = store.Get(ctx, owner, w.ID)
		if e != nil {
			t.Fatal(e)
		}
		return w
	}
	scheduled := func(w automation.Workflow) automation.Run {
		plan, e := schedules.Save(ctx, owner, w.ID, automation.ScheduleInput{Version: w.PublishedVersion, Enabled: true, Cadence: schedule.Cadence{Kind: "interval", IntervalMS: 1000}, Overlap: "skip", Missed: "latest", QueueLimit: 1})
		if e != nil {
			t.Fatal(e)
		}
		claims, e := plans.Tick(ctx, plan.NextAt.Add(time.Millisecond), false, 10)
		if e != nil || len(claims) != 1 {
			t.Fatal(claims, e)
		}
		receipt, e := schedules.Submit(ctx, claims[0])
		if e != nil {
			t.Fatal(e)
		}
		// Crash boundary: admission exists but scheduler never receives Accept.
		closeAll()
		open()
		retained, e := plans.Claims(ctx, claims[0].Owner, w.ID)
		if e != nil || len(retained) != 1 || retained[0].State != "unknown" {
			t.Fatal("claim not recovered", e)
		}
		observed, e := schedules.Inspect(ctx, retained[0])
		if e != nil || observed.Reference != receipt.Reference {
			t.Fatal("admission not reconciled", e)
		}
		if e = plans.Accept(ctx, claims[0].Owner, claims[0].ID, observed.Reference); e != nil {
			t.Fatal(e)
		}
		if e = schedules.Pause(ctx, owner, w.ID); e != nil {
			t.Fatal(e)
		}
		r, e := store.Run(ctx, owner, receipt.Reference)
		if e != nil {
			t.Fatal(e)
		}
		return r
	}
	parameters := func(url string) json.RawMessage { raw, _ := json.Marshal(map[string]string{"url": url}); return raw }
	news := automation.Definition{Title: "Daily news acceptance", Goal: "Read real technology news with explicit unavailable-source coverage and save an HTML report", Model: modelID, WorkingDirectory: home, MaxConcurrent: 2, TimeoutSeconds: 600, AllowPartial: true, Nodes: []automation.Node{
		{ID: "source", Title: "BBC technology feed", Kind: "tool", Tool: "http_get", Parameters: parameters("https://feeds.bbci.co.uk/news/technology/rss.xml")},
		{ID: "missing", Title: "Controlled unavailable source", Kind: "tool", Tool: "http_get", Parameters: parameters(sourceServer.URL + "/missing"), OutputSchema: json.RawMessage(`{"type":"object","properties":{"status":{"const":200}},"required":["status"]}`)},
		{ID: "coverage", Title: "Source coverage", Kind: "join", DependsOn: []string{"source", "missing"}, JoinPolicy: "partial", MinimumSuccess: 1},
		{ID: "summary", Title: "Verify news", Kind: "agent", DependsOn: []string{"coverage"}, Instruction: "Read workflow context. Summarize exactly two actual items from the fetched BBC RSS, retaining original titles and URLs. Mark the unavailable source as a gap. Never claim complete coverage. Submit JSON {headline:string,stories:[{title:string,url:string}],complete:false,gaps:[string]}.", OutputSchema: json.RawMessage(`{"type":"object","required":["headline","stories","complete","gaps"],"properties":{"headline":{"type":"string"},"stories":{"type":"array","minItems":2,"maxItems":2,"items":{"type":"object","required":["title","url"],"properties":{"title":{"type":"string"},"url":{"type":"string"}}}},"complete":{"const":false},"gaps":{"type":"array","minItems":1,"items":{"type":"string"}}}}`)},
		{ID: "report", Title: "HTML news report", Kind: "render", DependsOn: []string{"summary"}, Template: `<h1>{{.Title}}</h1>{{range index .Inputs "summary"}}<h2>{{.headline}}</h2>{{range .stories}}<p><a href="{{.url}}">{{.title}}</a></p>{{end}}{{range .gaps}}<p>Gap: {{.}}</p>{{end}}{{end}}`},
		{ID: "save", Title: "Save report", Kind: "deliver", Tool: "artifact.save", DependsOn: []string{"report"}},
	}}
	newsFlow := publish("news", news, nil)
	newsRun := scheduled(newsFlow)
	newsRun = runToEnd(newsRun.ID)
	if newsRun.Status != "partial" || len(newsRun.Artifacts) != 1 || !strings.Contains(newsRun.Artifacts[0].Content, "bbc") {
		t.Fatalf("news outcome: %s artifacts=%d", newsRun.Status, len(newsRun.Artifacts))
	}
	inspection := automation.Definition{Title: "Controlled cluster API inspection", Goal: "Inspect two isolated local cluster APIs and report actual observed coverage", Model: modelID, WorkingDirectory: home, MaxConcurrent: 2, TimeoutSeconds: 600, Nodes: []automation.Node{
		{ID: "inspect", Title: "Inspect cluster endpoints", Kind: "parallel", Concurrency: 2, Items: []automation.Item{{ID: "alpha", Label: "Alpha", Data: parameters(sourceServer.URL + "/alpha")}, {ID: "beta", Label: "Beta", Data: parameters(sourceServer.URL + "/beta")}}, Instruction: "Use terminal_exec to fetch the exact assigned HTTP URL (Python urllib.request is available). This is a controlled read-only test endpoint. Submit the actual JSON cluster_id and healthy fields. Never infer health from an inaccessible endpoint.", OutputSchema: json.RawMessage(`{"type":"object","required":["cluster_id","healthy"],"properties":{"cluster_id":{"enum":["alpha","beta"]},"healthy":{"const":true}}}`)},
		{ID: "coverage", Title: "Verified coverage", Kind: "join", DependsOn: []string{"inspect"}},
		{ID: "report", Title: "Inspection report", Kind: "render", DependsOn: []string{"coverage"}, Template: `<h1>{{.Title}}</h1>{{range index .Inputs "coverage"}}<p>Observed {{.coverage.completed}} of {{.coverage.total}}</p>{{range index .results "inspect"}}<p>{{.cluster_id}}: {{.healthy}}</p>{{end}}{{end}}`},
		{ID: "save", Title: "Save inspection", Kind: "deliver", Tool: "artifact.save", DependsOn: []string{"report"}},
	}}
	before := sourceReads.Load()
	inspectionFlow := publish("inspection", inspection, []string{"terminal_exec", "terminal_read"})
	inspectionRun := scheduled(inspectionFlow)
	inspectionRun = runToEnd(inspectionRun.ID)
	if inspectionRun.Status != "completed" || len(inspectionRun.Artifacts) != 1 || sourceReads.Load() < before+2 {
		t.Fatalf("inspection outcome %s; actual reads %d", inspectionRun.Status, sourceReads.Load()-before)
	}
	// Revoke after planning: no new run or source read can be admitted.
	plan, err := schedules.Save(ctx, owner, inspectionFlow.ID, automation.ScheduleInput{Revision: 2, Version: 1, Enabled: true, Cadence: schedule.Cadence{Kind: "interval", IntervalMS: 1000}, Overlap: "skip", Missed: "latest", QueueLimit: 1})
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Revoke(ctx, owner, inspectionFlow.ID); err != nil {
		t.Fatal(err)
	}
	originalClaims, _ := plans.Claims(ctx, schedule.Owner{Kind: "redeven.automation", Subject: owner.User, Environment: owner.Environment}, inspectionFlow.ID)
	if err = plans.Resolve(ctx, originalClaims[0].Owner, originalClaims[0].ID, "completed", time.Now()); err != nil {
		t.Fatal(err)
	}
	claims, err := plans.Tick(ctx, plan.NextAt.Add(time.Millisecond), false, 10)
	if err != nil || len(claims) != 1 {
		t.Fatal(claims, err)
	}
	receipt, err := schedules.Submit(ctx, claims[0])
	if err != nil || receipt.Outcome != "not_committed" {
		t.Fatal("revoked schedule admitted", receipt, err)
	}
	if out := os.Getenv("REDEVEN_AUTOMATION_REPORT_DIR"); out != "" {
		if err = os.MkdirAll(out, 0700); err != nil {
			t.Fatal(err)
		}
		for name, r := range map[string]automation.Run{"scheduled-news": newsRun, "scheduled-cluster-apis": inspectionRun} {
			raw, _ := json.MarshalIndent(r, "", "  ")
			if err = os.WriteFile(filepath.Join(out, name+".json"), raw, 0600); err != nil {
				t.Fatal(err)
			}
			digest := sha256.Sum256(raw)
			t.Log(name + " evidence SHA256 " + hex.EncodeToString(digest[:]))
			if err = os.WriteFile(filepath.Join(out, name+".html"), []byte(r.Artifacts[0].Content), 0600); err != nil {
				t.Fatal(err)
			}
		}
	}
}
