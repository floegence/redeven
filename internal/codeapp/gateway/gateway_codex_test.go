package gateway

import (
	"bytes"
	"context"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"testing/fstest"

	"github.com/floegence/redeven/internal/codexbridge"
	"github.com/floegence/redeven/internal/session"
)

type stubCodexBackend struct {
	status               func(ctx context.Context) codexbridge.Status
	readCapabilities     func(ctx context.Context, cwd string) (*codexbridge.Capabilities, error)
	listThreads          func(ctx context.Context, req codexbridge.ListThreadsRequest) ([]codexbridge.Thread, error)
	readThread           func(ctx context.Context, threadID string) (*codexbridge.ThreadDetail, error)
	startThread          func(ctx context.Context, req codexbridge.StartThreadRequest) (*codexbridge.ThreadDetail, error)
	startTurn            func(ctx context.Context, req codexbridge.StartTurnRequest) (*codexbridge.Turn, error)
	archiveThread        func(ctx context.Context, threadID string) error
	unarchiveThread      func(ctx context.Context, threadID string) error
	forkThread           func(ctx context.Context, req codexbridge.ForkThreadRequest) (*codexbridge.ThreadDetail, error)
	interruptTurn        func(ctx context.Context, req codexbridge.InterruptTurnRequest) error
	startReview          func(ctx context.Context, req codexbridge.StartReviewRequest) (*codexbridge.ThreadDetail, error)
	subscribeThreadEvent func(ctx context.Context, threadID string, afterSeq int64) ([]codexbridge.Event, <-chan codexbridge.Event, error)
	respondToRequest     func(ctx context.Context, threadID string, requestID string, resp codexbridge.PendingRequestResponse) error
}

func (s *stubCodexBackend) Status(ctx context.Context) codexbridge.Status {
	if s.status != nil {
		return s.status(ctx)
	}
	return codexbridge.Status{}
}

func (s *stubCodexBackend) ReadCapabilities(ctx context.Context, cwd string) (*codexbridge.Capabilities, error) {
	if s.readCapabilities != nil {
		return s.readCapabilities(ctx, cwd)
	}
	return nil, nil
}

func (s *stubCodexBackend) ListThreads(ctx context.Context, req codexbridge.ListThreadsRequest) ([]codexbridge.Thread, error) {
	if s.listThreads != nil {
		return s.listThreads(ctx, req)
	}
	return nil, nil
}

func (s *stubCodexBackend) ReadThread(ctx context.Context, threadID string) (*codexbridge.ThreadDetail, error) {
	if s.readThread != nil {
		return s.readThread(ctx, threadID)
	}
	return nil, nil
}

func (s *stubCodexBackend) StartThread(ctx context.Context, req codexbridge.StartThreadRequest) (*codexbridge.ThreadDetail, error) {
	if s.startThread != nil {
		return s.startThread(ctx, req)
	}
	return nil, nil
}

func (s *stubCodexBackend) StartTurn(ctx context.Context, req codexbridge.StartTurnRequest) (*codexbridge.Turn, error) {
	if s.startTurn != nil {
		return s.startTurn(ctx, req)
	}
	return nil, nil
}

func (s *stubCodexBackend) ArchiveThread(ctx context.Context, threadID string) error {
	if s.archiveThread != nil {
		return s.archiveThread(ctx, threadID)
	}
	return nil
}

func (s *stubCodexBackend) UnarchiveThread(ctx context.Context, threadID string) error {
	if s.unarchiveThread != nil {
		return s.unarchiveThread(ctx, threadID)
	}
	return nil
}

func (s *stubCodexBackend) ForkThread(ctx context.Context, req codexbridge.ForkThreadRequest) (*codexbridge.ThreadDetail, error) {
	if s.forkThread != nil {
		return s.forkThread(ctx, req)
	}
	return nil, nil
}

func (s *stubCodexBackend) InterruptTurn(ctx context.Context, req codexbridge.InterruptTurnRequest) error {
	if s.interruptTurn != nil {
		return s.interruptTurn(ctx, req)
	}
	return nil
}

func (s *stubCodexBackend) StartReview(ctx context.Context, req codexbridge.StartReviewRequest) (*codexbridge.ThreadDetail, error) {
	if s.startReview != nil {
		return s.startReview(ctx, req)
	}
	return nil, nil
}

