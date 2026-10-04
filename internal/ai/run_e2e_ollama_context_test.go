package ai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

// This opt-in lane exercises the production Flower service and published Floret
// with the currently selected local Ollama model. It never writes source state.
// The automatic scenario lowers the isolated effective context percentage;
// automatic_configured_window also qualifies the user's complete budget.
func TestE2E_FlowerOllamaContextCompaction(t *testing.T) {
	if os.Getenv("REDEVEN_FLOWER_OLLAMA_CONTEXT_E2E") != "1" {
		t.Skip("run scripts/check_flower_context_ollama.sh to use the selected real Ollama model")
	}
	sourceRoot := os.Getenv("REDEVEN_FLOWER_CONTEXT_SOURCE_STATE_ROOT")
	if sourceRoot == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			t.Fatal(err)
		}
		sourceRoot = filepath.Join(home, ".redeven", "local-environment")
	}
	raw, err := os.ReadFile(filepath.Join(sourceRoot, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	var source struct {
		AI config.AIConfig `json:"ai"`
	}
	if err := json.Unmarshal(raw, &source); err != nil {
		t.Fatal(err)
	}
	providerID, modelName, found := strings.Cut(source.AI.CurrentModelID, "/")
	if !found {
		t.Fatal("local configuration has no selected provider/model")
	}
	var selected config.AIProvider
	for _, p := range source.AI.Providers {
		if p.ID == providerID {
			selected = p
		}
	}
	if selected.Type != "ollama" {
		t.Fatal("the selected model must belong to an Ollama provider")
	}
	apiKey := ""
	if raw, err := os.ReadFile(filepath.Join(sourceRoot, "secrets.json")); err == nil {
		var secrets struct {
			AI struct {
				Keys map[string]string `json:"provider_api_keys"`
			} `json:"ai"`
			Keys map[string]string `json:"provider_api_keys"`
		}
		if err := json.Unmarshal(raw, &secrets); err != nil {
			t.Fatal("invalid local secrets JSON")
		}
		apiKey = secrets.AI.Keys[providerID]
		if apiKey == "" {
			apiKey = secrets.Keys[providerID]
		}
	} else if !os.IsNotExist(err) {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 25*time.Minute)
	defer cancel()
	models, err := discoverModelCatalog(ctx, ModelCatalogRequest{Type: selected.Type, BaseURL: selected.BaseURL, APIKey: apiKey}, &http.Client{Timeout: 20 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	selected = selected.WithDiscoveredModels(models)
	var model config.AIProviderModel
	for _, m := range selected.EffectiveModels() {
		if m.ModelName == modelName {
			model = m
		}
	}
	if model.ModelName == "" || model.EffectiveInputWindowTokens() < 96_000 {
		t.Fatal("selected model requires a discovered effective context of at least 96000 tokens to qualify manual compaction before automatic pressure")
	}
	t.Logf("selected wire model=%s served_window=%d effective_window=%d", model.EffectiveWireModelName(), model.ContextWindow, model.EffectiveInputWindowTokens())

	for _, scenario := range []string{"small_history", "manual", "automatic", "automatic_configured_window"} {
		t.Run(scenario, func(t *testing.T) {
			automatic := strings.HasPrefix(scenario, "automatic")
			marker := "FLOWER_OLLAMA_" + strings.ToUpper(scenario) + "_7K4P"
			recorder := &ollamaContextRecorder{marker: marker, model: model.EffectiveWireModelName()}
			proxy := newOllamaContextProxy(t, selected.BaseURL, recorder)
			profile := selected
			profile.BaseURL = proxy.URL + "/v1"
			if scenario == "automatic" {
				selection := config.AIModelSelection{}
				if selected.ModelSelection != nil {
					selection = *selected.ModelSelection
				}
				percent := (32_768*100 + model.ContextWindow - 1) / model.ContextWindow
				override := model
				override.EffectiveContextWindowPercent = percent
				selection.ModelOverrides = []config.AIProviderModel{override}
				profile.Models = nil
				profile.ModelSelection = &selection
			}
			var effective config.AIProviderModel
			for _, m := range profile.EffectiveModels() {
				if m.ModelName == modelName {
					effective = m
				}
			}
			cfg := &config.AIConfig{CurrentModelID: source.AI.CurrentModelID, PermissionType: config.AIPermissionReadonly, Providers: []config.AIProvider{profile}}
			stateRoot, homeRoot := t.TempDir(), t.TempDir()
			opts := Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateRoot, AgentHomeDir: homeRoot, Shell: "bash", Config: cfg,
				RunMaxWallTime: 8 * time.Minute, RunIdleTimeout: 3 * time.Minute,
				ResolveProviderAPIKey: func(id string) (string, bool, error) { return apiKey, id == providerID && apiKey != "", nil },
			}
			svc, err := NewService(opts)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = svc.Close() })
			meta := session.Meta{EndpointID: "env_ollama_context_e2e", NamespacePublicID: "ns_ollama_context_e2e", ChannelID: "ch_ollama_context_e2e", UserPublicID: "user_ollama_context_e2e", UserEmail: "ollama-context-e2e@example.invalid", CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true}
			created, err := svc.CreateThread(ctx, &meta, "Ollama context "+scenario, source.AI.CurrentModelID, "", "")
			if err != nil {
				t.Fatal(err)
			}
			live := recordOllamaContextLive(t, ctx, svc, &meta, created.ThreadID)
			report := map[string]any{"schema_version": 1, "model": model.EffectiveWireModelName(), "served_context_window": model.ContextWindow, "effective_context_window": effective.EffectiveInputWindowTokens(), "scenario": scenario, "runtime_pid": os.Getpid(), "proxy_url": proxy.URL, "state_root": stateRoot}
			defer func() {
				report["pass"] = !t.Failed()
				report["requests"] = recorder.snapshot()
				if root := os.Getenv("REDEVEN_FLOWER_CONTEXT_REPORT_ROOT"); root != "" {
					if err := os.MkdirAll(root, 0o700); err != nil {
						t.Error(err)
						return
					}
					data, err := json.MarshalIndent(report, "", "  ")
					if err == nil {
						err = os.WriteFile(filepath.Join(root, scenario+".json"), append(data, '\n'), 0o600)
					}
					if err != nil {
						t.Error(err)
					}
				}
			}()
			var detail *FlowerThreadDetail
			seedCount, ballastTokens := 4, 12_000
			if scenario != "manual" {
				seedCount, ballastTokens = 1, 2_000
			}
			for index := 0; index < seedCount; index++ {
				facts := ""
				if index == 0 {
					facts = fmt.Sprintf("Our ongoing project must retain the exact durable marker %s and rollout port 7319. ", marker)
				}
				prompt := facts + ollamaContextBallast(ballastTokens) + "\nThe ballast is disposable. Reply exactly ACK and do not call tools."
				detail = sendOllamaContextTurn(t, ctx, svc, &meta, created.ThreadID, fmt.Sprintf("%s-seed-%d", scenario, index), prompt)
				assertOllamaContextUsage(t, detail, recorder, effective.EffectiveInputWindowTokens())
				if len(detail.Thread.ContextCompactions) != 0 {
					t.Fatal("seed unexpectedly compacted")
				}
			}
			report["before"] = detail.Thread.ContextUsage
			before := recorder.lastMain(t)
			if !automatic {
				detail = sendOllamaContextTurn(t, ctx, svc, &meta, created.ThreadID, "manual-compact", "/compact")
			} else {
				pressureTokens, maxTurns := 6_000, 8
				if scenario == "automatic_configured_window" {
					pressureTokens, maxTurns = 12_000, 20
				}
				for index := 0; index < maxTurns && len(detail.Thread.ContextCompactions) == 0; index++ {
					report["pre_compaction_usage"] = detail.Thread.ContextUsage
					detail = sendOllamaContextTurn(t, ctx, svc, &meta, created.ThreadID, fmt.Sprintf("automatic-pressure-%d", index), ollamaContextBallast(pressureTokens)+"\nReply exactly ACK and do not call tools.")
					assertOllamaContextUsage(t, detail, recorder, effective.EffectiveInputWindowTokens())
					t.Logf("pressure turn=%d native_input=%d compactions=%d", index+1, detail.Thread.ContextUsage.Confirmed.InputTokens, len(detail.Thread.ContextCompactions))
				}
			}
			if len(detail.Thread.ContextCompactions) != 1 {
				t.Fatalf("compactions=%d, want exactly one", len(detail.Thread.ContextCompactions))
			}
			compact := detail.Thread.ContextCompactions[0]
			if scenario == "small_history" {
				if compact.Phase != "noop" || compact.Status != "noop" || compact.Reason != "context_too_small" || compact.Source != flowerManualCompactionSourceName {
					t.Fatalf("small history should report no work: %+v", compact)
				}
				for _, request := range recorder.snapshot() {
					if request.Kind == "summary" {
						t.Fatal("small history called the summary provider")
					}
				}
				report["compaction"] = compact
				detail = sendOllamaContextTurn(t, ctx, svc, &meta, created.ThreadID, "small-history-recall", "Repeat the exact durable marker and rollout port for the ongoing project. Reply with both exact values only. Do not call tools.")
				assertOllamaContextRecall(t, detail, marker)
				assertOllamaContextUsage(t, detail, recorder, effective.EffectiveInputWindowTokens())
				live.assertMatches(t, detail)
				report["live_context_verified"] = true
				report["after"] = detail.Thread.ContextUsage
				return
			}
			if compact.Phase != "complete" || compact.Status != "compacted" || compact.OperationID == "" || compact.RequestID == "" {
				t.Fatalf("compaction did not complete: %+v", compact)
			}
			trigger, reason, source := "manual", "manual", flowerManualCompactionSourceName
			if automatic {
				trigger, reason, source = "pre_request", "threshold", "engine"
			}
			if compact.Trigger != trigger || compact.Reason != reason || compact.Source != source {
				t.Fatalf("wrong compaction origin: %+v", compact)
			}
			if compact.TokensAfterEstimate <= 0 || compact.TokensAfterEstimate >= compact.TokensBefore {
				t.Fatalf("compaction did not save tokens: %+v", compact)
			}
			if len(detail.Thread.TimelineDecorations) != 1 {
				t.Fatalf("decorations=%d, want one", len(detail.Thread.TimelineDecorations))
			}
			report["compaction"] = compact
			t.Logf("compaction source=%s estimated_tokens=%d -> %d", compact.Source, compact.TokensBefore, compact.TokensAfterEstimate)
			detail = sendOllamaContextTurn(t, ctx, svc, &meta, created.ThreadID, scenario+"-recall", "What exact durable marker and rollout port did we agree for the ongoing project? Reply with both exact values only. Do not call tools.")
			assertOllamaContextRecall(t, detail, marker)
			assertOllamaContextUsage(t, detail, recorder, effective.EffectiveInputWindowTokens())
			after := recorder.lastMain(t)
			if after.SystemHash != before.SystemHash || after.ToolsHash != before.ToolsHash {
				t.Fatal("compaction changed the execution surface")
			}
			if after.HasOriginalMarkerMessage || !after.HasMarker {
				t.Fatal("oldest marker must survive through the checkpoint after its original message is compacted")
			}
			hasSummary := false
			for _, request := range recorder.snapshot() {
				hasSummary = hasSummary || request.Kind == "summary" && request.Status == http.StatusOK && request.OutputTokens > 0
			}
			if !hasSummary {
				t.Fatal("no real provider summary request was recorded")
			}
			if len(detail.Thread.ContextCompactions) != 1 {
				t.Fatal("recall duplicated compaction")
			}
			report["after"] = detail.Thread.ContextUsage
			live.assertMatches(t, detail)
			report["live_context_verified"] = true
			usage, compactions := detail.Thread.ContextUsage, detail.Thread.ContextCompactions
			if err := svc.Close(); err != nil {
				t.Fatal(err)
			}
			svc, err = NewService(opts)
			if err != nil {
				t.Fatal(err)
			}
			restored, err := svc.GetFlowerThreadDetail(ctx, &meta, created.ThreadID)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(usage, restored.Thread.ContextUsage) || !reflect.DeepEqual(compactions, restored.Thread.ContextCompactions) {
				t.Fatal("restart changed canonical usage or compactions")
			}
			detail = sendOllamaContextTurn(t, ctx, svc, &meta, created.ThreadID, scenario+"-restart-recall", "Repeat the exact durable marker and rollout port for the ongoing project. Reply with both exact values only. Do not call tools.")
			assertOllamaContextRecall(t, detail, marker)
			assertOllamaContextUsage(t, detail, recorder, effective.EffectiveInputWindowTokens())
			if len(detail.Thread.ContextCompactions) != 1 {
				t.Fatal("restart recall duplicated compaction")
			}
			report["restart_recovery"] = true
			report["final"] = detail.Thread.ContextUsage
		})
	}
}

