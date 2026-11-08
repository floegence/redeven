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
)

// Measure the final HTTP tools array of a fresh root Service turn, including
// Floret controls, attachments and goal. Registry inventory is not the default
// surface. Search and MCP are unconfigured; plugin authoring is tested explicitly.
// Budgets include about 3-4% growth room and fail visibly without truncating
// runtime descriptions. They are UTF-8 JSON bytes, not tokens or quality claims.
func TestFlowerToolDefinitionBudget(t *testing.T) {
	for _, fixture := range []struct {
		name, permission              string
		computer, authoring           bool
		nonstrictBudget, strictBudget int
	}{
		{"full", config.AIPermissionFullAccess, true, false, 36500, 42000},
		{"readonly", config.AIPermissionReadonly, true, false, 23000, 28500},
		{"computer_disabled", config.AIPermissionFullAccess, false, false, 33000, 38500},
		{"plugin_creation", config.AIPermissionFullAccess, true, true, 41000, 47000},
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
						hasAuthorSkill := bytes.Contains(body["input"], []byte(pluginAuthoringSkillName)) || bytes.Contains(body["messages"], []byte(pluginAuthoringSkillName))
						if hasAuthorSkill != fixture.authoring {
							t.Errorf("provider authoring guidance=%v want=%v", hasAuthorSkill, fixture.authoring)
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
							sizes = append(sizes, fmt.Sprintf("%s=%d", name, len(data)))
							if strings.HasPrefix(name, "computer_") || strings.HasPrefix(name, "browser_") {
								computerNames = append(computerNames, name)
							}
						}
						slices.Sort(names)
						slices.Sort(sizes)
						slices.Sort(computerNames)
						required := []string{"goal", "subagents", "ask_user", "attachment_read", "file_present", "image_read", "okf_index", "okf_open", "okf_search", "subagent_events", "tessiven_inspect", "tessiven_list", "tessiven_read", "tessiven_runtime_inspect", "tessiven_runtimes", "tessiven_schema", "tessiven_search", "tessiven_validate", "tessiven_versions", "threads_query", "threads_read", "web_fetch"}
						if fixture.permission == config.AIPermissionFullAccess {
							required = append(required, "use_skill", "attachment_materialize", "terminal_exec", "terminal_read", "terminal_write", "terminal_terminate", "file_write", "apply_patch", "tessiven_action", "tessiven_edit", "tessiven_runtime_action", "tessiven_save")
						}
						if fixture.permission == config.AIPermissionReadonly {
							required = append(required, "read_file", "read_files", "find", "rgrep")
						}
						if slices.Contains(names, "web_search_tool") {
							t.Error("unconfigured search advertised")
						}
						wantComputer := []string{}
						if fixture.computer && fixture.permission == config.AIPermissionFullAccess {
							wantComputer = []string{"computer_exec", "computer_select_target", "computer_targets"}
						}
						if fixture.authoring {
							required = append(required, "plugin_author_status", "plugin_author_initialize", "plugin_author_rename", "plugin_author_build", "plugin_author_capture")
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
							for _, name := range []string{"file_write", "apply_patch", "terminal_exec", "tessiven_action"} {
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
				if fixture.authoring {
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
			})
		}
	}
}
