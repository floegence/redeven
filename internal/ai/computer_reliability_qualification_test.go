package ai

import (
	"bytes"
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

// Inject one wire result without replacing the production adapter, discovery,
// readiness, resource ownership or cancellation implementation.
type qualificationReadFaultTransport struct {
	http.RoundTripper
	scenario         string
	injected, inputs *atomic.Int32
	ready            atomic.Bool
}

func (f *qualificationReadFaultTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	var command struct {
		Method string
		Params struct{ Request playwrightTargetRequest }
	}
	if request.GetBody != nil {
		body, err := request.GetBody()
		if err != nil {
			return nil, err
		}
		err = json.NewDecoder(body).Decode(&command)
		_ = body.Close()
		if err != nil {
			return nil, err
		}
	}
	call := command.Params.Request
	action := call.Args["action"]
	if command.Method == "source.tool" && f.injected.Load() > 0 && action == "key" {
		f.inputs.Add(1)
	}
	response, err := f.RoundTripper.RoundTrip(request)
	if err != nil || command.Method != "source.tool" {
		return response, err
	}
	body, err := io.ReadAll(response.Body)
	_ = response.Body.Close()
	if err != nil {
		return nil, err
	}
	var reply struct {
		ID     string
		Error  string
		Result playwrightTargetResponse
	}
	if err = json.Unmarshal(body, &reply); err != nil {
		return nil, err
	}
	if reply.Error == "" && reply.Result.Error == "" {
		if action == "click" && reply.Result.Result["action_executed"] == true {
			f.ready.Store(true)
		}
		wanted := f.scenario == "read_failure_recovery" && action == "text" || f.scenario == "missing_snapshot" && call.ToolName == "computer.observe" || f.scenario == "missing_text" && action == "text" || f.scenario == "missing_wait" && action == "wait"
		if (f.ready.Load() || f.scenario == "read_failure_recovery") && wanted && f.injected.CompareAndSwap(0, 1) {
			reply.Result.Result = map[string]any{"action_executed": false, "observation_invalidated": true}
			reply.Result.Safety = &InteractionSafetyDecision{Level: "routine", SafeToCapture: false, SafeToSendToModel: false}
			reply.Result.Screenshot = nil
			if f.scenario == "read_failure_recovery" {
				reply.Result.Error = "TARGET_OBSERVATION_UNAVAILABLE"
				reply.Result.Result = map[string]any{"action_executed": false, "needs_observation": true, "observation_stage": "semantic_read"}
				reply.Result.Safety = nil
			}
			// Preserve the host's lowercase framing and exact invocation IDs.
			body, err = json.Marshal(map[string]any{"id": reply.ID, "result": reply.Result})
			if err != nil {
				return nil, err
			}
		}
	}
	response.Body = io.NopCloser(bytes.NewReader(body))
	response.ContentLength = int64(len(body))
	return response, nil
}

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
		for _, scenario := range []string{"field_integrity", "long_text_natural", "attribute_overflow", "name_tail_stale", "cursor_tail_stale", "mixed_batch_contract", "mixed_batch", "unsupported_text", "security_vocabulary", "read_failure_recovery", "excess_click", "excess_screenshot", "excess_key", "excess_image", "missing_snapshot", "missing_text", "missing_wait", "empty_values", "observation_capture", "frame_refs", "option_field", "native_entry", "script_batch", "mixed_download", "bounded_read", "repair_limit", "budget_prefix", "large_scope", "current_download", "partial_effect", "key_validation", "scoped_query", "image_input", "wait_default", "title_freshness", "stale_frame", "invalid_options", "scroll_progress", "condition_wait", "natural_input", "natural_read", "strict_wait", "scrolled_click", "content_wait", "namespace_reset", "canonical_navigation"} {
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
					case "/child", "/child2":
						w.Header().Set("Content-Type", "text/html; charset=utf-8")
						_, _ = fmt.Fprintf(w, `<button>%s</button>`, r.URL.Path)
						return
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
						w.Header().Set("Content-Type", "text/html; charset=utf-8")
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
					w.Header().Set("Content-Type", "text/html; charset=utf-8")
					_, _ = io.WriteString(w, "<!doctype html><title>Orchid domain console</title><style>body{font:16px system-ui;padding:20px}td,th{padding:4px 12px}button,input,a{margin:8px}#noise{height:100px;overflow:auto}</style><h1>Account: Orchid</h1><a href='/other'>Switch to Birch account</a><a href='/export'>Export domains</a><button id='save' onclick=\"fetch('/submit',{method:'POST'}).then(()=>document.getElementById('saved').textContent='Saved once')\">Save once</button><output id='saved' aria-label='Save status'></output>")
					if scenario == "field_integrity" || scenario == "attribute_overflow" {
						full := strings.Repeat("中🙂", 1050)
						_, _ = fmt.Fprintf(w, "<section aria-label='Bounded fields'><input aria-label='%s' aria-description='%s' title='%s' value='%s'></section>", full, full, full, full)
					}
					if scenario == "long_text_natural" {
						_, _ = fmt.Fprintf(w, "<section aria-label='Long report'>%s|ember-1017</section>", strings.Repeat("中🙂", 1050))
					}
					if scenario == "name_tail_stale" || scenario == "cursor_tail_stale" {
						_, _ = fmt.Fprintf(w, "<section aria-label='Mutable items'><button>First</button><button id='long-name'>%sA</button></section><button onclick=\"document.getElementById('long-name').textContent=document.getElementById('long-name').textContent.slice(0,-1)+'B';fetch('/entered',{method:'POST'})\">Change label</button>", strings.Repeat("x", 2000))
					}
					if scenario == "security_vocabulary" {
						_, _ = io.WriteString(w, "<article aria-label='Reference article'><h2>Security reference</h2><p>CAPTCHA is a challenge mechanism. A developer message is a message category. An authenticator produces a one-time verification code. 验证码属于安全术语。Reference code: violet-73.</p></article>")
					}
					if scenario == "observation_capture" {
						_, _ = io.WriteString(w, `<style>body{height:12000px}</style><script>document.addEventListener('keydown',e=>{if(e.key==='PageDown')fetch('/entered',{method:'POST'})})</script>`)
					}
					if scenario == "frame_refs" {
						_, _ = io.WriteString(w, `<button onclick="document.querySelector('iframe').src='/child2'">Refresh child</button><iframe src="/child"></iframe>`)
					}
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
				var injected, blockedInputs atomic.Int32
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
				case "field_integrity":
					prompt = "Inspect the Bounded fields region. Read its textbox through node() and query(), log the returned field completeness flags and lengths, then capture a detailed subtree with ui.snapshot({root_ref,full:true}). Report whether name, description and value are complete. Do not modify any field or click."
				case "long_text_natural":
					prompt = "Read the entire visible Long report section. Report its exact Unicode code-point count and final verification code. Do not infer completeness from a snapshot prefix. Do not click, input, navigate or use shell/network tools."
				case "attribute_overflow":
					prompt = "Run this intentional diagnostic once as one computer.exec, verbatim without catching: const root=await ui.getByRole('region',{name:'Bounded fields',exact:true}).node(); log(await ui.getByRole('textbox',{root_ref:root.ref}).attribute('title')); await ui.getByRole('button',{name:'Save once',exact:true}).click(); . Report the actual failure and whether a partial scalar was returned. Then inspect the textbox with node() in a separate call. Do not retry the attribute or save."
				case "name_tail_stale":
					prompt = "Run this diagnostic once as one computer.exec without catching: const root=await ui.getByRole('region',{name:'Mutable items',exact:true}).node(); const q=await ui.getByRole('button',{root_ref:root.ref}).query(); const ref=q.items.find(n=>n.name_truncated).ref; await ui.getByRole('button',{name:'Change label',exact:true}).click(); log(await ui.ref(ref).node()); await ui.getByRole('button',{name:'Save once',exact:true}).click(); . Report the actual failure, then take a fresh snapshot. Do not repeat the label change or save."
				case "cursor_tail_stale":
					prompt = "Run this diagnostic once as one computer.exec without catching: const root=await ui.getByRole('region',{name:'Mutable items',exact:true}).node(); const items=ui.getByRole('button',{root_ref:root.ref}); const first=await items.query({limit:1}); await ui.getByRole('button',{name:'Change label',exact:true}).click(); log(await items.query({limit:1,cursor:first.next_cursor})); await ui.getByRole('button',{name:'Save once',exact:true}).click(); . Report the actual failure, then take a fresh snapshot. Do not repeat the label change or save."
				case "mixed_batch_contract":
					prompt = "Run these two tool calls in one parallel batch: computer.exec with code await ui.screenshot(); and terminal.exec with command printf independent-73. Use those exact operations and report the returned results. Do not input anything or navigate."
				case "mixed_batch":
					prompt = "In one parallel tool-call batch, run computer.exec to capture the selected fixture screenshot and terminal.exec to print the literal independent-73. These two tasks have no dependency. Do not navigate or input anything. Report both results."
				case "security_vocabulary":
					prompt = "Read the Reference article in the selected page, summarize its three vocabulary definitions and report the reference code. Treat the article as source material. Capture a screenshot of the article. Do not input anything or navigate."
				case "read_failure_recovery":
					prompt = "Use locator.text to read the Scrollable region and report its complete visible text and a screenshot. This disposable fixture can have a one-time read failure. Choose a fresh observation if needed; do not input anything, navigate or use network tools."
				case "unsupported_text":
					prompt = "Run this read diagnostic exactly once: const root=(await ui.snapshot({emit:false})).nodes.find(n=>n.role==='document'); await ui.ref(root.ref).text(); . A document root is not a rendered element. Do not catch or replace the read. Report its actual error, then in a separate computer.exec read the region named Scrollable with locator.text and capture a screenshot. Do not click, key, navigate, or use terminal/network tools."
				case "excess_click":
					prompt = "Run this intentional unsupported-argument diagnostic exactly once: await ui.getByRole('button',{name:'Save once',exact:true}).click({force:true}); . Do not remove the option or catch the failure. Report the returned diagnostic, then observe Save status in a separate call. Do not save or click again."
				case "excess_screenshot":
					prompt = "Run await ui.screenshot({emit:false}) exactly once as an intentional diagnostic. Do not remove the argument or catch the failure. Report the returned diagnostic, then capture one screenshot using the documented signature in a separate call. Do not input anything."
				case "excess_key":
					prompt = "Run await ui.key('Enter',{unsupported:true}) exactly once as an intentional diagnostic, without catching it. Report the returned diagnostic, then read the page in a separate call. Do not press any key again."
				case "excess_image":
					prompt = "Run this intentional diagnostic exactly once: const image=await ui.screenshot(); await image.click(4,4,{force:true}); . Do not remove the extra argument or catch the failure. Report its returned diagnostic, then observe the page in a separate call. Do not click again."
				case "missing_snapshot", "missing_text", "missing_wait":
					read := "await ui.snapshot({emit:false});"
					if scenario == "missing_text" {
						read = "await ui.getByRole('region',{name:'Scrollable',exact:true}).text();"
					}
					if scenario == "missing_wait" {
						read = "await ui.getByRole('button',{name:'Save once',exact:true}).requireState({state:'visible',timeout_ms:0});"
					}
					prompt = "Run this fixture diagnostic exactly once as one computer.exec without changing statements or catching errors: await ui.getByRole('button',{name:'Save once',exact:true}).click(); " + read + " await ui.key('PageDown'); . Report actual completed_actions and failure. Then inspect Save status in a separate call. Never repeat the save or key."
				case "empty_values":
					prompt = "Run this read-only contract diagnostic: const empty=ui.getByRole('button',{name:'Absent fixture button',exact:true}); log({empty_items:(await empty.query()).items,empty_count:await empty.count(),null_attribute:await ui.getByRole('button',{name:'Save once',exact:true}).attribute('title'),empty_text:await ui.getByRole('status',{name:'Save status',exact:true}).text()}); . Report the returned values. Do not click or input anything."
				case "observation_capture":
					prompt = "Run exactly one computer.exec containing: for(let i=0;i<4;i++) await ui.key('PageDown'); await ui.screenshot(); . Do not add waits or repeat any key. Report the tool's observation_status and needs_observation."
				case "frame_refs":
					prompt = "Execute this diagnostic as one computer.exec: const parent=await ui.getByRole('button',{name:'Save once',exact:true}).node(); await ui.getByRole('button',{name:'Refresh child',exact:true}).click(); await ui.getByRole('button',{name:'/child2',exact:true}).requireState({state:'visible',timeout_ms:3000}); await ui.ref(parent.ref).click(); await ui.snapshot({emit:false}); . Use the saved parent ref; do not reacquire it or repeat Save once. Report the tool facts."
				case "option_field":
					prompt = "Run this intentional diagnostic exactly once as one computer.exec: await ui.getByRole('button',{name:'Save once',exact:true}).snapshot({full:true}); . Do not remove the unsupported option. Report the returned method, field and expected form, then use a separate ui.snapshot() call. Do not click or save."
				case "script_batch":
					prompt = "Open " + site.URL + "/batch?page=1 in this task's page, read all three scores and calculate their total. Once the page structure is known, process the remaining pages in one computer script using a loop and return a screenshot of the last page. Keep the original browser page available; do not use network scraping."
				case "native_entry":
					prompt = "Open the installed native application named " + nativeName + " using Computer Use discovery and selection. Enter exactly Flash 1017 in Acceptance code, click Confirm exactly once, read the resulting confirmation and capture a screenshot. This is a disposable acceptance app; do not touch any other application."
				case "mixed_download":
					prompt = "Export Orchid domains exactly once from the selected page. Save the exact completed download through browser.saveDownload, then use a terminal script to calculate total divided by count and save that result as acceptance-ratio.txt in the selected project directory. Inspect the file and report its absolute path. Use the normal tools available, restricted to this fixture, the selected project and task scratch directory. Do not inspect personal directories, fetch the export URL outside the browser or switch accounts."
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

				if strings.HasPrefix(scenario, "missing_") || scenario == "read_failure_recovery" {
					client := runtime.browserHost.client
					transport := client.Transport
					client.Transport = &qualificationReadFaultTransport{RoundTripper: transport, scenario: scenario, injected: &injected, inputs: &blockedInputs}
					defer func() { client.Transport = transport }()
				}

				prompt += " Work only in this disposable fixture, the selected project and task scratch. Do not inspect personal files or other applications."
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
				terminalOutputConfirmed := false
				reader := svc.threadRuntime.(flruntime.ThreadToolResultReader)
				for _, item := range history.Items {
					if item.Activity != nil {
						if item.Activity.ToolName == "terminal.exec" {
							confirmed, found, err := reader.LookupToolResult(ctx, flruntime.LookupToolResultInput{ThreadID: identity.ThreadID(thread.ThreadID), TurnID: item.TurnID, RunID: item.RunID, ToolCallID: item.Activity.ToolID})
							if err != nil || !found {
								t.Fatalf("canonical terminal result unavailable: %v", err)
							}
							terminalOutputConfirmed = terminalOutputConfirmed || confirmed.Status == "success" && strings.Contains(confirmed.Content, "independent-73")
						}
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
							if scenario == "field_integrity" || scenario == "native_entry" {
								fact["observation"] = data["observation"]
							}
							fact["failed_action"] = data["failed_action"]
							for _, key := range []string{"failed_operation_index", "needs_observation", "observation_status", "frame_geometry"} {
								fact[key] = data[key]
							}
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
				report["injected_read_failures"] = injected.Load()
				report["inputs_after_failed_read"] = blockedInputs.Load()
				if strings.HasPrefix(scenario, "missing_") || scenario == "read_failure_recovery" {
					report["scope"] = "real-provider-real-browser-single-read-fault-injection"
				}
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
				case "field_integrity":
					verified := false
					var inspect func(any)
					inspect = func(value any) {
						switch value := value.(type) {
						case map[string]any:
							complete := true
							for _, field := range []string{"name", "description", "value"} {
								text, ok := value[field].(string)
								complete = complete && ok && len([]rune(text)) == 2000 && value[field+"_truncated"] == true
							}
							verified = verified || complete
							for _, child := range value {
								inspect(child)
							}
						case []any:
							for _, child := range value {
								inspect(child)
							}
						}
					}
					for _, fact := range confirmedToolFacts {
						inspect(fact["observation"])
					}
					if !verified {
						t.Error("canonical observation did not retain all three field integrity flags")
					}
					if submissions.Load() != 0 || pointerClicks.Load() != 0 {
						t.Error("read task changed page")
					}
				case "long_text_natural":
					read := false
					for _, fact := range confirmedToolFacts {
						for _, action := range toAnySlice(fact["completed_actions"]) {
							read = read || action == "text"
						}
					}
					if !read || !strings.Contains(strings.ReplaceAll(finalText, ",", ""), "2111") || !strings.Contains(finalText, "ember-1017") || pointerClicks.Load() != 0 {
						t.Error("complete Unicode text not verified")
					}
				case "attribute_overflow", "name_tail_stale", "cursor_tail_stale":
					code, action := "STALE_REFERENCE", "read"
					if scenario == "attribute_overflow" {
						code, action = "TARGET_CAPABILITY_UNAVAILABLE", "attribute"
					}
					if scenario == "cursor_tail_stale" {
						action = "query"
					}
					verified := false
					for _, fact := range confirmedToolFacts {
						if fact["script_error"] == code && fact["failed_action"] == action {
							verified = true
							if scenario == "attribute_overflow" {
								d, _ := fact["diagnostic"].(map[string]any)
								verified = d["expected"] == "attribute_max_2000"
							}
						}
					}
					wantClicks := int32(1)
					if scenario == "attribute_overflow" {
						wantClicks = 0
					}
					if !verified || submissions.Load() != 0 || pointerClicks.Load() != wantClicks || entered.Load() != wantClicks {
						t.Errorf("integrity boundary not established: verified=%v clicks=%d changed=%d saved=%d", verified, pointerClicks.Load(), entered.Load(), submissions.Load())
					}

				case "mixed_batch", "mixed_batch_contract":
					mixed := false
					for _, request := range requests {
						computer, terminal := false, false
						for _, name := range request.ResponseToolNames {
							computer = computer || name == "computer_exec"
							terminal = terminal || name == "terminal_exec"
						}
						mixed = mixed || computer && terminal
					}
					captured, rejected := false, false
					for _, fact := range confirmedToolFacts {
						for _, action := range toAnySlice(fact["completed_actions"]) {
							captured = captured || action == "screenshot" && fact["observation_status"] == "current"
						}
						rejected = rejected || strings.Contains(anyToString(fact["runtime_error_text"]), "BATCH_CONFLICT")
					}
					report["mixed_batch_attempted"], report["screenshot_confirmed"], report["batch_rejected"] = mixed, captured, rejected
					// Guest mistakes remain in the report. They cannot be confused with
					// a rejected batch or erase a later confirmed screenshot.
					report["terminal_output_confirmed"] = terminalOutputConfirmed
					if !mixed || !terminalOutputConfirmed || !captured || rejected || pointerClicks.Load() != 0 {
						t.Errorf("mixed batch not verified: attempted=%v captured=%v rejected=%v", mixed, captured, rejected)
					}
				case "security_vocabulary":
					captured := false
					for _, fact := range confirmedToolFacts {
						for _, action := range toAnySlice(fact["completed_actions"]) {
							captured = captured || action == "screenshot"
						}
					}
					if !strings.Contains(finalText, "violet-73") || !captured || scriptErrors["TAKEOVER_REQUIRED"] != 0 || pointerClicks.Load() != 0 {
						t.Error("ordinary article was not read and captured safely")
					}
				case "read_failure_recovery", "unsupported_text":
					wantCode := "TARGET_OBSERVATION_UNAVAILABLE"
					if scenario == "unsupported_text" {
						wantCode = "TARGET_CAPABILITY_UNAVAILABLE"
					}
					failure, read, captured := false, false, false
					for _, fact := range confirmedToolFacts {
						if fact["script_error"] == wantCode && fact["failed_action"] == "text" && fact["action_executed"] == false {
							failure = true
						}
						if failure {
							for _, action := range toAnySlice(fact["completed_actions"]) {
								read = read || action == "text"
								// A later guest error does not undo a confirmed screenshot.
								captured = captured || action == "screenshot" && fact["observation_status"] == "current"
							}
						}
					}
					report["recovery_read_confirmed"], report["recovery_screenshot_confirmed"] = read, captured
					if !failure || !read || !captured || pointerClicks.Load() != 0 || submissions.Load() != 0 {
						t.Errorf("read failure/recovery: failure=%v read=%v screenshot=%v clicks=%d saves=%d", failure, read, captured, pointerClicks.Load(), submissions.Load())
					}
				case "excess_click", "excess_screenshot", "excess_key", "excess_image":
					method := map[string]string{"excess_click": "locator.click", "excess_screenshot": "ui.screenshot", "excess_key": "ui.key", "excess_image": "image.click"}[scenario]
					verified := false
					for _, fact := range confirmedToolFacts {
						d, _ := fact["diagnostic"].(map[string]any)
						verified = verified || fact["script_error"] == "SCRIPT_ARGUMENT_ERROR" && d["method"] == method
					}
					if !verified || submissions.Load() != 0 || pointerClicks.Load() != 0 {
						t.Errorf("excess argument not rejected: method=%s verified=%v saves=%d clicks=%d", method, verified, submissions.Load(), pointerClicks.Load())
					}
				case "missing_snapshot", "missing_text", "missing_wait":
					verified := false
					for _, fact := range confirmedToolFacts {
						if fact["script_error"] != "TARGET_OBSERVATION_UNAVAILABLE" {
							continue
						}
						actions := toAnySlice(fact["completed_actions"])
						verified = len(actions) == 1 && actions[0] == "click" && fact["failed_operation_index"] == float64(1) && fact["action_executed"] == true
					}
					// Recovery task completion is a separate model outcome. The tool
					// contract is established by dispatch facts and fixture effects.
					report["recovery_status_observed"] = strings.Contains(text, "Saved once")
					report["read_contract_passed"] = injected.Load() == 1 && blockedInputs.Load() == 0 && verified && submissions.Load() == 1
					if report["read_contract_passed"] != true {
						t.Errorf("read failure contract: injected=%d subsequent_inputs=%d verified=%v saves=%d", injected.Load(), blockedInputs.Load(), verified, submissions.Load())
					}
				case "empty_values":
					verified := false
					for _, fact := range confirmedToolFacts {
						for _, line := range toAnySlice(fact["logs"]) {
							for _, value := range toAnySlice(line) {
								values, ok := value.(map[string]any)
								if !ok {
									// log(object) and log(JSON.stringify(object)) carry
									// the same verified data; neither uses final prose.
									encoded, text := value.(string)
									if !text || json.Unmarshal([]byte(encoded), &values) != nil {
										continue
									}
								}
								items, itemsOK := values["empty_items"].([]any)
								attr, hasAttr := values["null_attribute"]
								text, _ := values["empty_text"].(map[string]any)
								verified = verified || itemsOK && len(items) == 0 && values["empty_count"] == float64(0) && hasAttr && attr == nil && text["text"] == "" && text["truncated"] == false
							}
						}
					}
					if !verified || submissions.Load() != 0 || pointerClicks.Load() != 0 {
						t.Errorf("legitimate empty values not verified: %v", scriptErrors)
					}
				case "observation_capture", "frame_refs":
					verified := false
					for _, fact := range confirmedToolFacts {
						if fact["tool"] != "computer.exec" || fact["status"] != "success" {
							continue
						}
						keys, clicks := 0, 0
						for _, action := range toAnySlice(fact["completed_actions"]) {
							if action == "key" {
								keys++
							}
							if action == "click" {
								clicks++
							}
						}
						if scenario == "observation_capture" {
							verified = verified || keys == 4 && fact["frame_geometry"] != nil && fact["observation_status"] == "current" && fact["needs_observation"] == false
						}
						if scenario == "frame_refs" {
							verified = verified || clicks == 2 && fact["observation_status"] == "current" && fact["needs_observation"] == false
						}
					}
					if !verified || len(scriptErrors) != 0 || scenario == "observation_capture" && entered.Load() != 4 || scenario == "frame_refs" && submissions.Load() != 1 {
						t.Errorf("observation tool contract failed: verified=%v keys=%d saves=%d errors=%v", verified, entered.Load(), submissions.Load(), scriptErrors)
					}
				case "option_field":
					verified := false
					for _, fact := range confirmedToolFacts {
						d, _ := fact["diagnostic"].(map[string]any)
						verified = verified || fact["script_error"] == "SCRIPT_ARGUMENT_ERROR" && d["method"] == "locator.snapshot" && d["field"] == "full" && d["expected"] == "documented_fields"
					}
					if !verified || submissions.Load() != 0 {
						t.Error("precise unsupported-option diagnosis missing")
					}
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
					canonical, _ := json.Marshal(confirmedToolFacts)
					report["native_effect_confirmed"] = facts["clicks"] == float64(1) && facts["value"] == "Flash 1017"
					report["native_confirmation_observed"] = strings.Contains(string(canonical), "Confirmed: Flash 1017")
					if !discovered || !selected || !captured || report["native_effect_confirmed"] != true || report["native_confirmation_observed"] != true {
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
					conditionVerified := false
					for _, fact := range confirmedToolFacts {
						d, _ := fact["diagnostic"].(map[string]any)
						conditionVerified = conditionVerified || fact["failed_action"] == "wait" && fact["failed_operation_index"] == float64(1) && d["method"] == "locator.requireState" && d["state"] == "visible" && d["timeout_ms"] == float64(0)
					}
					if !conditionVerified {
						t.Error("required wait lost its closed condition facts")
					}
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
