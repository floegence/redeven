package ai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"slices"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/plugincreation"
	"github.com/floegence/redeven/internal/tessiven"
)

// Measure the final HTTP tools array of a fresh root Service turn, including
// Floret controls, attachments and goal. Registry inventory is not the default
// surface. Search and MCP are unconfigured; plugin authoring is tested explicitly.
// Budgets include about 3-4% growth room and fail visibly without truncating
// runtime descriptions. They are UTF-8 JSON bytes, not tokens or quality claims.
func TestFlowerToolDefinitionBudget(t *testing.T) {
	for _, fixture := range []struct {
		name, permission              string
		computer, authoring, canvas   bool
		nonstrictBudget, strictBudget int
	}{
		{"full", config.AIPermissionFullAccess, true, false, false, 27000, 31400},
		{"readonly", config.AIPermissionReadonly, true, false, false, 16900, 21000},
		{"computer_disabled", config.AIPermissionFullAccess, false, false, false, 23500, 27700},
		{"plugin_creation", config.AIPermissionFullAccess, true, true, false, 29800, 34200},
		{"tessiven", config.AIPermissionFullAccess, true, false, true, 37900, 43900},
		{"tessiven_readonly", config.AIPermissionReadonly, true, false, true, 23200, 28700},
	} {
		for _, provider := range []string{"deepseek", "openai"} {
			t.Run(fixture.name+"/"+provider, func(t *testing.T) {
				strict := provider == "openai"
				model := "deepseek-flash"
				if strict {
					model = "gpt-5-mini"
				}
				var requests atomic.Int32
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					var body map[string]json.RawMessage
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Error(err)
						return
					}
					var tools []map[string]any
					if err := json.Unmarshal(body["tools"], &tools); err == nil && len(tools) > 0 {
						requests.Add(1)
						hasCanvasTools := bytes.Contains(body["tools"], []byte("tessiven"))
						hasCanvasSkill := bytes.Contains(body["input"], []byte("redeven-tessiven")) || bytes.Contains(body["messages"], []byte("redeven-tessiven"))
						if hasCanvasTools != fixture.canvas || hasCanvasSkill != fixture.canvas {
							t.Errorf("Tessiven context: tools=%v skill=%v want=%v", hasCanvasTools, hasCanvasSkill, fixture.canvas)
						}
						hasAuthorSkill := bytes.Contains(body["input"], []byte(pluginAuthoringSkillName)) || bytes.Contains(body["messages"], []byte(pluginAuthoringSkillName))
						if hasAuthorSkill != fixture.authoring {
							t.Errorf("provider authoring guidance=%v want=%v", hasAuthorSkill, fixture.authoring)
						}
						guidance := []byte("This is a dedicated plugin creation conversation.")
						guidanceCount := bytes.Count(body["input"], guidance) + bytes.Count(body["messages"], guidance)
						wantGuidance := 0
						if fixture.authoring {
							wantGuidance = 1
						}
						if guidanceCount != wantGuidance {
							t.Errorf("provider workspace guidance=%d want=%d", guidanceCount, wantGuidance)
						}
						if bytes.Contains(body["tools"], []byte("plugin_author")) != fixture.authoring {
							t.Error("provider authoring tools do not match project scope")
						}
						var compact bytes.Buffer
						if err := json.Compact(&compact, body["tools"]); err != nil {
							t.Error(err)
							return
						}
						names, sizes, computerNames := []string{}, []string{}, []string{}
						for _, tool := range tools {
							name, _ := tool["name"].(string)
							names = append(names, name)
							data, _ := json.Marshal(tool)
							if name == "user_ask" {
								askBudget := 1650
								if strict {
									askBudget = 1950
								}
								t.Logf("user_ask compact_json_bytes=%d budget=%d", len(data), askBudget)
								if len(data) > askBudget {
									t.Errorf("user_ask definition budget exceeded: %d > %d", len(data), askBudget)
								}
								assertCanonicalAskUserWireGuidance(t, tool["parameters"])
							}
							sizes = append(sizes, fmt.Sprintf("%s=%d", name, len(data)))
							if strings.HasPrefix(name, "computer_") || strings.HasPrefix(name, "browser_") {
								computerNames = append(computerNames, name)
							}
						}
						slices.Sort(names)
						slices.Sort(sizes)
						slices.Sort(computerNames)
						required := []string{"file_read", "file_read_many", "path_find", "goal_manage", "subagent_manage", "user_ask", "attachment_read", "file_present", "image_read", "okf_get_index", "okf_open", "okf_search", "subagent_read_events", "thread_query", "thread_read", "web_fetch"}
						if fixture.permission == config.AIPermissionFullAccess {
							required = append(required, "skill_use", "attachment_materialize", "terminal_exec", "terminal_read", "terminal_write", "terminal_terminate", "file_write", "file_apply_patch")
						}
						if fixture.canvas {
							required = append(required, "tessiven_inspect_resource", "tessiven_list_canvases", "tessiven_read_canvas", "tessiven_inspect_runtime", "tessiven_list_runtimes", "tessiven_read_schema", "tessiven_search_canvas", "tessiven_validate_canvas", "tessiven_list_versions")
							if fixture.permission == config.AIPermissionFullAccess {
								required = append(required, "tessiven_manage_instance", "tessiven_edit_canvas", "tessiven_manage_runtime", "tessiven_save_canvas")
							}
						}
						if fixture.permission == config.AIPermissionReadonly {
							required = append(required, "file_search")
						}
						if slices.Contains(names, "web_search_pages") {
							t.Error("unconfigured search advertised")
						}
						wantComputer := []string{}
						if fixture.computer && fixture.permission == config.AIPermissionFullAccess {
							wantComputer = []string{"computer_exec", "computer_list_targets", "computer_select_target"}
						}
						if fixture.authoring {
							required = append(required, "plugin_author_get_status", "plugin_author_initialize", "plugin_author_rename", "plugin_author_build", "plugin_author_capture")
						}
						expected := append(slices.Clone(required), wantComputer...)
						slices.Sort(expected)
						if !slices.Equal(names, expected) {
							t.Errorf("tool inventory changed: got=%v want=%v", names, expected)
						}
						if !slices.Equal(computerNames, wantComputer) {
							t.Errorf("computer tools=%v want=%v", computerNames, wantComputer)
						}
						if fixture.permission == config.AIPermissionReadonly {
							for _, name := range []string{"file_write", "file_apply_patch", "terminal_exec"} {
								if slices.Contains(names, name) {
									t.Errorf("readonly surface gained %s", name)
								}
							}
						}
						budget := fixture.nonstrictBudget
						if strict {
							budget = fixture.strictBudget
						}
						t.Logf("tools=%d compact_json_bytes=%d budget=%d", len(tools), compact.Len(), budget)
						if compact.Len() > budget {
							t.Errorf("tool definition budget exceeded: %s", strings.Join(sizes, ", "))
						}
					}
					w.Header().Set("Content-Type", "text/event-stream")
					if strict {
						writeAskUserIntegrationTextResponse(w, w.(http.Flusher), "done", "Measured.")
					} else {
						writeDeepSeekIntegrationTextResponse(w, w.(http.Flusher), "done", "Measured.")
					}
				}))
				defer server.Close()
				opts := encodingIntegrationOptions(t, server.URL, nil)
				library, err := tessiven.Open(filepath.Join(t.TempDir(), "canvases.sqlite"))
				if err != nil {
					t.Fatal(err)
				}
				defer library.Close()
				opts.Tessiven = library
				opts.Config = &config.AIConfig{CurrentModelID: "openai/" + model, ComputerUseEnabled: &fixture.computer, Providers: []config.AIProvider{{ID: "openai", Type: provider, StrictToolSchema: &strict, BaseURL: server.URL + "/v1", Models: []config.AIProviderModel{{ModelName: model}}, WebSearch: &config.AIProviderWebSearch{Enabled: false, Source: "native"}}}}
				// Ordinary turns must stay scoped even when the environment has a
				// live author service, not only when plugin support is unavailable.
				store, err := plugincreation.Open(filepath.Join(t.TempDir(), "drafts.sqlite"))
				if err != nil {
					t.Fatal(err)
				}
				defer store.Close()
				root, err := filepath.EvalSymlinks(t.TempDir())
				if err != nil {
					t.Fatal(err)
				}
				opts.PluginCreation = plugincreation.New(store)
				opts.PluginCreation.SetBackend(pluginScopeBackend{root})
				var projectID string
				if fixture.authoring {
					project, err := opts.PluginCreation.Create(t.Context(), testSendTurnMeta(), "tool-budget-project")
					if err != nil {
						t.Fatal(err)
					}
					projectID = project.ID
				}
				svc, err := NewService(opts)
				if err != nil {
					t.Fatal(err)
				}
				defer func() { _ = svc.Close() }()
				meta := testSendTurnMeta()
				var threadID string
				request := SendUserTurnRequest{ClientRequestID: "tool-budget", Input: RunInput{Text: "Inspect the available tool descriptions."}}
				if fixture.canvas {
					canvas, err := library.Create(t.Context(), "tool-budget-canvas", "Scope")
					if err != nil {
						t.Fatal(err)
					}
					request.ClientRequestID = ""
					request.Create = &CreateThreadRequest{ClientRequestID: "tool-budget", Title: "Tool budget", ModelID: "openai/" + model, PermissionType: fixture.permission, TessivenCanvasID: canvas.Canvas.ID}
				} else if fixture.authoring {
					request.ClientRequestID = ""
					request.PluginDraftID = projectID
					request.Create = &CreateThreadRequest{ClientRequestID: "tool-budget", Title: "Tool budget", ModelID: "openai/" + model, PermissionType: fixture.permission}
				} else {
					thread, err := svc.CreateThread(t.Context(), meta, "Tool budget", "openai/"+model, fixture.permission, opts.AgentHomeDir)
					if err != nil {
						t.Fatal(err)
					}
					request.ThreadID = thread.ThreadID
				}
				response, err := svc.SendUserTurn(t.Context(), meta, request)
				if err != nil {
					t.Fatal(err)
				}
				threadID = response.ThreadID
				final := waitForAskUserIntegrationThread(t, svc, meta, threadID, func(v *ThreadView) bool { return v.RunStatus == "success" || v.RunStatus == "failed" })
				if final.RunStatus != "success" || requests.Load() != 1 {
					t.Fatalf("runtime acceptance: status=%s requests=%d", final.RunStatus, requests.Load())
				}
				if fixture.authoring {
					_, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{
						ThreadID: threadID, ClientRequestID: "tool-budget-followup",
						Input: RunInput{Text: "Keep refining this plugin."},
					})
					if err != nil {
						t.Fatal(err)
					}
					final = waitForAskUserIntegrationThread(t, svc, meta, threadID, func(v *ThreadView) bool {
						return requests.Load() >= 2 && (v.RunStatus == "success" || v.RunStatus == "failed")
					})
					if final.RunStatus != "success" || requests.Load() != 2 {
						t.Fatalf("followup acceptance: status=%s requests=%d", final.RunStatus, requests.Load())
					}
				}
			})
		}
	}
}