func (s *stubCodexBackend) SubscribeThreadEvents(ctx context.Context, threadID string, afterSeq int64) ([]codexbridge.Event, <-chan codexbridge.Event, error) {
	if s.subscribeThreadEvent != nil {
		return s.subscribeThreadEvent(ctx, threadID, afterSeq)
	}
	ch := make(chan codexbridge.Event)
	close(ch)
	return nil, ch, nil
}

func (s *stubCodexBackend) RespondToRequest(ctx context.Context, threadID string, requestID string, resp codexbridge.PendingRequestResponse) error {
	if s.respondToRequest != nil {
		return s.respondToRequest(ctx, threadID, requestID, resp)
	}
	return nil
}

func codexTestDistFS() fs.FS {
	return fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}
}

func TestGateway_SettingsUpdate_RejectsHostManagedCodexConfig(t *testing.T) {
	t.Parallel()

	cfgPath := writeTestConfig(t)
	before, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatalf("ReadFile(before): %v", err)
	}
	channelID := "ch_test_codex_settings"
	envOrigin := envOriginWithChannel(channelID)

	gw, err := New(Options{
		Backend:            &stubBackend{},
		DistFS:             codexTestDistFS(),
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         cfgPath,
		ResolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanAdmin: true}),
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	req := httptest.NewRequest(http.MethodPut, "/_redeven_proxy/api/settings", bytes.NewBufferString(`{
  "codex": {
    "binary_path": "/usr/local/bin/codex"
  }
}`))
	req.Header.Set("Origin", envOrigin)
	rr := httptest.NewRecorder()
	gw.serveHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status=%d, want=%d body=%s", rr.Code, http.StatusBadRequest, rr.Body.String())
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte("Codex is host-managed")) {
		t.Fatalf("unexpected body: %s", rr.Body.String())
	}

	after, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatalf("ReadFile(after): %v", err)
	}
	if !bytes.Equal(before, after) {
		t.Fatalf("config.json changed unexpectedly:\n%s", string(after))
	}
}