func ollamaContextBallast(tokens int) string {
	const line = "Disposable context ballast alpha beta gamma delta. "
	return strings.Repeat(line, (tokens*4+len(line)-1)/len(line))
}

func sendOllamaContextTurn(t *testing.T, ctx context.Context, svc *Service, meta *session.Meta, threadID, requestID, text string) *FlowerThreadDetail {
	t.Helper()
	response, err := svc.SendUserTurn(ctx, meta, SendUserTurnRequest{ClientRequestID: requestID, ThreadID: threadID, Input: RunInput{Text: text}, Options: RunOptions{NoUserInteraction: true}})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.NewTimer(7 * time.Minute)
	defer deadline.Stop()
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		detail, err := svc.GetFlowerThreadDetail(ctx, meta, threadID)
		if err != nil {
			t.Fatal(err)
		}
		if detail.Current.TurnID == response.Current.TurnID && detail.Current.Activity == flruntime.ThreadActivityIdle && detail.Current.LastOutcome != nil {
			if *detail.Current.LastOutcome != flruntime.TurnOutcomeCompleted {
				t.Fatalf("turn %s failed: code=%s failure=%+v", requestID, detail.Thread.RunErrorCode, detail.Current.Failure)
			}
			return detail
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-deadline.C:
			t.Fatalf("turn %s timed out", requestID)
		case <-ticker.C:
		}
	}
}

