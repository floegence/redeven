package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v7/config"
	"github.com/floegence/floret/v7/florettest"
	"github.com/floegence/floret/v7/identity"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/storage"
	fltools "github.com/floegence/floret/v7/tools"
)

// Qualification owns its SQLite store, HTTP listener and scripted provider.
// Historical input is an optional consistent copy, never the original store.
type flowerCompactionUIGateway struct {
	*florettest.ScriptedGateway
	summary <-chan struct{}
}

func (g *flowerCompactionUIGateway) Stream(ctx context.Context, request flprovider.Request) (<-chan flprovider.Event, error) {
	if len(request.Tools) != 0 {
		return g.ScriptedGateway.Stream(ctx, request)
	}
	summary := florettest.NewScriptedGateway(g.Identity(), g.Capabilities(), florettest.Step{BlockUntil: g.summary, Events: []flprovider.Event{{Type: flprovider.EventDelta, Text: "Preserve the canonical qualification evidence and all requested facts."}, {Type: flprovider.EventDone, Reason: "stop"}}})
	return summary.Stream(ctx, request)
}

func TestFlowerCompactionRuntimeUI(t *testing.T) {
	if os.Getenv("REDEVEN_COMPACTION_RUNTIME_UI") != "1" {
		t.Skip("explicit Flower browser qualification only")
	}
	state := t.TempDir()
	summary, answer := make(chan struct{}), make(chan struct{})
	releaseSummary, releaseAnswer := sync.OnceFunc(func() { close(summary) }), sync.OnceFunc(func() { close(answer) })
	t.Cleanup(releaseSummary)
	t.Cleanup(releaseAnswer)
	step := func(text string) florettest.Step {
		return florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventDelta, Text: text}, {Type: flprovider.EventDone, Reason: "stop"}}}
	}
	gateway := &flowerCompactionUIGateway{summary: summary, ScriptedGateway: florettest.NewScriptedGateway(flprovider.Identity{Provider: "test", Model: "compaction-ui", StateCompatibilityKey: "compaction-ui:v1"}, flprovider.Capabilities{Reasoning: flprovider.ReasoningUnsupported},
		step("Seed acknowledged."), step("Seed acknowledged."), step("Seed acknowledged."),
		florettest.Step{ReturnError: flprovider.ErrContextOverflow},
		florettest.Step{BlockUntil: answer, Events: step("Qualification complete.").Events})}
	host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: storage.SQLite(filepath.Join(state, "live.sqlite"))})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = host.Shutdown(context.Background()) })
	evidence := fltools.Define[struct{}](fltools.Definition{Name: "evidence", ReadOnly: true, InputSchema: fltools.StrictObject(map[string]any{}, nil), Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}}, nil, nil, func(context.Context, fltools.Invocation[struct{}]) (fltools.Result, error) {
		return fltools.Result{Text: "Canonical qualification evidence."}, nil
	})
	canonical, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) {
		return flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "qualification", Name: "Qualification"}, SystemPrompt: "Preserve the evidence.", Context: flconfig.ContextPolicy{ContextWindowTokens: 256000, CompactedContextTargetTokens: 2000, RecentTailTokens: 100, RecentUserTokens: 100, ReservedSummaryTokens: 1000}}, gateway, flruntime.WithAgentTools(evidence), flruntime.WithAgentEffectAuthorization(floretAllowTestEffect))
	}))
	if err != nil {
		t.Fatal(err)
	}
	service := newSendTurnTestServiceWithActivation(t, true)
	service.threadRuntime = canonical
	if err := service.Activate(t.Context()); err != nil {
		t.Fatal(err)
	}
	meta := testSendTurnMeta()
	created, err := service.CreateThread(t.Context(), meta, "Compaction runtime qualification", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	id := identity.ThreadID(created.ThreadID)
	for i := range 3 {
		if _, err := canonical.Send(t.Context(), flruntime.SendInput{ThreadID: id, RequestKey: flruntime.RequestKey(fmt.Sprintf("seed-%d", i)), Input: flruntime.UserInput{Text: strings.Repeat("Historical evidence. ", 500)}}); err != nil {
			t.Fatal(err)
		}
		waitForFloretThreadIdle(t, canonical, id)
	}
	var historical flruntime.ThreadService
	historyID := os.Getenv("REDEVEN_COMPACTION_HISTORY_THREAD")
	if source := os.Getenv("REDEVEN_COMPACTION_HISTORY_COPY"); source != "" {
		copyPath := filepath.Join(state, "history.sqlite")
		raw, err := os.ReadFile(source)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(copyPath, raw, 0600); err != nil {
			t.Fatal(err)
		}
		historyHost, err := flruntime.Open(t.Context(), flruntime.Options{Storage: storage.SQLite(copyPath), DeferExecution: true})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = historyHost.Shutdown(context.Background()) })
		historical, err = historyHost.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) {
			return nil, errors.New("historical qualification cannot execute")
		}))
		if err != nil {
			t.Fatal(err)
		}
	}
	detail := func(ctx context.Context, thread string) (*FlowerThreadDetail, error) {
		if thread == historyID && historical != nil {
			current, err := historical.View(ctx, identity.ThreadID(thread))
			if err != nil {
				return nil, err
			}
			return &FlowerThreadDetail{Thread: ThreadView{ThreadID: thread, Title: "Readonly historical compactions", TitleStatus: "ready", TitleGeneration: 1, ModelID: "openai/gpt-5-mini", SettingsRevision: 1, RunStatus: "idle", CreatedAtUnixMs: 1, UpdatedAtUnixMs: 1}, Current: current}, nil
		}
		return service.GetFlowerThreadDetail(ctx, meta, thread)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/fixture", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var value any
		var err error
		thread := r.URL.Query().Get("id")
		if thread == "" {
			thread = id.String()
		}
		switch r.URL.Query().Get("op") {
		case "setup":
			value = map[string]any{"source": id, "history": historyID, "history_turn": os.Getenv("REDEVEN_COMPACTION_HISTORY_TURN")}
		case "list":
			d, e := detail(r.Context(), thread)
			err = e
			if d != nil {
				value = ListThreadsResponse{Threads: []ThreadView{d.Thread}}
			}
		case "detail":
			value, err = detail(r.Context(), thread)
		case "history":
			var input FlowerHistoryRequest
			err = json.NewDecoder(r.Body).Decode(&input)
			if err == nil {
				value, err = service.GetFlowerThreadHistory(r.Context(), meta, thread, input)
			}
		case "history_body":
			var input FlowerHistoryBodyRequest
			err = json.NewDecoder(r.Body).Decode(&input)
			if err == nil {
				value, err = service.GetFlowerHistoryBody(r.Context(), meta, thread, input)
			}
		case "history_item":
			var input map[string]string
			err = json.NewDecoder(r.Body).Decode(&input)
			if err == nil {
				value, err = service.GetFlowerHistoryItem(r.Context(), meta, thread, input["item_id"])
			}
		case "history_release":
			var input FlowerHistoryRelease
			err = json.NewDecoder(r.Body).Decode(&input)
			if err == nil {
				err = service.ReleaseFlowerHistory(r.Context(), meta, thread, input)
				value = true
			}
		case "start":
			value, err = canonical.Send(r.Context(), flruntime.SendInput{ThreadID: id, RequestKey: "live", Input: flruntime.UserInput{Text: "Inspect all evidence and finish."}})
		case "summary":
			releaseSummary()
			value = true
		case "answer":
			releaseAnswer()
			value = true
		default:
			http.NotFound(w, r)
			return
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if err := json.NewEncoder(w).Encode(value); err != nil {
			t.Errorf("encode qualification: %v", err)
		}
	})
	mux.HandleFunc("/live", func(w http.ResponseWriter, r *http.Request) {
		subscription, err := service.SubscribeFlowerLiveStream(r.Context(), meta, FlowerLiveStreamRequest{})
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		defer subscription.Close()
		w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Accel-Buffering", "no")
		for {
			frame, err := subscription.Next(r.Context())
			if err != nil {
				return
			}
			if _, err = io.WriteString(w, "data: "+string(frame.Data)+"\n\n"); err != nil {
				return
			}
			w.(http.Flusher).Flush()
		}
	})
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	dist := t.TempDir()
	mux.Handle("/", http.FileServer(http.Dir(dist)))
	server := httptest.NewServer(mux)
	defer server.Close()
	commit, _ := exec.Command("git", "rev-parse", "HEAD").Output()
	t.Logf("owned compaction runtime commit=%s pid=%d url=%s state=%s", strings.TrimSpace(string(commit)), os.Getpid(), server.URL, state)
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Minute)
	defer cancel()
	command := exec.CommandContext(ctx, "node", filepath.Join(root, "scripts/check_flower_compaction_ui.mjs"), "--url="+server.URL, "--dist="+dist)
	command.Dir = root
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	if err := command.Run(); err != nil {
		t.Fatal(err)
	}
}
