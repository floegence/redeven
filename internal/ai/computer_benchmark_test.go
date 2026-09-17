package ai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	"github.com/floegence/redeven/internal/config"
)

type computerBenchmarkMetrics struct {
	mu                   sync.Mutex
	ModelCalls           int   `json:"model_round_trips"`
	ImageBytes           int64 `json:"model_image_bytes"`
	ObservationTextBytes int64 `json:"observation_text_bytes"`
	InputTokens          int64 `json:"provider_input_tokens"`
	ToolMilliseconds     int64 `json:"tool_ms"`
	WaitMilliseconds     int64 `json:"action_wait_ms"`
	ToolCalls            int   `json:"host_operations"`
	ForegroundOperations int   `json:"reported_foreground_operations"`
}

func (m *computerBenchmarkMetrics) observeRequest(body []byte) bool {
	var request map[string]any
	if json.Unmarshal(body, &request) != nil {
		return false
	}
	defs, _ := request["tools"].([]any)
	if len(defs) == 0 {
		return false
	} // Exclude title generation from task execution.
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ModelCalls++
	var walk func(any)
	walk = func(value any) {
		switch item := value.(type) {
		case []any:
			for _, child := range item {
				walk(child)
			}
		case map[string]any:
			if item["type"] == "input_image" {
				encoded, _ := item["image_url"].(string)
				if cut := strings.Index(encoded, ","); cut >= 0 {
					if decoded, err := base64.StdEncoding.DecodeString(encoded[cut+1:]); err == nil {
						m.ImageBytes += int64(len(decoded))
					}
				}
			}
			if item["type"] == "function_call_output" {
				switch output := item["output"].(type) {
				case string:
					m.ObservationTextBytes += int64(len(output))
				case []any:
					for _, part := range output {
						if text, ok := part.(map[string]any); ok && text["type"] == "input_text" {
							value, _ := text["text"].(string)
							m.ObservationTextBytes += int64(len(value))
						}
					}
				}
			}
			for _, child := range item {
				walk(child)
			}
		}
	}
	walk(request["input"])
	return true
}

type computerBenchmarkMeasuredKey struct{}

type computerBenchmarkReader struct {
	io.ReadCloser
	metrics *computerBenchmarkMetrics
	pending []byte
}

func (r *computerBenchmarkReader) Read(p []byte) (int, error) {
	n, err := r.ReadCloser.Read(p)
	r.pending = append(r.pending, p[:n]...)
	for {
		end := bytes.IndexByte(r.pending, '\n')
		if end < 0 {
			break
		}
		line := r.pending[:end]
		r.pending = r.pending[end+1:]
		if !bytes.HasPrefix(line, []byte("data:")) {
			continue
		}
		var event struct {
			Type     string `json:"type"`
			Response struct {
				Usage struct {
					InputTokens int64 `json:"input_tokens"`
				} `json:"usage"`
			} `json:"response"`
		}
		if json.Unmarshal(bytes.TrimSpace(line[5:]), &event) == nil && event.Type == "response.completed" {
			r.metrics.mu.Lock()
			r.metrics.InputTokens += event.Response.Usage.InputTokens
			r.metrics.mu.Unlock()
		}
	}
	if len(r.pending) > 4<<20 {
		r.pending = nil
	} // Never retain unbounded provider output.
	return n, err
}

type computerBenchmarkExecutor struct {
	*PlaywrightTargetExecutor
	metrics *computerBenchmarkMetrics
}

func (e *computerBenchmarkExecutor) ExecuteTargetTool(ctx context.Context, call TargetToolCall) (TargetToolResult, error) {
	start := time.Now()
	result, err := e.PlaywrightTargetExecutor.ExecuteTargetTool(ctx, call)
	elapsed := time.Since(start).Milliseconds()
	var args map[string]any
	_ = json.Unmarshal(call.Arguments, &args)
	waiting := call.ToolName == "computer.wait" || strings.HasPrefix(call.ToolName, "browser.") || args["action"] == "wait"
	e.metrics.mu.Lock()
	defer e.metrics.mu.Unlock()
	e.metrics.ToolCalls++
	e.metrics.ToolMilliseconds += elapsed
	if waiting {
		e.metrics.WaitMilliseconds += elapsed
	}
	if payload, ok := result.Result.(map[string]any); ok && payload["execution_mode"] == "foreground" {
		e.metrics.ForegroundOperations++
	}
	return result, err
}

