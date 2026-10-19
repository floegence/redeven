package ai

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
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

// This fixture uses the published runtime and real product settings/detail/read
// boundaries. Event JSON is emitted only by canonical public APIs.
type parentEventForkFixture struct {
	service                     *Service
	canonical                   flruntime.ThreadService
	host                        *flruntime.Host
	source                      string
	child                       identity.ThreadID
	report                      string
	path                        string
	parentGateway, childGateway *florettest.ScriptedGateway
}

func newParentEventForkFixture(t *testing.T) *parentEventForkFixture {
	t.Helper()
	f := &parentEventForkFixture{service: newSendTurnTestService(t), path: filepath.Join(t.TempDir(), "events.sqlite"), report: "Inherited research finding\n" + strings.Repeat("Complete source evidence and original formatting.\n", 24)}
	raw, _ := json.Marshal(map[string]string{"message": f.report})
	f.childGateway = delegationContextGateway(florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventToolCalls, ToolCalls: []flprovider.ToolCall{{ID: "report", Name: "report_to_parent", Args: string(raw)}}}, {Type: flprovider.EventDone, Reason: "tool_calls"}}}, delegationContextDone())
	f.parentGateway = delegationContextGateway(delegationContextDone())
	f.open(t)
	t.Cleanup(func() { _ = f.host.Shutdown(context.Background()) })
	source, err := f.service.CreateThread(t.Context(), testSendTurnMeta(), "Research source", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	f.source = source.ThreadID
	child, err := f.canonical.Create(t.Context(), flruntime.CreateThreadInput{ParentThreadID: identity.ThreadID(f.source), TaskName: "Research", HostProfileRef: "test", RequestKey: "child"})
	if err != nil {
		t.Fatal(err)
	}
	f.child = child.ThreadID
	delegationContextSend(t, f.canonical, identity.ThreadID(f.source), "review", nil)
	delegationContextSend(t, f.canonical, f.child, "research", nil)
	return f
}

func (f *parentEventForkFixture) open(t *testing.T) {
	t.Helper()
	host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: storage.SQLite(f.path), EnableParentEvents: true})
	if err != nil {
		t.Fatal(err)
	}
	f.host = host
	report := fltools.Define[struct{ Message string }](fltools.Definition{Name: "report_to_parent", ReadOnly: true, InputSchema: fltools.StrictObject(map[string]any{"message": map[string]any{"type": "string"}}, []string{"message"}), Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}}, nil, nil, func(ctx context.Context, in fltools.Invocation[struct{ Message string }]) (fltools.Result, error) {
		hash := sha256.Sum256([]byte(strings.TrimSpace(in.RawArgs)))
		receipt, err := f.canonical.(flruntime.ThreadParentEventService).ReportToParent(ctx, flruntime.ReportToParentInput{ThreadID: in.ThreadID, TurnID: in.TurnID, RunID: in.RunID, ToolCallID: in.CallID, ToolName: in.Name, ArgumentHash: fmt.Sprintf("%x", hash), RequestKey: flruntime.RequestKey(in.CallID), Message: in.Args.Message})
		raw, _ := json.Marshal(receipt)
		return fltools.Result{Text: string(raw)}, err
	})
	f.canonical, err = host.ThreadService(flruntime.AgentFactoryFunc(func(_ context.Context, req flruntime.AgentRequest) (*flruntime.Agent, error) {
		gateway := f.parentGateway
		options := []flruntime.AgentOption{flruntime.WithAgentEffectAuthorization(floretAllowTestEffect)}
		if req.ThreadID == f.child {
			gateway = f.childGateway
			options = append(options, flruntime.WithAgentTools(report))
		}
		return flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "fork-events", Name: "Fork events"}, SystemPrompt: "Review canonical events.", Context: flconfig.ContextPolicy{ContextWindowTokens: 256000}}, gateway, options...)
	}))
	if err != nil {
		t.Fatal(err)
	}
	f.service.threadRuntime = f.canonical
}

