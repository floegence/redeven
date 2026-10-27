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
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	fltools "github.com/floegence/floret/v7/tools"
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
	// Qualification reads only the user's provider profile. It never opens,
	// migrates or enrolls the unrelated production Runtime configuration.
	body, err := os.ReadFile(filepath.Join(sourceRoot, "config.json"))
	var source struct {
		AI *config.AIConfig `json:"ai"`
	}
	if err != nil || json.Unmarshal(body, &source) != nil || source.AI == nil || source.AI.Validate() != nil {
		t.Fatal("local AI profile unavailable or invalid")
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
	repetitions := 1
	if value := os.Getenv("REDEVEN_COMPUTER_ACCEPTANCE_REPETITIONS"); value != "" {
		var e error
		repetitions, e = strconv.Atoi(value)
		if e != nil || repetitions < 1 || repetitions > 5 {
			t.Fatal("repetitions must be 1..5")
		}
	}
	for repeat := 1; repeat <= repetitions; repeat++ {
		for _, scenario := range []string{"native_entry", "script_batch", "mixed_download", "bounded_read", "repair_limit", "budget_prefix", "large_scope", "current_download", "partial_effect", "key_validation", "scoped_query", "image_input", "wait_default", "title_freshness", "stale_frame", "invalid_options", "scroll_progress", "condition_wait", "natural_input", "natural_read", "strict_wait", "scrolled_click", "content_wait", "namespace_reset", "canonical_navigation"} {
			t.Run(fmt.Sprintf("%s/%d", scenario, repeat), func(t *testing.T) {
				// Every case owns its service, browser, fixture and output directory.
				t.Parallel()
				output := filepath.Join(output, fmt.Sprintf("%02d", repeat))
				if err := os.MkdirAll(output, 0700); err != nil {
					t.Fatal(err)
				}
				var exports, otherAccount, submissions, focused, entered, pointerClicks atomic.Int32
				var visitedPages [3]atomic.Bool
				var typedValue atomic.Value
				site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					switch r.URL.Path {
					case "/pointer":
						pointerClicks.Add(1)
						return
					case "/focused":
						focused.Add(1)
						return
					case "/typed":
						typedValue.Store(r.URL.Query().Get("value"))
						return
					case "/batch":
						page, _ := strconv.Atoi(r.URL.Query().Get("page"))
						if page < 1 || page > 3 {
							page = 1
						}
						visitedPages[page-1].Store(true)
						w.Header().Set("Content-Type", "text/html")
						_, _ = fmt.Fprintf(w, `<title>Batch report</title><p>Three report pages; each page has one score. Page URLs use ?page=1 through ?page=3.</p><div role="region" aria-label="Score">%d</div><a href="/batch?page=%d">Next page</a>`, page*7, page+1)
						return
					case "/entered":
						entered.Add(1)
						return
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
					if scenario == "scrolled_click" {
						_, _ = io.WriteString(w, "<style>#save{position:absolute;top:1800px;left:200px}body{height:4000px}</style>")
					}
					if scenario == "content_wait" {
						_, _ = io.WriteString(w, `<nav aria-label="Pagination"><input id="page-number" aria-label="Page number" value="1"><button onclick="fetch('/entered',{method:'POST'});setTimeout(()=>document.getElementById('page-number').value='2',250)">Next page</button></nav>`)
					}
					if scenario == "canonical_navigation" {
						_, _ = io.WriteString(w, "<nav aria-label='Pagination'><button>Previous page</button><button>Next page</button></nav>")
					}
					if r.URL.Path == "/unrelated" {
						_, _ = io.WriteString(w, "<h2>Unrelated user work</h2>")
						return
					}
					_, _ = io.WriteString(w, "<script>document.addEventListener('click',()=>fetch('/pointer',{method:'POST'}),true)</script>")
					if scenario != "large_scope" {
						_, _ = io.WriteString(w, "<label>Probe<input aria-label='Probe' oninput=\"fetch('/typed?value='+encodeURIComponent(this.value))\" onfocus=\"fetch('/focused',{method:'POST'})\" onkeydown=\"if(event.key==='Enter')fetch('/entered',{method:'POST'})\"></label><a href='https://example.test/safe?token=private#hidden'>Safe reference</a><div role='region' aria-label='Scrollable' style='height:80px;overflow:auto'><div style='height:500px'>Scroll contents</div></div><button id='ready' disabled>Ready</button><script>setTimeout(()=>document.getElementById('ready').disabled=false,300)</script>")
						for i := 0; i < 7; i++ {
							_, _ = fmt.Fprintf(w, "<button>Query item %d</button>", i)
						}
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
				profileDirectory := t.TempDir()
				runtime := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{"browser-main": NewPlaywrightTargetExecutor(node, helper, profileDirectory)}, t.TempDir())
				configureBrowserFixture(t, runtime)
				var nativeName string
				var nativeFacts func() map[string]any
				if scenario == "native_entry" {
					nativeName, nativeFacts = prepareComputerEntryFixture(t)
					root, _ := filepath.Abs("../..")
					native := NewNativeDesktopTargetExecutor(filepath.Join(root, "desktop/native/computer-host/.build/release/redeven-computer-host"))
					runtime.executors["desktop-main"] = native
					if err := registry.Register(TargetDescriptor{ID: "desktop-main", Kind: "desktop.screen"}); err != nil {
						t.Fatal(err)
					}
				}
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
				project := t.TempDir()
				modelID := selected.ID + "/" + model.ModelName
				svc, e := NewService(Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", TargetResolver: runtime, TargetToolExecutor: runtime, Config: &config.AIConfig{CurrentModelID: modelID, Providers: []config.AIProvider{selected}}, ResolveProviderAPIKey: func(id string) (string, bool, error) { return key, id == selected.ID, nil }, ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{MaxAttemptDuration: 2 * time.Minute, FirstOutputTimeout: time.Minute, IdleTimeout: time.Minute}})
				if e != nil {
					t.Fatal(e)
				}
				defer svc.Close()
				meta := testSendTurnMeta()
				thread, e := svc.CreateThread(t.Context(), meta, "Computer reliability acceptance", modelID, "", project)
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

				switch scenario {
				case "script_batch":
					prompt = "Open " + site.URL + "/batch?page=1 in this task's page, read all three scores and calculate their total. Once the page structure is known, process the remaining pages in one computer script using a loop and return a screenshot of the last page. Keep the original browser page available; do not use network scraping."
				case "native_entry":
					prompt = "Open the installed native application named " + nativeName + " using Computer Use discovery and selection. Enter exactly Flash 1017 in Acceptance code, click Confirm exactly once, read the resulting confirmation and capture a screenshot. This is a disposable acceptance app; do not touch any other application."
				case "mixed_download":
					prompt = "Export Orchid domains exactly once from the selected page. Save the exact completed download through browser.saveDownload, then use a terminal script to calculate total divided by count and save that result as acceptance-ratio.txt in the selected project directory. Inspect the file and report its absolute path. Use the normal tools available; do not fetch the export URL outside the browser or switch accounts."
				case "bounded_read":
					prompt = "Use ui.help('read') and locator.text() to read visible text of the region named Scrollable, then log its text, truncated and scope. Do not click, scroll, navigate or use shell/network tools."
				case "repair_limit":
					prompt = "Run await ui.snapshot({limit:1200}) exactly once as an intentional diagnostic. Report its method, field and expected range. Correct the limit in a separate call, observe the page, and report its title. Do not click or use shell/network tools."
				case "budget_prefix":
					prompt = "Submit all four statements verbatim as one computer.exec call exactly once: log(ui.budget()); log('completed-safe-read'); await ui.getByRole('button',{name:'Save once',exact:true}).click(); setTimeout(()=>{},1); . The unavailable timer is intentional and must not be removed, replaced or caught. Report the returned diagnostic, retained logs and context_reset, then observe Save status. Never repeat the click."
				case "scrolled_click":
					prompt = "On the selected page, find Save once (below the fold), click it exactly once, and verify Save status. Do not click any other control or use shell/network tools."
				case "content_wait":
					prompt = "On the selected page, inspect the Pagination navigation region, click Next page once, wait until Page number has value 2, then read and report its value. The update is asynchronous. Use a condition wait; do not repeat the click or use shell/network tools."
				case "canonical_navigation":
					prompt = "Inspect the selected page and find its Pagination navigation landmark by canonical role. Report the number and names of buttons scoped to that landmark. Do not click anything or use shell/network tools."
				case "namespace_reset":
					prompt = "Run this intentional diagnostic once as one computer.exec: globalThis.collected=[7,11,13]; await ui.getByRole('button',{name:'Save once',exact:true}).click(); setTimeout(()=>{},1); . After its error, inspect context_reset, use a separate call to log(typeof collected), and verify Save status. Report the diagnostic location and reset. Never repeat the click or rebuild collected."
				case "natural_input":
					prompt = "On the selected page, enter exactly Orchid acceptance 1017 in Probe, then press Enter once. Verify the field's exact contents and report them. Do not save, switch accounts or use shell/network tools."
				case "natural_read":
					prompt = "On the selected page, count every Query item button and report each name. Read the safe summary URL of the Safe reference link without navigating to it. Do not input anything or use shell/network tools."
				case "strict_wait":
					prompt = "Run this diagnostic once: await ui.getByRole('textbox',{name:'Probe',exact:true}).fill('first'); await ui.getByRole('button',{name:'Never exists',exact:true}).requireState({state:'visible',timeout_ms:0}); await ui.getByRole('button',{name:'Save once',exact:true}).click(); . The timeout is intentional. Report its diagnostic, observe the page, and do not retry the save."
				case "key_validation":
					prompt = "This fixture test requires TWO separate computer.exec calls. First run await ui.getByRole('textbox',{name:'Probe',exact:true}).press('Meta+Equal') exactly once. Its validation rejection is intentional. You must then make a second call: await ui.getByRole('textbox',{name:'Probe',exact:true}).press('Enter'); . Complete both steps before reporting their results. Do not retry Meta+Equal. Never click Save once or switch accounts."
				case "scoped_query":
					prompt = "Exercise pagination with this exact computer.exec script: const loc=ui.getByRole('button',{name:'Query item'}); let cursor; do { const page=await loc.query({limit:3,cursor}); log(JSON.stringify(page)); cursor=page.next_cursor; } while(cursor); log(JSON.stringify(await ui.getByRole('link',{name:'Safe reference',exact:true}).getAttribute('href'))); . Do not change the page size. Report the exact count and names, including Query item 6, and the safe href. Do not open that link."
				case "image_input":
					prompt = "Exercise image coordinates by running this exact computer.exec script ONCE: const g=(await ui.screenshot()).frame_geometry; log(JSON.stringify(g)); const result=await ui.click(4,4,{coordinate_space:'image_pixels',frame:g.frame,document_id:g.document_id}); log(JSON.stringify(result)); . The point is the blank top-left margin. Exactly one click is permitted, with no second verification click and no unbound coordinate click. Report the returned action_executed and completion."
				case "wait_default":
					prompt = "Call computer.wait on the selected fixture with milliseconds omitted, then observe and report the exact current title. Do not input anything."
				case "title_freshness":
					prompt = "Navigate the selected browser to " + site.URL + "/dashboard?fresh=1, then use await ui.observe({emit:false}) and log its title and url. Finally run log('identity-check') with no UI operations. Report the observed current title without treating an old discovery label as current."
				case "stale_frame":
					prompt = "Exercise the stale-frame boundary by running this exact script once through computer.exec, without wrappers or try/catch: const old = (await ui.screenshot()).frame_geometry; await browser.navigate('" + site.URL + "/dashboard?new=1'); await ui.click(4,4,{coordinate_space:'image_pixels',frame:old.frame,document_id:old.document_id}); . Report the returned diagnostic and observe the current page. Do not retry the click."
				case "invalid_options":
					prompt = "Run await ui.getByRole('button',{name:'Save once',exact:true}).waitFor({timeout_ms:-1}) exactly once without wrappers or try/catch. Report the returned SCRIPT_ARGUMENT_ERROR, then observe the page. Do not click or save."
				case "scroll_progress":
					prompt = "Observe the selected page, then scroll the region named Scrollable downward by 80 pixels using locator.scroll. Log its scroll_progress with before, after and measurement. Observe afterwards and report what was measured; do not assume unchanged means failure."
				case "condition_wait":
					prompt = "Wait for the Ready button to become enabled using locator.waitFor({state:'enabled',timeout_ms:5000}). Log the returned state and read the button. Do not click any buttons. Report the observed enabled state."
				}

				ctx, cancel := context.WithTimeout(t.Context(), 6*time.Minute)
				defer cancel()
				start := time.Now()
				// Natural tasks use the production default surface, without a test allowlist.
				// Only the legacy primitive contract case explicitly retains its tool.
				var allowlist []string
				if scenario == "wait_default" {
					allowlist = []string{"computer.targets", "computer.select_target", "computer.exec", "computer.wait"}
				}
				response, e := svc.SendUserTurn(ctx, meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "acceptance", Model: modelID, Input: RunInput{Text: prompt}, Options: RunOptions{PermissionType: config.AIPermissionFullAccess, NoUserInteraction: true, MaxOutputTokens: 8000, ReasoningSelection: config.AIReasoningSelection{Level: config.AIReasoningLevelOff}, ToolAllowlist: allowlist}})
				if e != nil {
					t.Fatal(e)
				}
				defer func() {
					if _, err := os.Stat(filepath.Join(output, scenario+"-report.json")); err == nil {
						return
					}
					evidenceCtx, done := context.WithTimeout(context.Background(), 5*time.Second)
					defer done()
					history, historyErr := svc.threadRuntime.History(evidenceCtx, identity.ThreadID(thread.ThreadID), "", 200)
					if historyErr == nil {
						saveCompactionQualificationJSON(t, filepath.Join(output, scenario+"-history.json"), history)
					}
					saveCompactionQualificationJSON(t, filepath.Join(output, scenario+"-report.json"), map[string]any{"passed": false, "incomplete": true, "wire_model": model.EffectiveWireModelName(), "requests": recorder.snapshot(), "elapsed_ms": time.Since(start).Milliseconds(), "focused": focused.Load(), "entered": entered.Load()})
				}()
				detail := waitForDeepSeekAskUserDetail(t, ctx, svc, meta, thread.ThreadID, func(d *FlowerThreadDetail) bool {
					return d.Current.TurnID.String() == response.TurnID && (d.Current.Activity == flruntime.ThreadActivityIdle && d.Current.LastOutcome != nil || string(d.Current.Activity) == "waiting")
				})
				history, e := svc.threadRuntime.History(ctx, identity.ThreadID(thread.ThreadID), "", 200)
				if e != nil {
					t.Fatal(e)
				}
				saveCompactionQualificationJSON(t, filepath.Join(output, scenario+"-history.json"), history)
				// Assertions inspect actual tool facts; the user prompt is never evidence.
				var toolEvidence strings.Builder
				scriptErrors := map[string]int{}
				var confirmedToolFacts []map[string]any
				contentWaitConfirmed, resetConfirmed, clickRejected := false, false, false
				reader := svc.threadRuntime.(flruntime.ThreadToolResultReader)
				for _, item := range history.Items {
					if item.Activity != nil {
						if isComputerUseTool(item.Activity.ToolName) {
							confirmed, found, err := reader.LookupToolResult(ctx, flruntime.LookupToolResultInput{ThreadID: identity.ThreadID(thread.ThreadID), TurnID: item.TurnID, RunID: item.RunID, ToolCallID: item.Activity.ToolID})
							if err != nil || !found {
								t.Fatalf("canonical result unavailable: %v", err)
							}
							data, err := computerQualificationResultData(confirmed)
							if err != nil {
								t.Fatalf("invalid canonical %s result (%s): %v", confirmed.ToolName, confirmed.Status, err)
							}
							code := anyToString(data["script_error"])
							if code != "" {
								scriptErrors[code]++
							}
							fact := map[string]any{"tool": confirmed.ToolName, "status": confirmed.Status, "script_error": code, "completed_actions": data["completed_actions"], "action_executed": data["action_executed"]}
							fact["context_reset"], fact["diagnostic"] = data["context_reset"], data["diagnostic"]
							fact["logs"], fact["budget"] = data["logs"], data["budget"]
							fact["failed_action"] = data["failed_action"]
							if code == "ELEMENT_NOT_ACTIONABLE" && data["failed_action"] == "click" {
								clickRejected = true
							}
							if code == "SCRIPT_REFERENCE_ERROR" && data["context_reset"] == true {
								diagnostic, _ := data["diagnostic"].(map[string]any)
								resetConfirmed = diagnostic["symbol"] == "setTimeout" && diagnostic["line"] != nil
							}
							if data["completed"] == true {
								for _, action := range toAnySlice(data["completed_actions"]) {
									if action == "wait" {
										contentWaitConfirmed = true
									}
								}
							}

							if data == nil && confirmed.Status == "error" {
								fact["runtime_error_text"] = confirmed.Content
							}
							confirmedToolFacts = append(confirmedToolFacts, fact)
						}
						activity := publicActivityItem(*item.Activity)
						toolEvidence.WriteString(activity.ToolName)
						if activity.Presentation != nil {
							if payload, ok := activity.Presentation.Payload.(fltools.StructuredActivityPayload); ok {
								// Input scripts and model-authored final prose cannot prove a result.
								payload.Inputs = nil
								body, _ := json.Marshal(payload)
								toolEvidence.Write(body)
							}
						}
					}
				}
				text := toolEvidence.String()
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
				report := map[string]any{"scope": "production-service-real-deepseek-isolated-chromium", "model": model.ModelName, "wire_model": model.EffectiveWireModelName(), "display_model": "DeepSeek V4.1 Flash (1017)", "elapsed_ms": time.Since(start).Milliseconds(), "requests": recorder.snapshot(), "exports": exports.Load(), "other_account_requests": otherAccount.Load(), "submissions": submissions.Load(), "focused": focused.Load(), "entered": entered.Load(), "repeat": repeat}
				report["tool_calls"], report["tool_errors"], report["final_text"] = toolCalls, toolErrors, finalText
				report["script_errors"], report["confirmed_tool_facts"] = scriptErrors, confirmedToolFacts
				report["pointer_clicks"] = pointerClicks.Load()
				report["typed_value"] = typedValue.Load()
				report["surface"] = "production_default"
				if scenario == "wait_default" {
					report["surface"] = "explicit_legacy_consumer"
				}
				defer func() {
					report["passed"] = !t.Failed()
					saveCompactionQualificationJSON(t, filepath.Join(output, scenario+"-report.json"), report)
				}()
				if detail.Current.LastOutcome == nil || *detail.Current.LastOutcome != flruntime.TurnOutcomeCompleted {
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
					if scenario != "wait_default" {
						for _, name := range request.DefinitionToolNames {
							normalized := strings.ReplaceAll(name, "_", ".")
							if strings.HasPrefix(normalized, "computer.") || strings.HasPrefix(normalized, "browser.") {
								if normalized != "computer.targets" && normalized != "computer.select.target" && normalized != "computer.exec" {
									t.Errorf("noncompact default tool: %s", name)
								}
							}
						}
					}
					if request.Model != "deepseek-flash" {
						t.Errorf("model substitution: %s", request.Model)
					}
				}
				switch scenario {
				case "scrolled_click":
					if submissions.Load() != 1 || clickRejected || !strings.Contains(text, "Saved once") {
						t.Errorf("scrolled click failed: submissions=%d errors=%v", submissions.Load(), scriptErrors)
					}
				case "script_batch":
					batched, captured := false, false
					confirmedTotal := false
					reads := 0
					for _, fact := range confirmedToolFacts {
						// A final answer may be malformed even after a verified batch.
						// Keep that provider/output outcome separate from tool execution.
						logs, _ := json.Marshal(fact["logs"])
						confirmedTotal = confirmedTotal || regexp.MustCompile(`\b42\b`).Match(logs)
						navigations := 0
						for _, action := range toAnySlice(fact["completed_actions"]) {
							if action == "snapshot" || action == "read" || action == "text" {
								reads++
							}
							if action == "navigate" || action == "click" {
								navigations++
							}
							if action == "screenshot" {
								captured = true
							}
						}
						batched = batched || navigations >= 2
					}
					report["batch_confirmed"], report["screenshot_confirmed"] = batched, captured
					report["clean_script_execution"] = len(scriptErrors) == 0
					report["visited_pages"] = []bool{visitedPages[0].Load(), visitedPages[1].Load(), visitedPages[2].Load()}
					report["confirmed_reads"] = reads
					report["confirmed_total"], report["final_answer_has_total"] = confirmedTotal, strings.Contains(finalText, "42")
					// Calculation may happen in the final model reply rather than in
					// JavaScript. Neither is proof of page reads; those are checked above.
					if !batched || !captured || reads < 3 || !visitedPages[0].Load() || !visitedPages[1].Load() || !visitedPages[2].Load() {
						t.Errorf("batch facts missing: batch=%v image=%v errors=%v", batched, captured, scriptErrors)
					}
				case "mixed_download":
					file, readErr := os.ReadFile(filepath.Join(project, "acceptance-ratio.txt"))
					saved := false
					for _, fact := range confirmedToolFacts {
						for _, action := range toAnySlice(fact["completed_actions"]) {
							saved = saved || action == "save_download"
						}
					}
					if !saved || exports.Load() != 1 || readErr != nil || !strings.Contains(string(file), "20.5") || !strings.Contains(text, "terminal.exec") {
						t.Errorf("mixed tool handoff failed: exports=%d file=%v", exports.Load(), readErr)
					}
				case "native_entry":
					facts := nativeFacts()
					report["native_facts"] = facts
					discovered, selected, captured := false, false, false
					for _, fact := range confirmedToolFacts {
						discovered = discovered || fact["tool"] == "computer.targets"
						selected = selected || fact["tool"] == "computer.select_target" && fact["status"] == "success" && fact["action_executed"] == true
						for _, action := range toAnySlice(fact["completed_actions"]) {
							captured = captured || action == "screenshot"
						}
					}
					if !discovered || !selected || !captured || facts["clicks"] != float64(1) || facts["value"] != "Flash 1017" || !strings.Contains(text, "Confirmed: Flash 1017") {
						t.Errorf("native entry not confirmed: %+v", facts)
					}
				case "bounded_read":
					if !strings.Contains(text, "rendered_element") || !strings.Contains(text, "Scroll contents") || pointerClicks.Load() != 0 {
						t.Error("bounded visible text not verified")
					}
				case "repair_limit":
					factsJSON, _ := json.Marshal(confirmedToolFacts)
					if scriptErrors["SCRIPT_ARGUMENT_ERROR"] != 1 || !strings.Contains(string(factsJSON), "integer_1_1000") || !strings.Contains(text, "Orchid domain console") || pointerClicks.Load() != 0 {
						t.Error("limit diagnostic and recovery not verified")
					}
				case "budget_prefix":
					if scriptErrors["SCRIPT_REFERENCE_ERROR"] != 1 || !strings.Contains(text, "completed-safe-read") || !strings.Contains(text, "remaining_operations") || submissions.Load() != 1 {
						t.Error("budget and explicit prefix not verified")
					}
				case "content_wait":
					if !contentWaitConfirmed || entered.Load() != 1 || !strings.Contains(text, "value") || !strings.Contains(finalText, "2") {
						t.Errorf("content wait failed: next=%d", entered.Load())
					}
				case "canonical_navigation":
					if pointerClicks.Load() != 0 || !strings.Contains(text, "navigation") || !strings.Contains(finalText, "Previous page") || !strings.Contains(finalText, "Next page") {
						t.Error("canonical navigation read failed")
					}
				case "namespace_reset":
					if !resetConfirmed || submissions.Load() != 1 || scriptErrors["SCRIPT_REFERENCE_ERROR"] != 1 || !strings.Contains(text, "undefined") {
						t.Errorf("namespace reset failed: submissions=%d errors=%v", submissions.Load(), scriptErrors)
					}
				case "natural_input":
					if typedValue.Load() != "Orchid acceptance 1017" || entered.Load() != 1 || !strings.Contains(finalText, "Orchid acceptance 1017") || submissions.Load() != 0 {
						t.Errorf("input verification failed: typed=%v enter=%d", typedValue.Load(), entered.Load())
					}
				case "natural_read":
					for i := 0; i < 7; i++ {
						if !strings.Contains(finalText, fmt.Sprintf("Query item %d", i)) {
							t.Error("missing query item")
						}
					}
					if !strings.Contains(text, "https://example.test/safe") || pointerClicks.Load() != 0 {
						t.Error("safe read facts missing")
					}
				case "strict_wait":
					if scriptErrors["CONDITION_TIMEOUT"] == 0 || submissions.Load() != 0 {
						t.Error("strict timeout failed to stop following input")
					}
				case "key_validation":
					if !strings.Contains(text, "Meta+= or Enter") || entered.Load() != 1 || focused.Load() != 1 {
						t.Errorf("key validation/recovery: focused=%d entered=%d", focused.Load(), entered.Load())
					}
				case "scoped_query":
					if !strings.Contains(text, "next_cursor") || !strings.Contains(finalText, "Query item 6") || !strings.Contains(finalText, "https://example.test/safe") {
						t.Error("scoped query/attribute facts missing")
					}
				case "image_input":
					if !strings.Contains(text, "image_pixels") || pointerClicks.Load() != 1 {
						t.Error("image input contract not exercised")
					}
				case "wait_default":
					if !strings.Contains(text, "computer.wait") || !strings.Contains(finalText, "Orchid domain console") {
						t.Error("default wait did not observe current page")
					}
				case "title_freshness":
					if !strings.Contains(text, "identity-check") || !strings.Contains(text, "Orchid domain console") {
						t.Error("fresh identity not verified")
					}
				case "stale_frame":
					if scriptErrors["STALE_REFERENCE"] == 0 || pointerClicks.Load() != 0 {
						t.Error("stale frame rejection not verified")
					}
				case "invalid_options":
					if scriptErrors["SCRIPT_ARGUMENT_ERROR"] == 0 || submissions.Load() != 0 || pointerClicks.Load() != 0 {
						t.Error("invalid options did not fail before input")
					}
				case "scroll_progress":
					if !strings.Contains(text, "immediate_after_dispatch") || !strings.Contains(text, "before") || !strings.Contains(text, "after") {
						t.Error("scroll facts not returned")
					}
				case "condition_wait":
					if !strings.Contains(text, "enabled") || submissions.Load() != 0 || pointerClicks.Load() != 0 {
						t.Error("condition wait not exercised")
					}
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
					// Inspect the fixture-owned filesystem without acquiring model control
					// or issuing an anonymous runtime call after a thread owns the target.
					directory := filepath.Join(profileDirectory, "browser-main", "downloads")
					downloads, err := os.ReadDir(directory)
					if err != nil {
						t.Fatal(err)
					}
					verified := false
					for _, download := range downloads {
						data, e := os.ReadFile(filepath.Join(directory, download.Name()))
						if e == nil && string(data) == "account,count,total\nOrchid,40,820\n" && strings.Contains(finalText, download.Name()) {
							verified = true
						}
					}
					if !verified {
						t.Error("current download content/identity not verified")
					}
				case "partial_effect":
					if submissions.Load() != 1 || scriptErrors["SCRIPT_REFERENCE_ERROR"] == 0 || !strings.Contains(text, "Saved once") {
						t.Errorf("partial effect recovery failed: submissions=%d", submissions.Load())
					}
				}
			})
		}
	}
}

// Floret's canonical error output prefixes the host JSON with "ERROR: ".
// Decode only that published framing. Pre-dispatch runtime rejections can be
// plain text; retain them separately and never infer a script diagnostic.
func computerQualificationResultData(result flruntime.ThreadToolResult) (map[string]any, error) {
	content := result.Content
	if result.Status == "error" {
		content = strings.TrimPrefix(content, "ERROR: ")
		if !strings.HasPrefix(strings.TrimSpace(content), "{") {
			return nil, nil
		}
	}
	var envelope struct{ Data map[string]any }
	if err := json.Unmarshal([]byte(content), &envelope); err != nil {
		return nil, err
	}
	return envelope.Data, nil
}

func TestComputerQualificationCanonicalResultFraming(t *testing.T) {
	for _, tc := range []struct {
		name, status, content, code string
		invalid                     bool
	}{
		{"success", "success", `{"data":{"action_executed":false}}`, "", false},
		{"script failure", "error", `ERROR: {"data":{"script_error":"CONDITION_TIMEOUT"}}`, "CONDITION_TIMEOUT", false},
		{"plain runtime rejection", "error", `ERROR: Tool call not executed.`, "", false},
		{"plain diagnostic is not proof", "error", `ERROR: CONDITION_TIMEOUT`, "", false},
		{"malformed host envelope", "error", `ERROR: {broken`, "", true},
		{"wrong status", "success", `ERROR: {"data":{"script_error":"CONDITION_TIMEOUT"}}`, "", true},
		{"echoed script", "success", `{"data":{"logs":["CONDITION_TIMEOUT"]}}`, "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			data, err := computerQualificationResultData(flruntime.ThreadToolResult{Status: tc.status, Content: tc.content})
			if (err != nil) != tc.invalid || anyToString(data["script_error"]) != tc.code {
				t.Fatalf("data=%v error=%v", data, err)
			}
		})
	}
}