// This online benchmark uses the production Service, Floret, provider adapter,
// tool registry and target executor. Only the application data is a local fixture.
// It is separate from Desktop UI and platform acceptance, and never runs in CI
// merely because credentials happen to exist in the environment.
func TestComputerPairedModelBenchmark(t *testing.T) {
	if os.Getenv("REDEVEN_COMPUTER_BENCHMARK") != "1" {
		t.Skip("explicit online benchmark required")
	}
	var provider config.AIProvider
	if json.Unmarshal([]byte(os.Getenv("REDEVEN_COMPUTER_BENCHMARK_PROVIDER")), &provider) != nil || provider.Type != "deepseek" {
		t.Fatal("invalid benchmark provider")
	}
	key := os.Getenv("REDEVEN_COMPUTER_BENCHMARK_KEY")
	output := os.Getenv("REDEVEN_COMPUTER_BENCHMARK_OUTPUT")
	if key == "" || !filepath.IsAbs(output) {
		t.Fatal("explicit credentials and output path required")
	}
	model := "deepseek-v4-flash-vision-exp"
	upstream, err := url.Parse(provider.BaseURL)
	if err != nil || upstream.Scheme != "https" {
		t.Fatal("invalid provider endpoint")
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	helper, err := filepath.Abs("../envapp/ui_src/scripts/redevenComputerHost.mjs")
	if err != nil {
		t.Fatal(err)
	}
	type measurement struct {
		Task       string `json:"task"`
		Variant    string `json:"variant"`
		Repetition int    `json:"repetition"`
		Success    bool   `json:"success"`
		Status     string `json:"status"`
		ErrorCode  string `json:"error_code,omitempty"`
		DurationMS int64  `json:"total_ms"`
		*computerBenchmarkMetrics
	}
	records := []measurement{}
	repetitions := 3
	if raw := os.Getenv("REDEVEN_COMPUTER_BENCHMARK_REPETITIONS"); raw != "" {
		repetitions, err = strconv.Atoi(raw)
		if err != nil || repetitions < 1 || repetitions > 5 {
			t.Fatal("benchmark repetitions must be 1..5")
		}
	}
	// Alternate order to reduce cache, load and warmup bias. Every run starts with
	// a fresh profile, thread, namespace, fixture state and identical permissions.
	for repetition := 0; repetition < repetitions; repetition++ {
		for _, task := range []string{"form", "dynamic", "frame"} {
			variants := []string{"visual", "semantic"}
			if repetition%2 == 1 {
				variants[0], variants[1] = variants[1], variants[0]
			}
			for _, variant := range variants {
				func() {
					metrics := &computerBenchmarkMetrics{}
					var completed atomic.Bool
					fixture := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
						w.Header().Set("Content-Type", "text/html")
						if req.URL.Path == "/save" {
							_ = req.ParseForm()
							completed.Store(req.Form.Get("project") == "Orchid" && req.Form.Get("team") == "Design" && req.Form.Get("note") == "Ready")
							_, _ = io.WriteString(w, "<h1>Saved</h1><p>Orchid · Design · Ready</p>")
							return
						}
						form := `<form action="/save" method="post"><label>Project<input name="project"></label><label>Team<input name="team"></label><label>Note<input name="note"></label><button>Save</button></form>`
						_, _ = io.WriteString(w, `<style>body{font:20px system-ui;padding:40px}label{display:block;margin:24px}input{margin-left:20px;font-size:20px}button{font-size:20px}iframe{width:950px;height:600px;border:0}</style>`)
						if task == "frame" && req.URL.Path != "/frame" {
							_, _ = io.WriteString(w, `<iframe src="/frame"></iframe>`)
						} else if task == "dynamic" {
							_, _ = io.WriteString(w, `<button id="open" onclick="setTimeout(()=>{document.getElementById('fields').hidden=false;this.remove()},120)">Open form</button><div id="fields" hidden>`+form+`</div>`)
						} else {
							_, _ = io.WriteString(w, form)
						}
					}))
					defer fixture.Close()
					proxy := &httputil.ReverseProxy{}
					proxy.Rewrite = func(request *httputil.ProxyRequest) {
						req := request.Out
						body, _ := io.ReadAll(io.LimitReader(req.Body, 64<<20))
						_ = req.Body.Close()
						measured := metrics.observeRequest(body)
						req.Body = io.NopCloser(bytes.NewReader(body))
						request.SetURL(upstream)
						req.Header.Set("Authorization", "Bearer "+key)
						req.Host = upstream.Host
						*req = *req.WithContext(context.WithValue(req.Context(), computerBenchmarkMeasuredKey{}, measured))
					}
					proxy.ModifyResponse = func(response *http.Response) error {
						if response.Request.Context().Value(computerBenchmarkMeasuredKey{}) == true {
							response.Body = &computerBenchmarkReader{ReadCloser: response.Body, metrics: metrics}
						}
						return nil
					}
					proxy.ErrorLog = slog.NewLogLogger(slog.NewTextHandler(io.Discard, nil), slog.LevelError)
					providerServer := httptest.NewServer(proxy)
					defer providerServer.Close()
					selected := provider
					selected.BaseURL = providerServer.URL
					registry := NewTargetRegistry()
					target := TargetDescriptor{ID: "benchmark", Kind: "browser.managed", DisplayName: "Benchmark browser", Ready: true, State: "ready", Capabilities: []string{"observe", "interaction"}}
					if err := registry.Register(target); err != nil {
						t.Fatal(err)
					}
					resources := NewPlaywrightTargetExecutor(node, helper, t.TempDir())
					executor := &computerBenchmarkExecutor{PlaywrightTargetExecutor: resources, metrics: metrics}
					runtime := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{"browser-main": resources, "benchmark": executor}, t.TempDir())
					defer runtime.Close()
					state := t.TempDir()
					svc, err := NewService(Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", TargetResolver: runtime, TargetToolExecutor: runtime,
						Config: &config.AIConfig{CurrentModelID: selected.ID + "/" + model, Providers: []config.AIProvider{selected}}, ResolveProviderAPIKey: func(string) (string, bool, error) { return "benchmark", true, nil }, RunMaxWallTime: 3 * time.Minute, RunIdleTimeout: 90 * time.Second})
					if err != nil {
						t.Fatal(err)
					}
					defer svc.Close()
					meta := testSendTurnMeta()
					thread, err := svc.CreateThread(t.Context(), meta, "Computer benchmark", selected.ID+"/"+model, "", "")
					if err != nil {
						t.Fatal(err)
					}
					if err := svc.SelectComputerTarget(t.Context(), meta, thread.ThreadID, target.ID); err != nil {
						t.Fatal(err)
					}
					if err := svc.SetThreadPermissionType(t.Context(), meta, thread.ThreadID, string(FlowerPermissionFullAccess)); err != nil {
						t.Fatal(err)
					}
					if err := svc.SetComputerAccess(t.Context(), meta, thread.ThreadID, ComputerAccess{Origins: []string{fixture.URL}}); err != nil {
						t.Fatal(err)
					}
					allowed := []string{"computer.screenshot", "computer.click", "computer.double_click", "computer.type", "computer.key", "computer.scroll", "computer.drag", "computer.wait", "browser.navigate", "browser.back", "browser.reload"}
					if variant == "semantic" {
						allowed = append(allowed, "computer.observe", "computer.exec")
					}
					prompt := "Use the browser interface at " + fixture.URL + ". Open the form if needed. Set Project to Orchid, Team to Design and Note to Ready. Save once. Verify the saved result with a final screenshot, then report completion. Do not use commands or direct HTTP for this GUI verification task."
					start := time.Now()
					_, err = svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "benchmark", Model: selected.ID + "/" + model, Input: RunInput{Text: prompt}, Options: RunOptions{PermissionType: config.AIPermissionFullAccess, ToolAllowlist: allowed, NoUserInteraction: true, MaxOutputTokens: 4096}})
					if err != nil {
						t.Fatal(err)
					}
					deadline := time.NewTimer(3*time.Minute + 10*time.Second)
					defer deadline.Stop()
					ticker := time.NewTicker(100 * time.Millisecond)
					defer ticker.Stop()
					status := ""
					errorCode := ""
					for status == "" {
						select {
						case <-deadline.C:
							status = "timeout"
						case <-ticker.C:
							view, readErr := svc.GetThread(t.Context(), meta, thread.ThreadID)
							if readErr != nil {
								t.Fatal(readErr)
							}
							if view.RunStatus == "success" || view.RunStatus == "failed" || view.RunStatus == "canceled" || view.RunStatus == "waiting_user" || view.RunStatus == "waiting_approval" || view.RunStatus == "waiting_user_input" {
								status = view.RunStatus
								errorCode = view.RunErrorCode
							}
						}
					}
					duration := time.Since(start).Milliseconds()
					history, err := svc.threadRuntime.History(t.Context(), identity.ThreadID(thread.ThreadID), "", 100)
					if err != nil {
						t.Fatal(err)
					}
					historyBody, err := json.MarshalIndent(history, "", "  ")
					if err != nil {
						t.Fatal(err)
					}
					if err := os.WriteFile(filepath.Join(filepath.Dir(output), fmt.Sprintf("%s-%s-%d-history.json", task, variant, repetition)), historyBody, 0600); err != nil {
						t.Fatal(err)
					}
					if err := svc.Close(); err != nil {
						t.Fatal(err)
					}
					record := measurement{Task: task, Variant: variant, Repetition: repetition, Status: status, ErrorCode: errorCode, Success: status == "success" && completed.Load(), DurationMS: duration, computerBenchmarkMetrics: metrics}
					records = append(records, record)
					metrics.mu.Lock()
					body, marshalErr := json.MarshalIndent(map[string]any{"scope": "production-service-managed-browser", "model": model, "repetitions": repetitions, "measurements": records}, "", "  ")
					metrics.mu.Unlock()
					if marshalErr != nil {
						t.Fatal(marshalErr)
					}
					if err := os.WriteFile(output, append(body, '\n'), 0600); err != nil {
						t.Fatal(err)
					}
					t.Logf("%s/%s/%d status=%s success=%t elapsed_ms=%d", task, variant, repetition, status, record.Success, record.DurationMS)
				}()
			}
		}
	}
}
