package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime/pprof"
	"sync"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

// TestFlowerThreadOpenQualification serves the actual product history boundary
// from an explicitly isolated database copy. It never activates execution.
func TestFlowerThreadOpenQualification(t *testing.T) {
	state := os.Getenv("REDEVEN_THREAD_OPEN_STATE")
	if state == "" {
		t.Skip("isolated incident qualification only")
	}
	id := os.Getenv("REDEVEN_THREAD_OPEN_ID")
	if id == "" {
		t.Fatal("qualification requires an explicit thread ID")
	}
	marker, err := os.ReadFile(filepath.Join(state, "qualification-owner.json"))
	if err != nil {
		t.Fatal("only task-owned consistent database copies are accepted")
	}
	var ownership struct{ Purpose string }
	if json.Unmarshal(marker, &ownership) != nil || ownership.Purpose != "thread-open-qualification" {
		t.Fatal("invalid qualification ownership")
	}
	started := time.Now()
	var phaseMu sync.Mutex
	type startupPhase struct {
		Phase     FloretStoreStartupPhase `json:"phase"`
		ElapsedMS float64                 `json:"elapsed_ms"`
	}
	phases := []startupPhase{}
	service, err := NewServiceContext(t.Context(), Options{StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", DeferExecution: true, Config: &config.AIConfig{}, Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		StoreStartupProgress: func(phase FloretStoreStartupPhase) {
			phaseMu.Lock()
			defer phaseMu.Unlock()
			if len(phases) == 0 || phases[len(phases)-1].Phase != phase {
				phases = append(phases, startupPhase{phase, float64(time.Since(started)) / float64(time.Millisecond)})
				t.Logf("startup phase=%s elapsed=%s", phase, time.Since(started))
			}
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	startupMS := float64(time.Since(started)) / float64(time.Millisecond)
	readiness, err := service.floretThreadReadiness(t.Context(), identity.ThreadID(id))
	if err != nil || !readiness.DisplayReady || readiness.DisplayError != "" {
		t.Fatalf("target browsing is not ready after upgrade: %+v, %v", readiness, err)
	}
	settings, err := service.threadsDB.GetThreadSettingsByCanonicalThreadID(t.Context(), id)
	if err != nil || settings == nil {
		t.Fatalf("missing target settings: %v", err)
	}
	meta := &session.Meta{ChannelID: "isolated-acceptance", EndpointID: settings.EndpointID, NamespacePublicID: settings.NamespacePublicID, UserPublicID: "isolated-acceptance", CanRead: true}
	if err := service.startFlowerRuntimeViewPump(); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	stop := sync.OnceFunc(func() { close(done) })
	mux := http.NewServeMux()
	encode := func(w http.ResponseWriter, v any) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(v)
	}
	mux.HandleFunc("/fixture", func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		op := r.URL.Query().Get("op")
		defer func() { t.Logf("request %s duration=%s", op, time.Since(start)) }()
		thread := r.URL.Query().Get("id")
		if thread == "" {
			thread = id
		}
		var value any
		var e error
		switch op {
		case "list":
			value, e = service.ListThreads(r.Context(), meta, 200, "")
		case "history", "detail":
			if profilePath := os.Getenv("REDEVEN_THREAD_OPEN_CPU_PROFILE"); profilePath != "" && op == "history" {
				profile, profileErr := os.Create(profilePath)
				if profileErr != nil {
					t.Error(profileErr)
					return
				}
				if profileErr = pprof.StartCPUProfile(profile); profileErr != nil {
					_ = profile.Close()
					t.Error(profileErr)
					return
				}
				defer func() { pprof.StopCPUProfile(); _ = profile.Close() }()
			}
			var input FlowerHistoryRequest
			if r.Method == "POST" {
				e = json.NewDecoder(r.Body).Decode(&input)
			}
			if e == nil {
				value, e = service.GetFlowerThreadHistory(r.Context(), meta, thread, input)
			}
		case "parent_events":
			var input ParentEventReadRequest
			e = json.NewDecoder(r.Body).Decode(&input)
			if e == nil {
				value, e = service.GetFlowerParentEvents(r.Context(), meta, thread, input)
			}
		case "history_item":
			var input map[string]string
			e = json.NewDecoder(r.Body).Decode(&input)
			if e == nil {
				value, e = service.GetFlowerHistoryItem(r.Context(), meta, thread, input["item_id"])
			}
		case "history_body":
			var input FlowerHistoryBodyRequest
			e = json.NewDecoder(r.Body).Decode(&input)
			if e == nil {
				value, e = service.GetFlowerHistoryBody(r.Context(), meta, thread, input)
			}
		case "history_release":
			var input FlowerHistoryRelease
			e = json.NewDecoder(r.Body).Decode(&input)
			if e == nil {
				e = service.ReleaseFlowerHistory(r.Context(), meta, thread, input)
				value = true
			}
		case "subagent_detail":
			value, e = service.GetFlowerSubagentDetail(r.Context(), meta, id, thread)
		case "activity_value":
			var input flruntime.ThreadActivityValueInput
			e = json.NewDecoder(r.Body).Decode(&input)
			if e == nil {
				value, e = service.GetFlowerActivityValue(r.Context(), meta, thread, input)
			}
		case "activity_field":
			var input flruntime.ThreadActivityFieldInput
			e = json.NewDecoder(r.Body).Decode(&input)
			if e == nil {
				value, e = service.GetFlowerActivityField(r.Context(), meta, thread, input)
			}
		case "activity_structure":
			var input flruntime.ThreadActivityStructureInput
			e = json.NewDecoder(r.Body).Decode(&input)
			if e == nil {
				value, e = service.GetFlowerActivityStructure(r.Context(), meta, thread, input)
			}
		case "metrics":
			value = service.FlowerLiveMetrics()
		case "quit":
			value = true
			defer stop()
		default:
			http.NotFound(w, r)
			return
		}
		if e != nil {
			t.Logf("request %s error=%v", op, e)
			http.Error(w, e.Error(), 500)
			return
		}
		encode(w, value)
	})
	mux.HandleFunc("/live", func(w http.ResponseWriter, r *http.Request) {
		sub, e := service.SubscribeFlowerLiveStream(r.Context(), meta, FlowerLiveStreamRequest{})
		if e != nil {
			http.Error(w, e.Error(), 500)
			return
		}
		defer sub.Close()
		w.Header().Set("Content-Type", "application/x-ndjson")
		for {
			frame, e := sub.Next(r.Context())
			if e != nil {
				if r.Context().Err() == nil {
					t.Logf("live ended: %v", e)
				}
				return
			}
			if _, e = w.Write(append(frame.Data, '\n')); e != nil {
				return
			}
			w.(http.Flusher).Flush()
		}
	})
	mux.Handle("/", http.FileServer(http.Dir(os.Getenv("REDEVEN_THREAD_OPEN_DIST"))))
	server := httptest.NewServer(mux)
	defer server.Close()
	phaseMu.Lock()
	data, _ := json.Marshal(map[string]any{"url": server.URL, "pid": os.Getpid(), "thread": id, "service_startup_ms": startupMS, "startup_phases": phases, "display_ready": readiness.DisplayReady})
	phaseMu.Unlock()
	if err := os.WriteFile(filepath.Join(state, "fixture.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	t.Logf("isolated fixture ready; execution remains deferred")
	select {
	case <-done:
	case <-t.Context().Done():
		t.Fatal(context.Cause(t.Context()))
	}
}
