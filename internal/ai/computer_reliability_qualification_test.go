package ai

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/settings"
)

// Paid acceptance uses the production Service, provider, tool registry and
// installed Chromium. Only the website and task-owned state are fixtures.
func TestComputerReliabilityDeepSeek(t *testing.T) {
	if os.Getenv("REDEVEN_COMPUTER_RELIABILITY_E2E") != "1" {
		t.Skip("explicit real-provider acceptance required")
	}
	sourceRoot, output := os.Getenv("REDEVEN_COMPUTER_CONFIG_ROOT"), os.Getenv("REDEVEN_COMPUTER_EVIDENCE_DIR")
	if !filepath.IsAbs(sourceRoot) || !filepath.IsAbs(output) {
		t.Fatal("absolute configuration and evidence paths required")
	}
	hashes := map[string][32]byte{}
	for _, name := range []string{"config.json", "secrets.json"} {
		body, err := os.ReadFile(filepath.Join(sourceRoot, name))
		if err != nil {
			t.Fatal("local provider configuration unavailable")
		}
		hashes[name] = sha256.Sum256(body)
	}
	t.Cleanup(func() {
		for name, want := range hashes {
			body, err := os.ReadFile(filepath.Join(sourceRoot, name))
			if err != nil || sha256.Sum256(body) != want {
				t.Errorf("source configuration changed: %s", name)
			}
		}
	})
	source, err := config.Load(filepath.Join(sourceRoot, "config.json"))
	if err != nil || source.AI == nil {
		t.Fatal("local AI configuration unavailable")
	}
	var provider config.AIProvider
	var model config.AIProviderModel
	for _, candidate := range source.AI.Providers {
		if candidate.Type == "deepseek" {
			for _, m := range candidate.EffectiveModels() {
				if m.ModelName == "deepseek-flash" {
					if provider.ID != "" {
						t.Fatal("ambiguous DeepSeek provider")
					}
					provider, model = candidate, m
				}
			}
		}
	}
	if provider.ID == "" || model.ContextWindow == 0 || model.EffectiveWireModelName() != "deepseek-flash" {
		t.Fatal("configured DeepSeek V4.1 Flash (1017) required; substitutions are not accepted")
	}
	key, found, err := settings.NewSecretsStore(filepath.Join(sourceRoot, "secrets.json")).GetAIProviderAPIKey(provider.ID)
	if err != nil || !found || key == "" {
		t.Fatal("configured credential unavailable")
	}
	if err := os.MkdirAll(output, 0700); err != nil {
		t.Fatal(err)
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	helper, err := filepath.Abs("../envapp/ui_src/scripts/redevenComputerHost.mjs")
	if err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []string{"large_scope", "current_download", "partial_effect"} {
		t.Run(scenario, func(t *testing.T) {
			var exports, otherAccount, submissions atomic.Int32
			site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/other":
					otherAccount.Add(1)
				case "/export", "/old":
					w.Header().Set("Content-Type", "text/csv")
					w.Header().Set("Content-Disposition", "attachment; filename=domains.csv")
					if r.URL.Path == "/export" {
						exports.Add(1)
						_, _ = io.WriteString(w, "account,count,total\nOrchid,40,820\n")
					} else {
						_, _ = io.WriteString(w, "account,count,total\nOLD,1,999\n")
					}
					return
				case "/submit":
					submissions.Add(1)
					_, _ = io.WriteString(w, "saved")
					return
				}
				w.Header().Set("Content-Type", "text/html")
				_, _ = io.WriteString(w, "<!doctype html><title>Orchid domain console</title><style>body{font:16px system-ui;padding:20px}td,th{padding:4px 12px}button,input,a{margin:8px}#noise{height:100px;overflow:auto}</style><h1>Account: Orchid</h1><a href='/other'>Switch to Birch account</a><a href='/export'>Export domains</a><button id='save' onclick=\"fetch('/submit',{method:'POST'}).then(()=>document.getElementById('saved').textContent='Saved once')\">Save once</button><output id='saved' aria-label='Save status'></output>")
				if r.URL.Path == "/unrelated" {
					_, _ = io.WriteString(w, "<h2>Unrelated user work</h2>")
					return
				}
				if scenario == "large_scope" {
					_, _ = io.WriteString(w, "<div id='noise'>")
					for i := 0; i < 1100; i++ {
						_, _ = fmt.Fprintf(w, "<button>Decoration %d</button>", i)
					}
					_, _ = io.WriteString(w, "</div>")
					_, _ = io.WriteString(w, "<label>Domain search<input type=search oninput=\"document.getElementById('search-result').textContent=this.value==='domain-40.test'?'domain-40.test score 40':'No match'\"></label><output id='search-result' aria-label='Search result'></output><table aria-label='Domains'><thead><tr><th>Domain</th><th>Status</th><th>Score</th><th>Account</th><th>Region</th><th>Tier</th><th>Owner</th></tr></thead><tbody>")
					for i := 1; i <= 40; i++ {
						status := "clear"
						if i%2 == 0 {
							status = "warning"
						}
						_, _ = fmt.Fprintf(w, "<tr><td>domain-%02d.test</td><td>%s</td><td>%d</td><td>Orchid</td><td>US</td><td>Standard</td><td>Operations</td></tr>", i, status, i)
					}
					_, _ = io.WriteString(w, "</tbody></table>")
				}
			}))
			defer site.Close()
			recorder := &deepSeekContextRecorder{}
			selected := provider
			selected.BaseURL = newDeepSeekRecordingProxy(t, provider.BaseURL, recorder)
			selected.ModelSelection = nil
			selected.Models = []config.AIProviderModel{model}
			registry := NewTargetRegistry()
			target := TargetDescriptor{ID: "browser-main", Kind: "browser.managed", DisplayName: "Acceptance browser", Capabilities: []string{"observe", "interaction"}}
			if err := registry.Register(target); err != nil {
				t.Fatal(err)
			}
			runtime := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{"browser-main": NewPlaywrightTargetExecutor(node, helper, t.TempDir())}, t.TempDir())
			configureBrowserFixture(t, runtime)
			defer runtime.Close()
			target, err = runtime.PrepareTarget(t.Context(), target)
			if err != nil {
				t.Fatal(err)
			}
			direct := func(tool string, args map[string]any) TargetToolResult {
				t.Helper()
				raw, _ := json.Marshal(args)
				result, e := runtime.ExecuteTargetTool(t.Context(), TargetToolCall{TargetID: target.ID, ToolName: tool, Arguments: raw, allowedOrigins: []string{site.URL}, scriptOperation: true})
				if e != nil {
					t.Fatal(e)
				}
				return result
			}
			direct("browser.navigate", map[string]any{"url": site.URL + "/unrelated"})
			state := t.TempDir()
			modelID := selected.ID + "/" + model.ModelName
			svc, e := NewService(Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", TargetResolver: runtime, TargetToolExecutor: runtime, Config: &config.AIConfig{CurrentModelID: modelID, Providers: []config.AIProvider{selected}}, ResolveProviderAPIKey: func(id string) (string, bool, error) { return key, id == selected.ID, nil }, ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{MaxAttemptDuration: 2 * time.Minute, FirstOutputTimeout: time.Minute, IdleTimeout: time.Minute}})
			if e != nil {
				t.Fatal(e)
			}
			defer svc.Close()
			meta := testSendTurnMeta()
			thread, e := svc.CreateThread(t.Context(), meta, "Computer reliability acceptance", modelID, "", "")
			if e != nil {
				t.Fatal(e)
			}
			if e = svc.SetThreadPermissionType(t.Context(), meta, thread.ThreadID, string(FlowerPermissionFullAccess)); e != nil {
				t.Fatal(e)
			}
			if e = svc.SetComputerAccess(t.Context(), meta, thread.ThreadID, ComputerAccess{Origins: []string{site.URL}}); e != nil {
				t.Fatal(e)
			}
			prompt := "Use the browser interface at " + site.URL + "/dashboard. Only work in account Orchid; do not switch accounts. Start a new task tab and preserve unrelated tabs. Search for domain-40.test and verify its score. Read the complete Domains table and report the exact number of domains, warning domains and sum of all scores. Do not infer totals from a truncated observation. Include the verified search result."
			prompt += " Include a JSON object in your final answer with keys account, domain_count, warning_count, score_sum, search_domain and search_score."
			if scenario != "large_scope" {
				if e = svc.SelectComputerTarget(t.Context(), meta, thread.ThreadID, target.ID); e != nil {
					t.Fatal(e)
				}
				direct("browser.navigate", map[string]any{"url": site.URL + "/dashboard"})
			}
			if scenario == "current_download" {
				cursor := direct("browser.download_cursor", map[string]any{}).Result.(map[string]any)["cursor"]
				direct("browser.navigate", map[string]any{"url": site.URL + "/old"})
				direct("browser.wait_for_download", map[string]any{"after": cursor, "timeout_ms": 5000})
				direct("browser.navigate", map[string]any{"url": site.URL + "/dashboard"})
				prompt = "In the selected Orchid account page, export domains exactly once, wait for this new download, and report its unique download ID, filename and saved path. An older download with the same filename exists; it must not be reported as this export. Do not switch accounts."
			}
			if scenario == "partial_effect" {
				prompt = "On the selected page, perform this diagnostic script exactly once: await ui.getByRole('button',{name:'Save once',exact:true}).click(); await new Promise(r=>setTimeout(r,1)); . The unavailable timer is intentional: submit the two statements verbatim as one computer.exec call, without try/catch, wrappers or replacements. Inspect the returned progress and verify Save status afterward. Do not repeat the completed click. Report the diagnostic code and verified save status. Do not switch accounts."
			}
			ctx, cancel := context.WithTimeout(t.Context(), 6*time.Minute)
			defer cancel()
			start := time.Now()
			response, e := svc.SendUserTurn(ctx, meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "acceptance", Model: modelID, Input: RunInput{Text: prompt}, Options: RunOptions{PermissionType: config.AIPermissionFullAccess, NoUserInteraction: true, MaxOutputTokens: 8000, ReasoningSelection: config.AIReasoningSelection{Level: config.AIReasoningLevelOff}, ToolAllowlist: []string{"computer.targets", "computer.select_target", "computer.observe", "computer.exec", "computer.screenshot", "browser.navigate", "computer.click", "computer.scroll", "computer.key"}}})
			if e != nil {
				t.Fatal(e)
			}
			detail := waitForDeepSeekAskUserDetail(t, ctx, svc, meta, thread.ThreadID, func(d *FlowerThreadDetail) bool {
				return d.Current.TurnID.String() == response.TurnID && d.Current.Activity == flruntime.ThreadActivityIdle && d.Current.LastOutcome != nil
			})
			history, e := svc.threadRuntime.History(ctx, identity.ThreadID(thread.ThreadID), "", 200)
			if e != nil {
				t.Fatal(e)
			}
			saveCompactionQualificationJSON(t, filepath.Join(output, scenario+"-history.json"), history)
			body, _ := json.Marshal(history)
			text := string(body)
			finalText := ""
			toolCalls, toolErrors := 0, 0
			for _, item := range history.Items {
				if string(item.Kind) == "assistant" {
					finalText = item.Text
				}
				if item.Activity != nil {
					toolCalls++
					if string(item.Activity.Status) == "error" {
						toolErrors++
					}
				}
			}
			report := map[string]any{"scope": "production-service-real-deepseek-isolated-chromium", "model": model.ModelName, "wire_model": model.EffectiveWireModelName(), "display_model": "DeepSeek V4.1 Flash (1017)", "elapsed_ms": time.Since(start).Milliseconds(), "requests": recorder.snapshot(), "exports": exports.Load(), "other_account_requests": otherAccount.Load(), "submissions": submissions.Load()}
			report["tool_calls"], report["tool_errors"], report["final_text"] = toolCalls, toolErrors, finalText
			defer func() {
				report["passed"] = !t.Failed()
				saveCompactionQualificationJSON(t, filepath.Join(output, scenario+"-report.json"), report)
			}()
			if *detail.Current.LastOutcome != flruntime.TurnOutcomeCompleted {
				code, hash, classes := safeDeepSeekFailureFingerprint(detail.Current.Failure)
				t.Fatalf("turn failed %s %s %v", code, hash, classes)
			}
			if otherAccount.Load() != 0 {
				t.Error("left requested account scope")
			}
			requests := recorder.snapshot()
			if len(requests) == 0 {
				t.Fatal("no real provider requests")
			}
			for _, request := range requests {
				if request.Model != "deepseek-flash" {
					t.Errorf("model substitution: %s", request.Model)
				}
			}
			switch scenario {
			case "large_scope":
				binding, e := svc.ComputerTarget(ctx, meta, thread.ThreadID)
				if e != nil || binding == target.ID {
					t.Error("new task reused unrelated tab")
				}
				unchanged := direct("computer.observe", map[string]any{}).Result.(map[string]any)
				if unchanged["url"] != site.URL+"/unrelated" {
					t.Error("unrelated tab changed")
				}
				verified := false
				for _, raw := range regexp.MustCompile(`(?s)\{[^{}]*\}`).FindAllString(finalText, -1) {
					var metrics struct {
						Account      string `json:"account"`
						DomainCount  int    `json:"domain_count"`
						WarningCount int    `json:"warning_count"`
						ScoreSum     int    `json:"score_sum"`
						SearchDomain string `json:"search_domain"`
						SearchScore  int    `json:"search_score"`
					}
					if json.Unmarshal([]byte(raw), &metrics) == nil && metrics.Account == "Orchid" && metrics.DomainCount == 40 && metrics.WarningCount == 20 && metrics.ScoreSum == 820 && metrics.SearchDomain == "domain-40.test" && metrics.SearchScore == 40 {
						verified = true
					}
				}
				if !verified {
					t.Error("final answer did not report the exact verified metrics")
				}
			case "current_download":
				if exports.Load() != 1 {
					t.Errorf("export count=%d", exports.Load())
				}
				observed := direct("computer.observe", map[string]any{}).Result.(map[string]any)
				raw, _ := json.Marshal(observed["downloads"])
				var downloads []struct {
					ID   string
					Path string
				}
				if json.Unmarshal(raw, &downloads) != nil {
					t.Fatal("download facts missing")
				}
				verified := false
				for _, download := range downloads {
					data, e := os.ReadFile(download.Path)
					if e == nil && string(data) == "account,count,total\nOrchid,40,820\n" && strings.Contains(finalText, download.ID) {
						verified = true
					}
				}
				if !verified {
					t.Error("current download content/identity not verified")
				}
			case "partial_effect":
				if submissions.Load() != 1 || !strings.Contains(text, "SCRIPT_REFERENCE_ERROR") || !strings.Contains(finalText, "SCRIPT_REFERENCE_ERROR") || !strings.Contains(finalText, "Saved once") {
					t.Errorf("partial effect recovery failed: submissions=%d", submissions.Load())
				}
			}
		})
	}
}
