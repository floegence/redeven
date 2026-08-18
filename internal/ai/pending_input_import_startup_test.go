package ai

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/v4/identity"
	flruntime "github.com/floegence/floret/v4/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
	_ "modernc.org/sqlite"
)

func TestPendingInputImportsRunBeforeServiceMaintenance(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		<-r.Context().Done()
	}))
	t.Cleanup(provider.Close)
	stateDir := t.TempDir()
	cfg := &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{
		ID: "openai", Type: "openai", BaseURL: provider.URL + "/v1", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
	}}}
	meta := session.Meta{
		EndpointID: "env_pending_import", NamespacePublicID: "ns_pending_import", ChannelID: "ch_pending_import",
		UserPublicID: "user_pending_import", UserEmail: "pending@example.com", CanRead: true, CanWrite: true, CanExecute: true,
	}
	newService := func() (*Service, error) {
		return NewService(Options{
			Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateDir, AgentHomeDir: stateDir,
			Shell: "/bin/bash", Config: cfg, PersistOpTimeout: time.Second,
			ResolveProviderAPIKey: func(string) (string, bool, error) { return "sk-test", true, nil },
		})
	}
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	thread, err := svc.CreateThread(context.Background(), &meta, "pending import", "openai/gpt-5-mini", "approval_required", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}

	db, err := sql.Open("sqlite", filepath.Join(stateDir, "ai", "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	metaJSON, _ := json.Marshal(meta)
	insertPendingImportForTest(t, db, "request_pending_1", meta.EndpointID, thread.ThreadID, "first imported input", string(metaJSON), 10)
	insertPendingImportForTest(t, db, "request_pending_2", meta.EndpointID, thread.ThreadID, "second imported input", string(metaJSON), 20)
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	restarted, err := newService()
	if err != nil {
		t.Fatalf("restart pending input import: %v", err)
	}
	t.Cleanup(func() { _ = restarted.Close() })
	view, err := restarted.threadRuntime.View(context.Background(), identity.ThreadID(thread.ThreadID))
	if err != nil {
		t.Fatal(err)
	}
	if view.Activity != flruntime.ThreadActivityActive || len(view.Items) != 1 || view.Items[0].Text != "first imported input" || len(view.Queue) != 1 || view.Queue[0].Input.Text != "second imported input" {
		t.Fatalf("imported canonical order/state=%#v", view)
	}
	db, err = sql.Open("sqlite", filepath.Join(stateDir, "ai", "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if count := pendingInputImportCountForTest(t, db); count != 0 {
		t.Fatalf("pending imports after successful restart=%d, want 0", count)
	}
	for _, requestID := range []string{"request_pending_1", "request_pending_2"} {
		assertPendingImportAuthorityForTest(t, db, requestID, meta)
	}
}

func TestPendingInputImportPersistsAuthorityBeforeCanonicalImport(t *testing.T) {
	meta := testSendTurnMeta()
	const threadID = "thread_pending_authority_order"
	workDir := t.TempDir()
	store := newAuthorityContinuityStore(t)
	if err := store.CreateThreadSettings(t.Context(), threadstore.ThreadSettings{
		ThreadID: threadID, EndpointID: meta.EndpointID, NamespacePublicID: meta.NamespacePublicID,
		ModelID: "openai/gpt-5-mini", PermissionType: permissionTypeString(FlowerPermissionApprovalRequired), WorkingDir: workDir,
	}); err != nil {
		t.Fatal(err)
	}
	metaJSON, err := json.Marshal(meta)
	if err != nil {
		t.Fatal(err)
	}
	const requestID = "request_pending_authority_order"
	runtime := &authorityContinuityRuntime{}
	effects := newFloretEffectAdapter()
	svc := &Service{
		cfg: &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{
			ID: "openai", Type: "openai", BaseURL: "https://api.openai.com/v1", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
		}}},
		stateDir: workDir, agentHomeDir: workDir, persistOpTO: time.Second,
		threadsDB: store, threadRuntime: runtime, floretEffects: effects,
		terminalProcesses: newTerminalProcessManager(),
	}
	effects.bind(svc)
	runtime.importPendingInputs = func(ctx context.Context, input flruntime.ImportPendingInputsInput) (flruntime.ImportResult, error) {
		authority, err := svc.threadsDB.GetExecutionAuthority(ctx, requestID)
		if err != nil {
			t.Fatal(err)
		}
		if authority == nil || authority.ThreadID != threadID || authority.EndpointID != meta.EndpointID || authority.UserPublicID != meta.UserPublicID {
			t.Fatalf("authority at canonical import=%#v", authority)
		}
		return flruntime.ImportResult{ThreadID: input.ThreadID, Imported: len(input.Items), View: flruntime.ThreadView{
			ThreadID: input.ThreadID, Activity: flruntime.ThreadActivityActive,
		}}, nil
	}
	if err := svc.importPendingInputGroup(t.Context(), []threadstore.PendingInputImport{{
		RequestID: requestID, EndpointID: meta.EndpointID, ThreadID: threadID, ModelID: "openai/gpt-5-mini",
		TextContent: "import with original authority", AttachmentsJSON: "[]", OptionsJSON: "{}", SessionMetaJSON: string(metaJSON),
	}}); err != nil {
		t.Fatal(err)
	}
}