func TestGateway_CodexRoutes_ExposeIndependentGatewaySurface(t *testing.T) {
	t.Parallel()

	channelID := "ch_test_codex_routes"
	envOrigin := envOriginWithChannel(channelID)

	thread := codexbridge.Thread{
		ID:             "thread_1",
		Preview:        "Fix the failing tests",
		ModelProvider:  "openai/gpt-5.4",
		CreatedAtUnixS: 10,
		UpdatedAtUnixS: 12,
		Status:         "running",
		CWD:            "/workspace",
	}

	var (
		gotStartThread     codexbridge.StartThreadRequest
		gotStartTurn       codexbridge.StartTurnRequest
		gotListThreads     codexbridge.ListThreadsRequest
		gotCapabilitiesCWD string
		gotArchiveID       string
		gotUnarchiveID     string
		gotForkThread      codexbridge.ForkThreadRequest
		gotInterruptTurn   codexbridge.InterruptTurnRequest
		gotReviewStart     codexbridge.StartReviewRequest
		gotRespondThread   string
		gotRespondID       string
		gotRespondBody     codexbridge.PendingRequestResponse
		gotAfterSeq        int64
	)

	gw, err := New(Options{
		Backend: &stubBackend{},
		Codex: &stubCodexBackend{
			status: func(ctx context.Context) codexbridge.Status {
				return codexbridge.Status{
					Available:    true,
					Ready:        true,
					BinaryPath:   "/usr/local/bin/codex",
					AgentHomeDir: "/workspace",
				}
			},
			readCapabilities: func(ctx context.Context, cwd string) (*codexbridge.Capabilities, error) {
				gotCapabilitiesCWD = cwd
				return &codexbridge.Capabilities{
					Models: []codexbridge.ModelOption{
						{
							ID:                        "gpt-5.4",
							DisplayName:               "GPT-5.4",
							IsDefault:                 true,
							SupportsImageInput:        true,
							DefaultReasoningEffort:    "medium",
							SupportedReasoningEfforts: []string{"low", "medium", "high"},
						},
					},
					EffectiveConfig: codexbridge.ThreadRuntimeConfig{
						CWD:             "/workspace/ui",
						Model:           "gpt-5.4",
						ApprovalPolicy:  "on-request",
						SandboxMode:     "workspace-write",
						ReasoningEffort: "medium",
					},
					Requirements: &codexbridge.ConfigRequirements{
						AllowedApprovalPolicies: []string{"on-request", "never"},
						AllowedSandboxModes:     []string{"workspace-write", "danger-full-access"},
					},
					Operations: []codexbridge.OperationName{
						codexbridge.OperationThreadArchive,
						codexbridge.OperationThreadFork,
						codexbridge.OperationTurnInterrupt,
						codexbridge.OperationReviewStart,
					},
				}, nil
			},
			listThreads: func(ctx context.Context, req codexbridge.ListThreadsRequest) ([]codexbridge.Thread, error) {
				gotListThreads = req
				return []codexbridge.Thread{thread}, nil
			},
			readThread: func(ctx context.Context, threadID string) (*codexbridge.ThreadDetail, error) {
				contextWindow := int64(128000)
				return &codexbridge.ThreadDetail{
					Thread: thread,
					RuntimeConfig: codexbridge.ThreadRuntimeConfig{
						CWD:             "/workspace",
						Model:           "gpt-5.4",
						ApprovalPolicy:  "on-request",
						SandboxMode:     "workspace-write",
						ReasoningEffort: "medium",
					},
					TokenUsage: &codexbridge.ThreadTokenUsage{
						Total: codexbridge.TokenUsageBreakdown{
							TotalTokens:           6400,
							InputTokens:           4200,
							CachedInputTokens:     600,
							OutputTokens:          1100,
							ReasoningOutputTokens: 300,
						},
						Last: codexbridge.TokenUsageBreakdown{
							TotalTokens:           1200,
							InputTokens:           800,
							CachedInputTokens:     200,
							OutputTokens:          150,
							ReasoningOutputTokens: 50,
						},
						ModelContextWindow: &contextWindow,
					},
					LastAppliedSeq: 2,
					ActiveStatus:   "running",
				}, nil
			},
			startThread: func(ctx context.Context, req codexbridge.StartThreadRequest) (*codexbridge.ThreadDetail, error) {
				gotStartThread = req
				return &codexbridge.ThreadDetail{
					Thread: thread,
					RuntimeConfig: codexbridge.ThreadRuntimeConfig{
						CWD:            req.CWD,
						Model:          req.Model,
						ApprovalPolicy: req.ApprovalPolicy,
						SandboxMode:    req.SandboxMode,
					},
				}, nil
			},
			startTurn: func(ctx context.Context, req codexbridge.StartTurnRequest) (*codexbridge.Turn, error) {
				gotStartTurn = req
				return &codexbridge.Turn{ID: "turn_1", Status: "running"}, nil
			},
			archiveThread: func(ctx context.Context, threadID string) error {
				gotArchiveID = threadID
				return nil
			},
			unarchiveThread: func(ctx context.Context, threadID string) error {
				gotUnarchiveID = threadID
				return nil
			},
			forkThread: func(ctx context.Context, req codexbridge.ForkThreadRequest) (*codexbridge.ThreadDetail, error) {
				gotForkThread = req
				return &codexbridge.ThreadDetail{
					Thread: codexbridge.Thread{
						ID:             "thread_forked",
						Preview:        "Forked review",
						ModelProvider:  "openai/gpt-5.4",
						CreatedAtUnixS: 20,
						UpdatedAtUnixS: 21,
						Status:         "active",
						CWD:            "/workspace",
					},
					RuntimeConfig: codexbridge.ThreadRuntimeConfig{
						CWD:               "/workspace",
						Model:             req.Model,
						ApprovalPolicy:    req.ApprovalPolicy,
						SandboxMode:       req.SandboxMode,
						ApprovalsReviewer: req.ApprovalsReviewer,
					},
				}, nil
			},
			interruptTurn: func(ctx context.Context, req codexbridge.InterruptTurnRequest) error {
				gotInterruptTurn = req
				return nil
			},
			startReview: func(ctx context.Context, req codexbridge.StartReviewRequest) (*codexbridge.ThreadDetail, error) {
				gotReviewStart = req
				return &codexbridge.ThreadDetail{
					Thread: thread,
					RuntimeConfig: codexbridge.ThreadRuntimeConfig{
						CWD:             "/workspace",
						Model:           "gpt-5.4",
						ApprovalPolicy:  "on-request",
						SandboxMode:     "workspace-write",
						ReasoningEffort: "medium",
					},
					LastAppliedSeq: 4,
					ActiveStatus:   "running",
				}, nil
			},
			subscribeThreadEvent: func(ctx context.Context, threadID string, afterSeq int64) ([]codexbridge.Event, <-chan codexbridge.Event, error) {
				gotAfterSeq = afterSeq
				ch := make(chan codexbridge.Event)
				close(ch)
				return []codexbridge.Event{{Seq: 3, Type: "thread_status_changed", ThreadID: threadID, Status: "running"}}, ch, nil
			},
			respondToRequest: func(ctx context.Context, threadID string, requestID string, resp codexbridge.PendingRequestResponse) error {
				gotRespondThread = threadID
				gotRespondID = requestID
				gotRespondBody = resp
				return nil
			},
		},
		DistFS:             codexTestDistFS(),
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         writeTestConfig(t),
		ResolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanWrite: true, CanExecute: true}),
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	t.Run("status", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/codex/status", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
		}
		if !bytes.Contains(rr.Body.Bytes(), []byte(`"/usr/local/bin/codex"`)) {
			t.Fatalf("unexpected body: %s", rr.Body.String())
		}
	})

	t.Run("threads list", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/codex/threads?limit=10&archived=true", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
		}
		if !bytes.Contains(rr.Body.Bytes(), []byte(`"thread_1"`)) {
			t.Fatalf("unexpected body: %s", rr.Body.String())
		}
		if gotListThreads.Limit != 10 || gotListThreads.Archived == nil || !*gotListThreads.Archived {
			t.Fatalf("unexpected list thread request: %+v", gotListThreads)
		}
	})

	t.Run("capabilities", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/codex/capabilities?cwd=%2Fworkspace%2Fui", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
		}
		if gotCapabilitiesCWD != "/workspace/ui" {
			t.Fatalf("ReadCapabilities cwd=%q, want=%q", gotCapabilitiesCWD, "/workspace/ui")
		}
		if !bytes.Contains(rr.Body.Bytes(), []byte(`"effective_config"`)) ||
			!bytes.Contains(rr.Body.Bytes(), []byte(`"allowed_sandbox_modes"`)) ||
			!bytes.Contains(rr.Body.Bytes(), []byte(`"operations"`)) {
			t.Fatalf("unexpected body: %s", rr.Body.String())
		}
	})

	t.Run("start thread", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/codex/threads", bytes.NewBufferString(`{"cwd":"/workspace","model":"gpt-5.4","approval_policy":"on-request","sandbox_mode":"workspace-write"}`))
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
		}
		if gotStartThread.CWD != "/workspace" || gotStartThread.Model != "gpt-5.4" || gotStartThread.ApprovalPolicy != "on-request" || gotStartThread.SandboxMode != "workspace-write" {
			t.Fatalf("unexpected start thread request: %+v", gotStartThread)
		}
		if !bytes.Contains(rr.Body.Bytes(), []byte(`"runtime_config"`)) {
			t.Fatalf("unexpected body: %s", rr.Body.String())
		}
	})

	t.Run("open thread", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/codex/threads/thread_1", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
		}
		if !bytes.Contains(rr.Body.Bytes(), []byte(`"last_applied_seq":2`)) || !bytes.Contains(rr.Body.Bytes(), []byte(`"token_usage"`)) {
			t.Fatalf("unexpected body: %s", rr.Body.String())
		}
	})

	t.Run("start turn", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/codex/threads/thread_1/turns", bytes.NewBufferString(`{
			"input_text":"please continue",
			"inputs":[{"type":"image","url":"data:image/png;base64,AAA","name":"snapshot.png"}],
			"cwd":"/workspace/ui",
			"model":"gpt-5.4",
			"effort":"high",
			"approval_policy":"on-request",
			"sandbox_mode":"workspace-write"
		}`))
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
		}
		if gotStartTurn.ThreadID != "thread_1" ||
			gotStartTurn.InputText != "please continue" ||
			gotStartTurn.CWD != "/workspace/ui" ||
			gotStartTurn.Model != "gpt-5.4" ||
			gotStartTurn.Effort != "high" ||
			gotStartTurn.ApprovalPolicy != "on-request" ||
			gotStartTurn.SandboxMode != "workspace-write" {
			t.Fatalf("unexpected start turn request: %+v", gotStartTurn)
		}
		if len(gotStartTurn.Inputs) != 1 || gotStartTurn.Inputs[0].Type != "image" || gotStartTurn.Inputs[0].Name != "snapshot.png" {
			t.Fatalf("unexpected start turn inputs: %+v", gotStartTurn.Inputs)
		}
	})

	t.Run("respond request", func(t *testing.T) {
		req := httptest.NewRequest(
			http.MethodPost,
			"/_redeven_proxy/api/codex/threads/thread_1/requests/request_1/response",
			bytes.NewBufferString(`{"type":"permissions","decision":"accept","answers":{"q1":["yes"]}}`),
		)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
		}
		if gotRespondThread != "thread_1" || gotRespondID != "request_1" {
			t.Fatalf("unexpected request target: thread=%q request=%q", gotRespondThread, gotRespondID)
		}
		if gotRespondBody.Decision != "accept" || gotRespondBody.Type != "permissions" {
			t.Fatalf("unexpected request body: %+v", gotRespondBody)
		}
		if answers := gotRespondBody.Answers["q1"]; len(answers) != 1 || answers[0] != "yes" {
			t.Fatalf("unexpected answers: %+v", gotRespondBody.Answers)
		}
	})

	t.Run("archive thread", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/codex/threads/thread_1/archive", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
		}
		if gotArchiveID != "thread_1" {
			t.Fatalf("ArchiveThread=%q, want=%q", gotArchiveID, "thread_1")
		}
	})

	t.Run("unarchive thread", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/codex/threads/thread_1/unarchive", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
		}
		if gotUnarchiveID != "thread_1" {
			t.Fatalf("UnarchiveThread=%q, want=%q", gotUnarchiveID, "thread_1")
		}
	})

	t.Run("fork thread", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/codex/threads/thread_1/fork", bytes.NewBufferString(`{
				"model":"gpt-5.4",
				"approval_policy":"on-request",
				"sandbox_mode":"workspace-write",
				"approvals_reviewer":"user"
			}`))
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
		}
		if gotForkThread.ThreadID != "thread_1" ||
			gotForkThread.Model != "gpt-5.4" ||
			gotForkThread.ApprovalPolicy != "on-request" ||
			gotForkThread.SandboxMode != "workspace-write" ||
			gotForkThread.ApprovalsReviewer != "user" {
			t.Fatalf("unexpected fork request: %+v", gotForkThread)
		}
		if !bytes.Contains(rr.Body.Bytes(), []byte(`"thread_forked"`)) {
			t.Fatalf("unexpected body: %s", rr.Body.String())
		}
	})

	t.Run("interrupt active turn", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/codex/threads/thread_1/interrupt", bytes.NewBufferString(`{"turn_id":"turn_1"}`))
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
		}
		if gotInterruptTurn.ThreadID != "thread_1" || gotInterruptTurn.TurnID != "turn_1" {
			t.Fatalf("unexpected interrupt request: %+v", gotInterruptTurn)
		}
	})

	t.Run("start review", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/codex/threads/thread_1/review", bytes.NewBufferString(`{"target":"uncommitted_changes"}`))
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
		}
		if gotReviewStart.ThreadID != "thread_1" || gotReviewStart.Target != "uncommitted_changes" {
			t.Fatalf("unexpected review request: %+v", gotReviewStart)
		}
		if !bytes.Contains(rr.Body.Bytes(), []byte(`"last_applied_seq":4`)) {
			t.Fatalf("unexpected body: %s", rr.Body.String())
		}
	})

	t.Run("event stream", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/codex/threads/thread_1/events?after_seq=2", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
		}
		if gotAfterSeq != 2 {
			t.Fatalf("after_seq=%d, want=2", gotAfterSeq)
		}
		if contentType := rr.Header().Get("Content-Type"); contentType != "text/event-stream" {
			t.Fatalf("Content-Type=%q, want=%q", contentType, "text/event-stream")
		}
		if !bytes.Contains(rr.Body.Bytes(), []byte("event: codex_event")) || !bytes.Contains(rr.Body.Bytes(), []byte(`"seq":3`)) {
			t.Fatalf("unexpected body: %s", rr.Body.String())
		}
	})
}