func assertOllamaContextRecall(t *testing.T, detail *FlowerThreadDetail, marker string) {
	t.Helper()
	var text strings.Builder
	for _, item := range detail.Current.Items {
		if item.Kind == flruntime.ThreadItemAssistant && item.TurnID == detail.Current.TurnID {
			text.WriteString(item.Text)
		}
	}
	if !strings.Contains(text.String(), marker) || !strings.Contains(text.String(), "7319") {
		t.Fatalf("compacted facts were not recalled: %q", text.String())
	}
}

func assertOllamaContextUsage(t *testing.T, detail *FlowerThreadDetail, recorder *ollamaContextRecorder, window int) {
	t.Helper()
	if detail.Thread.ContextUsage == nil || detail.Thread.ContextUsage.Confirmed == nil || detail.Thread.ContextUsage.ThreadUsage == nil {
		t.Fatal("missing canonical context usage")
	}
	usage := detail.Thread.ContextUsage.Confirmed
	last := recorder.lastMain(t)
	if usage.InputTokens != last.InputTokens || usage.InputTokens <= 0 || usage.Source != "provider_usage" {
		t.Fatalf("confirmed usage=%+v does not match raw provider input=%d", usage, last.InputTokens)
	}
	if usage.ContextWindowTokens != int64(window) || usage.OutputHeadroomTokens <= 0 || usage.RequestSafeLimitTokens != int64(window)-usage.OutputHeadroomTokens {
		t.Fatalf("invalid served context budget: %+v", usage)
	}
	if usage.InputTokens >= usage.RequestSafeLimitTokens || last.MaxOutputTokens != usage.OutputHeadroomTokens {
		t.Fatalf("real request exceeded its input/output budget: usage=%+v request=%+v", usage, last)
	}
	if math.Abs(usage.UsedRatio-float64(usage.InputTokens)/float64(window)) > 1e-9 {
		t.Fatalf("invalid context ring ratio: %+v", usage)
	}
	wantThreshold := min(int64(window)*90/100, usage.RequestSafeLimitTokens)
	if usage.ThresholdTokens != wantThreshold || math.Abs(usage.ThresholdRatio-float64(wantThreshold)/float64(window)) > 1e-9 {
		t.Fatalf("invalid automatic compaction threshold: %+v", usage)
	}
	var total FlowerThreadTokenUsage
	for _, request := range recorder.snapshot() {
		if request.Model != recorder.model {
			t.Fatalf("request model=%q, want selected model %q", request.Model, recorder.model)
		}
		if request.Kind != "main" {
			continue
		}
		if request.Status != http.StatusOK || request.InputTokens <= 0 || request.FinishReason != "stop" {
			t.Fatalf("non-terminal real request: %+v", request)
		}
		total.InputTokens += request.InputTokens - request.CacheReadTokens
		total.CacheReadTokens += request.CacheReadTokens
		total.OutputTokens += request.OutputTokens
	}
	if *detail.Thread.ContextUsage.ThreadUsage != total {
		t.Fatalf("thread usage=%+v, raw main request sum=%+v", *detail.Thread.ContextUsage.ThreadUsage, total)
	}
}

