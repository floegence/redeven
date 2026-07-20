package ai

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/floegence/redeven/internal/ai/threadstore"
	_ "modernc.org/sqlite"
)

func overwriteThreadSettingForTest(t *testing.T, svc *Service, threadID string, column string, value string) {
	t.Helper()
	switch column {
	case "working_dir", "permission_type", "reasoning_selection_json":
	default:
		t.Fatalf("unsupported thread setting column %q", column)
	}
	db, err := sql.Open("sqlite", "file:"+filepath.Join(svc.stateDir, "ai", "threads.sqlite")+"?_pragma=busy_timeout(3000)")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	defer func() { _ = db.Close() }()
	result, err := db.ExecContext(context.Background(), `UPDATE ai_thread_settings SET `+column+` = ? WHERE thread_id = ?`, value, threadID)
	if err != nil {
		t.Fatal(err)
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		t.Fatalf("updated rows=%d, want 1", affected)
	}
}

func TestPersistedThreadSettingsRejectDamageWithoutFallback(t *testing.T) {
	var providerCalls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		providerCalls.Add(1)
		http.Error(w, "provider must not be called", http.StatusInternalServerError)
	}))
	t.Cleanup(provider.Close)
	testCases := []struct {
		name       string
		column     string
		value      string
		wantMarker string
	}{
		{name: "empty working directory", column: "working_dir", value: "", wantMarker: "working directory setting is empty"},
		{name: "empty permission", column: "permission_type", value: "", wantMarker: "permission type is empty"},
		{name: "damaged reasoning", column: "reasoning_selection_json", value: `{"level":`, wantMarker: "decode stored reasoning selection"},
		{name: "unknown reasoning field", column: "reasoning_selection_json", value: `{"legacy_effort":"high"}`, wantMarker: "unknown field"},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			svc := newSendTurnTestService(t)
			svc.mu.Lock()
			svc.cfg.Providers[0].BaseURL = provider.URL + "/v1"
			svc.resolveProviderKey = func(string) (string, bool, error) { return "sk-test", true, nil }
			svc.mu.Unlock()
			meta := testSendTurnMeta()
			thread, err := svc.CreateThread(context.Background(), meta, "strict settings", "", "", "")
			if err != nil {
				t.Fatalf("CreateThread: %v", err)
			}
			overwriteThreadSettingForTest(t, svc, thread.ThreadID, testCase.column, testCase.value)
			callsBefore := providerCalls.Load()

			if _, err := svc.GetThread(context.Background(), meta, thread.ThreadID); err == nil || !strings.Contains(err.Error(), testCase.wantMarker) {
				t.Fatalf("GetThread error=%v, want marker %q", err, testCase.wantMarker)
			}
			if _, err := svc.ListThreads(context.Background(), meta, 20, ""); err == nil || !strings.Contains(err.Error(), testCase.wantMarker) {
				t.Fatalf("ListThreads error=%v, want marker %q", err, testCase.wantMarker)
			}
			if _, err := svc.SendUserTurn(context.Background(), meta, SendUserTurnRequest{
				ThreadID: thread.ThreadID, Input: RunInput{Text: "must fail before provider"},
			}); err == nil || !strings.Contains(err.Error(), testCase.wantMarker) {
				t.Fatalf("SendUserTurn error=%v, want marker %q", err, testCase.wantMarker)
			}
			svc.mu.Lock()
			active := strings.TrimSpace(svc.activeRunByTh[runThreadKey(meta.EndpointID, thread.ThreadID)])
			svc.mu.Unlock()
			if active != "" {
				t.Fatalf("active run=%q, want none", active)
			}
			if queued, err := svc.threadsDB.CountFollowupsByLane(context.Background(), meta.EndpointID, thread.ThreadID, threadstore.FollowupLaneQueued); err != nil || queued != 0 {
				t.Fatalf("queued count=%d err=%v, want none", queued, err)
			}
			if calls := providerCalls.Load(); calls != callsBefore {
				t.Fatalf("provider calls=%d after invalid persisted settings, want %d", calls, callsBefore)
			}
		})
	}
}

func TestSetThreadPermissionDoesNotRepairInvalidPersistedValue(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(context.Background(), meta, "strict permission", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	overwriteThreadSettingForTest(t, svc, thread.ThreadID, "permission_type", "invalid")
	if err := svc.SetThreadPermissionType(context.Background(), meta, thread.ThreadID, "full_access"); err == nil {
		t.Fatal("SetThreadPermissionType repaired an invalid persisted permission")
	}
	db, err := sql.Open("sqlite", "file:"+filepath.Join(svc.stateDir, "ai", "threads.sqlite")+"?_pragma=busy_timeout(3000)")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	defer func() { _ = db.Close() }()
	var stored string
	if err := db.QueryRowContext(context.Background(), `SELECT permission_type FROM ai_thread_settings WHERE thread_id = ?`, thread.ThreadID).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored != "invalid" {
		t.Fatalf("stored permission=%q, want unchanged invalid value", stored)
	}
}

func TestQueuedTurnRemainsPendingWhenPersistedPermissionIsDamaged(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()
	thread, err := svc.CreateThread(ctx, meta, "strict queued permission", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	queued, _, err := svc.enqueueQueuedTurn(ctx, meta, SendUserTurnRequest{
		ThreadID: thread.ThreadID,
		Input:    RunInput{Text: "remain queued until settings are repaired"},
	})
	if err != nil {
		t.Fatal(err)
	}
	overwriteThreadSettingForTest(t, svc, thread.ThreadID, "permission_type", "")

	actor := svc.threadMgr.Get(meta.EndpointID, thread.ThreadID)
	if actor == nil {
		t.Fatal("thread actor is unavailable")
	}
	if err := actor.handleMaybeStartQueuedTurn(ctx); err == nil || !strings.Contains(err.Error(), "permission type is empty") {
		t.Fatalf("queued turn start error=%v, want strict permission error", err)
	}
	stored, err := svc.threadsDB.GetQueuedTurn(ctx, meta.EndpointID, thread.ThreadID, queued.QueueID)
	if err != nil {
		t.Fatalf("GetQueuedTurn: %v", err)
	}
	if stored == nil || stored.QueueID != queued.QueueID {
		t.Fatalf("stored queued turn=%#v, want %q", stored, queued.QueueID)
	}
}