func TestPendingInputCanonicalFailureStopsStartupAndPreservesStaging(t *testing.T) {
	stateDir := t.TempDir()
	svc, err := NewService(Options{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateDir, AgentHomeDir: stateDir,
		Shell: "/bin/bash", Config: &config.AIConfig{}, PersistOpTimeout: time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", filepath.Join(stateDir, "ai", "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	meta := session.Meta{EndpointID: "env_missing_canonical", NamespacePublicID: "ns", ChannelID: "ch", UserPublicID: "user", CanRead: true, CanWrite: true, CanExecute: true}
	metaJSON, _ := json.Marshal(meta)
	threadID := "thread_missing_canonical_import"
	if _, err := db.Exec(`INSERT INTO ai_thread_settings(thread_id, parent_thread_id, endpoint_id, namespace_public_id, model_id, permission_type, settings_created_at_unix_ms, settings_updated_at_unix_ms) VALUES(?, '', ?, ?, 'openai/gpt-5-mini', 'approval_required', 1, 1)`, threadID, meta.EndpointID, meta.NamespacePublicID); err != nil {
		t.Fatal(err)
	}
	insertPendingImportForTest(t, db, "request_missing_canonical", meta.EndpointID, threadID, "must remain staged", string(metaJSON), 1)
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	failed, err := NewService(Options{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateDir, AgentHomeDir: stateDir,
		Shell: "/bin/bash", Config: &config.AIConfig{}, PersistOpTimeout: time.Second,
	})
	if err == nil || !strings.Contains(err.Error(), "import pending inputs") {
		if failed != nil {
			_ = failed.Close()
		}
		t.Fatalf("startup error=%v, want canonical import failure", err)
	}
	db, err = sql.Open("sqlite", filepath.Join(stateDir, "ai", "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if count := pendingInputImportCountForTest(t, db); count != 1 {
		t.Fatalf("pending imports after canonical failure=%d, want 1", count)
	}
}

func insertPendingImportForTest(t *testing.T, db *sql.DB, requestID, endpointID, threadID, text, metaJSON string, createdAt int64) {
	t.Helper()
	_, err := db.Exec(`INSERT INTO ai_pending_input_imports(request_id, endpoint_id, thread_id, model_id, text_content, attachments_json, context_action_json, options_json, session_meta_json, created_at_unix_ms) VALUES(?, ?, ?, 'openai/gpt-5-mini', ?, '[]', '', '{}', ?, ?)`, requestID, endpointID, threadID, text, metaJSON, createdAt)
	if err != nil {
		t.Fatal(err)
	}
}

func pendingInputImportCountForTest(t *testing.T, db *sql.DB) int {
	t.Helper()
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM ai_pending_input_imports WHERE imported_at_unix_ms = 0`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func assertPendingImportAuthorityForTest(t *testing.T, db *sql.DB, requestID string, want session.Meta) {
	t.Helper()
	var endpointID, namespacePublicID, channelID, userPublicID, userEmail string
	if err := db.QueryRow(`SELECT endpoint_id, namespace_public_id, channel_id, user_public_id, user_email FROM ai_flower_execution_authority WHERE request_key = ?`, requestID).Scan(
		&endpointID, &namespacePublicID, &channelID, &userPublicID, &userEmail,
	); err != nil {
		t.Fatalf("load pending import authority %q: %v", requestID, err)
	}
	if endpointID != want.EndpointID || namespacePublicID != want.NamespacePublicID || channelID != want.ChannelID || userPublicID != want.UserPublicID || userEmail != want.UserEmail {
		t.Fatalf("pending import authority %q=(%q, %q, %q, %q, %q), want (%q, %q, %q, %q, %q)",
			requestID, endpointID, namespacePublicID, channelID, userPublicID, userEmail,
			want.EndpointID, want.NamespacePublicID, want.ChannelID, want.UserPublicID, want.UserEmail,
		)
	}
}