type ollamaContextRequest struct {
	Kind                     string `json:"kind"`
	Model                    string `json:"model"`
	SystemHash               string `json:"system_hash"`
	ToolsHash                string `json:"tools_hash"`
	HasMarker                bool   `json:"has_marker"`
	HasOriginalMarkerMessage bool   `json:"has_original_marker_message"`
	Status                   int    `json:"status"`
	InputTokens              int64  `json:"input_tokens"`
	CacheReadTokens          int64  `json:"cache_read_tokens"`
	OutputTokens             int64  `json:"output_tokens"`
	MaxOutputTokens          int64  `json:"max_output_tokens"`
	FinishReason             string `json:"finish_reason"`
}

type ollamaContextRecorder struct {
	mu                 sync.Mutex
	marker             string
	model              string
	originalMarkerHash string
	requests           []ollamaContextRequest
}

// Consume the same workspace stream as Flower while inference is running.
// Retain only context observations, never transcripts or provider bodies.
type ollamaContextLive struct {
	mu          sync.Mutex
	usages      []FlowerContextUsage
	compactions []FlowerContextCompaction
	sawEstimate bool
}

func recordOllamaContextLive(t *testing.T, ctx context.Context, svc *Service, meta *session.Meta, threadID string) *ollamaContextLive {
	t.Helper()
	ctx, cancel := context.WithCancel(ctx)
	subscription, err := svc.SubscribeFlowerLiveStream(ctx, meta, FlowerLiveStreamRequest{})
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	live := &ollamaContextLive{}
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			frame, err := subscription.Next(ctx)
			if err != nil {
				if ctx.Err() == nil && err != io.EOF {
					t.Errorf("context stream: %v", err)
				}
				return
			}
			var envelope FlowerLiveStreamEnvelope
			if err := json.Unmarshal(frame.Data, &envelope); err != nil {
				t.Errorf("context stream JSON: %v", err)
				return
			}
			if envelope.ThreadID != threadID {
				continue
			}
			live.mu.Lock()
			if envelope.ContextUsage != nil {
				live.usages = append(live.usages, *envelope.ContextUsage)
				live.sawEstimate = live.sawEstimate || envelope.ContextUsage.Estimate != nil
			}
			live.compactions = append(live.compactions, envelope.ContextCompactions...)
			live.mu.Unlock()
		}
	}()
	t.Cleanup(func() { cancel(); subscription.Close(); <-done })
	return live
}

