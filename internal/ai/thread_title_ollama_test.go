package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
	"unicode"
	"unicode/utf8"

	flconfig "github.com/floegence/floret/v7/config"
	"github.com/floegence/floret/v7/identity"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	flstorage "github.com/floegence/floret/v7/storage"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestOllamaAutomaticTitleUsesCapabilityAndSurvivesRestart(t *testing.T) {
	for _, tc := range []struct {
		name, metadata string
		recoverFailed  bool
	}{
		{"disable for title only", `{"values":[false,"low","medium","xhigh"],"default":"medium"}`, false},
		{"always thinking", `{"values":[true],"default":true}`, false},
		{"unknown thinking controls", `null`, false},
		{"retry failed title after restart", `{"values":[false,"low","medium","xhigh"],"default":"medium"}`, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var titleCalls atomic.Int32
			var mainCalls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/api/tags":
					io.WriteString(w, `{"models":[{"name":"local-alias"}]}`)
					return
				case "/api/ps":
					io.WriteString(w, `{"models":[]}`)
					return
				case "/api/show":
					json.NewEncoder(w).Encode(map[string]any{"capabilities": []string{"tools", "thinking"}, "thinking": json.RawMessage(tc.metadata), "parameters": "num_ctx 131072"})
					return
				case "/v1/chat/completions":
				default:
					t.Errorf("unexpected request %s", r.URL)
					w.WriteHeader(404)
					return
				}
				var body struct {
					Messages []struct {
						Content string `json:"content"`
					} `json:"messages"`
					Effort    string `json:"reasoning_effort"`
					MaxTokens int    `json:"max_tokens"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				isTitle := len(body.Messages) > 0 && strings.Contains(body.Messages[0].Content, "You generate concise thread titles")
				text, finish := "Assistant response", "stop"
				if isTitle {
					call := titleCalls.Add(1)
					if strings.Contains(tc.metadata, "false") {
						if body.Effort != "none" {
							t.Errorf("title did not disable supported thinking: %q", body.Effort)
						}
					} else if body.Effort != "" {
						t.Errorf("invented title reasoning control: %q", body.Effort)
					}
					text = "Recent agent research"
					if (body.Effort != "none" && body.MaxTokens < 160) || (tc.recoverFailed && call == 1) {
						text = ""
						finish = "length"
					}
				} else {
					mainCalls.Add(1)
					if strings.Contains(tc.metadata, "false") && body.Effort != "xhigh" {
						t.Errorf("title policy leaked into main request: %q", body.Effort)
					}
				}
				w.Header().Set("Content-Type", "text/event-stream")
				flusher := w.(http.Flusher)
				if isTitle && body.Effort != "none" {
					writeOpenAISSEJSON(w, flusher, map[string]any{"id": "title", "object": "chat.completion.chunk", "choices": []any{map[string]any{"index": 0, "delta": map[string]any{"reasoning": "Planning before the title."}}}})
				}
				writeOpenAISSEJSON(w, flusher, map[string]any{"id": "title", "object": "chat.completion.chunk", "choices": []any{map[string]any{"index": 0, "delta": map[string]any{"content": text}, "finish_reason": finish}}})
			}))
			defer server.Close()
			state := t.TempDir()
			meta := &session.Meta{EndpointID: "title-test", ChannelID: "title-channel", UserPublicID: "user", NamespacePublicID: "namespace", CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true}
			open := func() *Service {
				svc, err := NewService(Options{StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), Config: &config.AIConfig{CurrentModelID: "local/local-alias", Providers: []config.AIProvider{{ID: "local", Type: "ollama", BaseURL: server.URL + "/v1", ModelSelection: &config.AIModelSelection{}}}}, RunMaxWallTime: 5 * time.Second, RunIdleTimeout: 5 * time.Second})
				if err != nil {
					t.Fatal(err)
				}
				return svc
			}
			svc := open()
			defer func() { svc.Close() }()
			created, err := svc.CreateThread(t.Context(), meta, "", "local/local-alias", "", "")
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(tc.metadata, "false") {
				if err := svc.SetThreadReasoningSelection(t.Context(), meta, created.ThreadID, config.AIReasoningSelection{Level: config.AIReasoningLevelXHigh}); err != nil {
					t.Fatal(err)
				}
			}
			turns := 1
			if tc.recoverFailed {
				turns = 2
			}
			for turn := 0; turn < turns; turn++ {
				subscription, err := svc.SubscribeFlowerLiveStream(t.Context(), meta, FlowerLiveStreamRequest{})
				if err != nil {
					t.Fatal(err)
				}
				if ready := nextFlowerLiveStreamFrame(t, subscription); ready.Kind != FlowerLiveStreamReady {
					t.Fatalf("ready=%+v", ready)
				}
				_, err = svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: created.ThreadID, ClientRequestID: "title-test-" + string(rune('0'+turn)), Input: RunInput{Text: "Research recent agent developments."}})
				if err != nil {
					t.Fatal(err)
				}
				want := flruntime.ThreadTitleStatusReady
				if tc.recoverFailed && turn == 0 {
					want = flruntime.ThreadTitleStatusFailed
				}
				settled := nextFlowerTitleSummary(t, subscription, created.ThreadID, want)
				subscription.Close()
				if want == flruntime.ThreadTitleStatusReady && settled.Title != "Recent agent research" {
					t.Fatalf("title=%q", settled.Title)
				}
				if settled.TitleGeneration != int64(turn+2) {
					t.Fatalf("generation=%d", settled.TitleGeneration)
				}
				waitForAskUserIntegrationThread(t, svc, meta, created.ThreadID, func(v *ThreadView) bool {
					if v.RunStatus == "failed" {
						current, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(created.ThreadID))
						t.Fatalf("main failed: %+v err=%v", current.Failure, err)
					}
					return v.RunStatus == "success"
				})
				if err := svc.Close(); err != nil {
					t.Fatal(err)
				}
				svc = open()
				view, err := svc.GetThread(t.Context(), meta, created.ThreadID)
				if err != nil || view.Title != settled.Title || view.TitleStatus != string(want) {
					t.Fatalf("reopened=%+v err=%v", view, err)
				}
				if strings.Contains(tc.metadata, "false") && view.ReasoningSelection.Level != config.AIReasoningLevelXHigh {
					t.Fatalf("thread reasoning changed: %+v", view.ReasoningSelection)
				}
			}
			if int(titleCalls.Load()) != turns || int(mainCalls.Load()) != turns {
				t.Fatalf("titles=%d main=%d", titleCalls.Load(), mainCalls.Load())
			}
		})
	}
}

// Live title qualification uses the real catalog and title transport but inert
// ordinary execution. It cannot call agent tools or mutate a user's conversation.
func TestLiveOllamaAutomaticTitle(t *testing.T) {
	endpoint, model := os.Getenv("REDEVEN_TEST_OLLAMA_URL"), os.Getenv("REDEVEN_TEST_OLLAMA_MODEL")
	if endpoint == "" {
		t.Skip("set REDEVEN_TEST_OLLAMA_URL and REDEVEN_TEST_OLLAMA_MODEL")
	}
	if model == "" {
		t.Fatal("missing live model")
	}
	models, err := discoverModelCatalog(t.Context(), ModelCatalogRequest{Type: "ollama", BaseURL: endpoint}, http.DefaultClient)
	if err != nil {
		t.Fatal(err)
	}
	var cap config.AIReasoningCapability
	for _, m := range models {
		if m.EffectiveWireModelName() == model {
			cap = m.ReasoningCapability
		}
	}
	if cap.IsZero() {
		t.Fatal("live model must advertise reasoning")
	}
	unknown, err := config.OllamaReasoningCapability(nil, true)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name string
		cap  config.AIReasoningCapability
	}{{"declared controls", cap}, {"unknown controls", unknown}} {
		t.Run(tc.name, func(t *testing.T) {
			gateway, err := newProviderAdapter("ollama", strings.TrimRight(endpoint, "/")+"/v1", "", nil)
			if err != nil {
				t.Fatal(err)
			}
			adapter := newFloretProviderAdapter(gateway, "ollama", model, ProviderControls{ReasoningCapability: tc.cap}, TurnBudgets{}, "")
			adapter.identity, err = redevenFloretGatewayIdentity("live-title", "ollama", endpoint, model, "live-title")
			if err != nil {
				t.Fatal(err)
			}
			agent, err := flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "live-title", Name: "Title qualification"}, SystemPrompt: "Title qualification.", Context: flconfig.ContextPolicy{ContextWindowTokens: 131072}}, titleOnlyGateway{Gateway: adapter, t: t}, flruntime.WithAgentThreadTitleMode(flruntime.ThreadTitleModeProvider))
			if err != nil {
				t.Fatal(err)
			}
			host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: flstorage.Memory()})
			if err != nil {
				t.Fatal(err)
			}
			defer host.Shutdown(context.Background())
			service, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) { return agent, nil }))
			if err != nil {
				t.Fatal(err)
			}
			created, err := service.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "create"})
			if err != nil {
				t.Fatal(err)
			}
			// Chinese fixture validates the language of the reported reproduction.
			_, err = service.Send(t.Context(), flruntime.SendInput{ThreadID: created.ThreadID, RequestKey: "send", Input: flruntime.UserInput{Text: "帮我充分调研最近一周AI Agent相关的进展、项目、新闻、博客"}})
			if err != nil {
				t.Fatal(err)
			}
			deadline := time.Now().Add(45 * time.Second)
			for time.Now().Before(deadline) {
				summaries, err := service.List(t.Context(), flruntime.ThreadScope{})
				if err != nil {
					t.Fatal(err)
				}
				if len(summaries) == 1 && summaries[0].TitleGeneration >= 2 {
					summary := summaries[0]
					if summary.TitleStatus == flruntime.ThreadTitleStatusFailed {
						t.Fatal("live title failed")
					}
					if summary.TitleStatus == flruntime.ThreadTitleStatusReady {
						if utf8.RuneCountInString(summary.Title) > 48 || !strings.ContainsFunc(summary.Title, func(r rune) bool { return unicode.Is(unicode.Han, r) }) {
							t.Fatalf("invalid title=%q", summary.Title)
						}
						t.Logf("model=%s title=%q", model, summary.Title)
						return
					}
				}
				time.Sleep(20 * time.Millisecond)
			}
			t.Fatal("live title did not settle")
		})
	}
}

type titleOnlyGateway struct {
	flprovider.Gateway
	t *testing.T
}

func (g titleOnlyGateway) Capabilities() flprovider.Capabilities {
	capability := g.Gateway.Capabilities()
	// This text-only fixture bypasses ordinary execution and never expands attachments.
	capability.AttachmentPayload = flprovider.AttachmentDescriptors
	return capability
}

func (g titleOnlyGateway) Stream(ctx context.Context, request flprovider.Request) (<-chan flprovider.Event, error) {
	if request.LogicalRequestID == "thread_title" {
		g.t.Logf("title max_output_tokens=%d reasoning=%+v", request.MaxOutputTokens, request.Reasoning)
		return g.Gateway.Stream(ctx, request)
	}
	events := make(chan flprovider.Event, 2)
	events <- flprovider.Event{Type: flprovider.EventDelta, Text: "Title qualification only."}
	events <- flprovider.Event{Type: flprovider.EventDone, Reason: "stop"}
	close(events)
	return events, nil
}