func TestFlowerForkParentEventScopeThroughService(t *testing.T) {
	f := newParentEventForkFixture(t)
	meta := testSendTurnMeta()
	fork, err := f.service.ForkThreadWithOptions(t.Context(), meta, f.source, ForkThreadRequest{ClientRequestID: "fork-events", Title: "Research fork"})
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		detail, err := f.service.GetFlowerThreadDetail(t.Context(), meta, fork.ThreadID)
		if err != nil {
			t.Fatal(err)
		}
		page := detail.Current.ParentEvents
		if page == nil || page.ThreadID.String() != fork.ThreadID || len(page.Events) != 2 {
			t.Fatalf("fork page=%+v", page)
		}
		for _, item := range detail.Current.Items {
			if item.CanonicalOrdinal == 0 || item.CanonicalOrdinal >= page.Events[0].CanonicalOrdinal {
				t.Fatalf("late event precedes copied conversation: item=%+v event=%+v", item, page.Events[0])
			}
		}
		if page.Events[0].ParentTurnID == "" {
			t.Fatal("late event lost parent ownership")
		}
		full, err := f.service.GetFlowerParentEvents(t.Context(), meta, fork.ThreadID, ParentEventReadRequest{Action: "read", FirstEventID: page.FirstEventID, LastEventID: page.LastEventID})
		if err != nil || full.ThreadID.String() != fork.ThreadID || len(full.Events) != 2 || full.Events[0].Message != f.report || full.Events[0].ParentThreadID.String() != f.source {
			t.Fatalf("inherited=%+v %v", full, err)
		}
		if err := f.host.Shutdown(t.Context()); err != nil {
			t.Fatal(err)
		}
		f.open(t)
	}
	if len(f.parentGateway.Requests()) != 1 || len(f.childGateway.Requests()) != 2 {
		t.Fatal("fork/read/restart sampled provider")
	}
}

// Opt-in browser qualification shares the real fixture with the default Go
// contract test. Its only owner is the Flower UI qualification entry point.
func TestFlowerForkParentEventsUI(t *testing.T) {
	if os.Getenv("REDEVEN_FORK_PARENT_EVENTS_UI") != "1" {
		t.Skip("explicit Flower browser qualification only")
	}
	f := newParentEventForkFixture(t)
	meta := testSendTurnMeta()
	var mu sync.Mutex
	forks, reads := 0, 0
	failDetail, failRead := false, false
	mux := http.NewServeMux()
	mux.HandleFunc("/fixture", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		fail := func(err error) { http.Error(w, err.Error(), http.StatusInternalServerError) }
		id := r.URL.Query().Get("id")
		switch r.URL.Query().Get("op") {
		case "setup":
			_ = json.NewEncoder(w).Encode(map[string]string{"source": f.source, "report": f.report})
		case "arm":
			failDetail = true
			failRead = true
			_ = json.NewEncoder(w).Encode(true)
		case "list":
			value, err := f.service.ListThreads(r.Context(), meta, 200, "")
			if err != nil {
				fail(err)
				return
			}
			_ = json.NewEncoder(w).Encode(value)
		case "fork":
			var request ForkThreadRequest
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				fail(err)
				return
			}
			value, err := f.service.ForkThreadWithOptions(r.Context(), meta, id, request)
			if err != nil {
				fail(err)
				return
			}
			forks++
			_ = json.NewEncoder(w).Encode(map[string]any{"thread": value, "client_request_id": request.ClientRequestID})
		case "detail":
			if id != f.source && failDetail {
				failDetail = false
				http.Error(w, "Injected fork detail failure", http.StatusServiceUnavailable)
				return
			}
			value, err := f.service.GetFlowerThreadDetail(r.Context(), meta, id)
			if err != nil {
				fail(err)
				return
			}
			_ = json.NewEncoder(w).Encode(value)
		case "read":
			reads++
			if id != f.source && failRead {
				failRead = false
				http.Error(w, "Injected report read failure", http.StatusServiceUnavailable)
				return
			}
			var query ParentEventReadRequest
			if err := json.NewDecoder(r.Body).Decode(&query); err != nil {
				fail(err)
				return
			}
			value, err := f.service.GetFlowerParentEvents(r.Context(), meta, id, query)
			if err != nil {
				fail(err)
				return
			}
			_ = json.NewEncoder(w).Encode(value)
		case "restart":
			if err := f.host.Shutdown(r.Context()); err != nil {
				fail(err)
				return
			}
			f.open(t)
			_ = json.NewEncoder(w).Encode(true)
		case "counts":
			_ = json.NewEncoder(w).Encode(map[string]int{"forks": forks, "reads": reads, "parent_requests": len(f.parentGateway.Requests()), "child_requests": len(f.childGateway.Requests())})
		default:
			http.NotFound(w, r)
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
	t.Logf("owned Flower fork runtime commit=%s pid=%d url=%s state=%s", strings.TrimSpace(string(commit)), os.Getpid(), server.URL, f.path)
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Minute)
	defer cancel()
	command := exec.CommandContext(ctx, "node", filepath.Join(root, "scripts/check_flower_fork_parent_events_ui.mjs"), "--url="+server.URL, "--dist="+dist)
	command.Dir = root
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	if err := command.Run(); err != nil {
		t.Fatal(err)
	}
}