func (live *ollamaContextLive) assertMatches(t *testing.T, detail *FlowerThreadDetail) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		live.mu.Lock()
		usageMatches, compactionMatches := false, false
		for _, usage := range live.usages {
			usageMatches = usageMatches || reflect.DeepEqual(usage.Confirmed, detail.Thread.ContextUsage.Confirmed) && reflect.DeepEqual(usage.ThreadUsage, detail.Thread.ContextUsage.ThreadUsage)
		}
		for _, compact := range live.compactions {
			compactionMatches = compactionMatches || reflect.DeepEqual(compact, detail.Thread.ContextCompactions[0])
		}
		complete := live.sawEstimate && usageMatches && compactionMatches
		live.mu.Unlock()
		if complete {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("live context missed estimate, canonical usage, or terminal compaction: usage=%t compaction=%t", usageMatches, compactionMatches)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func (r *ollamaContextRecorder) snapshot() []ollamaContextRequest {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]ollamaContextRequest(nil), r.requests...)
}

func (r *ollamaContextRecorder) lastMain(t *testing.T) ollamaContextRequest {
	t.Helper()
	requests := r.snapshot()
	for i := len(requests) - 1; i >= 0; i-- {
		if requests[i].Kind == "main" {
			return requests[i]
		}
	}
	t.Fatal("no real main provider request")
	return ollamaContextRequest{}
}

func newOllamaContextProxy(t *testing.T, baseURL string, recorder *ollamaContextRecorder) *httptest.Server {
	t.Helper()
	base := strings.TrimSuffix(strings.TrimRight(baseURL, "/"), "/v1")
	client := &http.Client{Timeout: 7 * time.Minute}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		body, err := io.ReadAll(io.LimitReader(request.Body, 8<<20))
		if err != nil {
			http.Error(w, "read qualification request", http.StatusBadRequest)
			return
		}
		index := -1
		if request.URL.Path == "/v1/chat/completions" {
			var payload struct {
				Model     string            `json:"model"`
				MaxTokens int64             `json:"max_tokens"`
				Messages  []json.RawMessage `json:"messages"`
				Tools     []json.RawMessage `json:"tools"`
			}
			if err := json.Unmarshal(body, &payload); err != nil {
				http.Error(w, "invalid request JSON", http.StatusBadRequest)
				return
			}
			record := ollamaContextRequest{Kind: "auxiliary", Model: payload.Model, MaxOutputTokens: payload.MaxTokens, HasMarker: bytes.Contains(body, []byte(recorder.marker))}
			if len(payload.Tools) > 0 {
				record.Kind = "main"
			}
			if bytes.Contains(body, []byte("You are a context compaction writer.")) {
				record.Kind = "summary"
			}
			tools, _ := json.Marshal(payload.Tools)
			record.ToolsHash = sha256Hex(tools)
			recorder.mu.Lock()
			for _, message := range payload.Messages {
				var header struct {
					Role string `json:"role"`
				}
				_ = json.Unmarshal(message, &header)
				if header.Role == "system" && record.SystemHash == "" {
					record.SystemHash = sha256Hex(message)
				}
				if header.Role == "user" && bytes.Contains(message, []byte(recorder.marker)) && recorder.originalMarkerHash == "" && record.Kind == "main" {
					recorder.originalMarkerHash = sha256Hex(message)
				}
				if recorder.originalMarkerHash != "" && sha256Hex(message) == recorder.originalMarkerHash {
					record.HasOriginalMarkerMessage = true
				}
			}
			index = len(recorder.requests)
			recorder.requests = append(recorder.requests, record)
			recorder.mu.Unlock()
		}
		upstream, err := http.NewRequestWithContext(request.Context(), request.Method, base+request.URL.RequestURI(), bytes.NewReader(body))
		if err != nil {
			http.Error(w, "create upstream request", http.StatusBadGateway)
			return
		}
		upstream.Header = request.Header.Clone()
		response, err := client.Do(upstream)
		if err != nil {
			http.Error(w, "upstream request failed", http.StatusBadGateway)
			return
		}
		defer response.Body.Close()
		for key, values := range response.Header {
			for _, value := range values {
				w.Header().Add(key, value)
			}
		}
		if index >= 0 {
			recorder.mu.Lock()
			recorder.requests[index].Status = response.StatusCode
			recorder.mu.Unlock()
		}
		w.WriteHeader(response.StatusCode)
		if index < 0 || !strings.Contains(response.Header.Get("Content-Type"), "text/event-stream") {
			_, _ = io.Copy(w, response.Body)
			return
		}
		scanner := bufio.NewScanner(response.Body)
		scanner.Buffer(make([]byte, 4096), 1<<20)
		for scanner.Scan() {
			line := scanner.Bytes()
			if bytes.HasPrefix(line, []byte("data: ")) && !bytes.Equal(line, []byte("data: [DONE]")) {
				var chunk struct {
					Usage *struct {
						Input   int64 `json:"prompt_tokens"`
						Output  int64 `json:"completion_tokens"`
						Details struct {
							Cached int64 `json:"cached_tokens"`
						} `json:"prompt_tokens_details"`
					} `json:"usage"`
					Choices []struct {
						Finish string `json:"finish_reason"`
					} `json:"choices"`
				}
				if json.Unmarshal(bytes.TrimPrefix(line, []byte("data: ")), &chunk) == nil {
					recorder.mu.Lock()
					if chunk.Usage != nil {
						recorder.requests[index].InputTokens, recorder.requests[index].OutputTokens, recorder.requests[index].CacheReadTokens = chunk.Usage.Input, chunk.Usage.Output, chunk.Usage.Details.Cached
					}
					for _, choice := range chunk.Choices {
						if choice.Finish != "" {
							recorder.requests[index].FinishReason = choice.Finish
						}
					}
					recorder.mu.Unlock()
				}
			}
			if _, err := w.Write(append(append([]byte(nil), line...), '\n')); err != nil {
				return
			}
			w.(http.Flusher).Flush()
		}
	}))
	t.Cleanup(server.Close)
	return server
}
