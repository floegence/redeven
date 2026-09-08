package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
	_ "modernc.org/sqlite"
)

type reviewedSchemaFixtureObject struct {
	Type      string `json:"type"`
	Name      string `json:"name"`
	TableName string `json:"table_name"`
	SQL       string `json:"sql"`
}

type reviewedSchemaFixtureVersion struct {
	Version int                           `json:"version"`
	Objects []reviewedSchemaFixtureObject `json:"sqlite_master"`
	Tables  []struct {
		Indexes []struct {
			Sequence int    `json:"sequence"`
			Name     string `json:"name"`
		} `json:"index_list"`
	} `json:"tables"`
}

func TestPendingInputMigrationRunsBeforeServiceMaintenanceAndRemovesSource(t *testing.T) {
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
	thread, err := svc.CreateThread(context.Background(), &meta, "pending migration", "openai/gpt-5-mini", "approval_required", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}

	threadsPath := filepath.Join(stateDir, "ai", "threads.sqlite")
	replaceCurrentThreadstoreWithV4ForTest(t, threadsPath)
	db, err := sql.Open("sqlite", threadsPath)
	if err != nil {
		t.Fatal(err)
	}
	insertPendingMigrationThreadForTest(t, db, meta, thread.ThreadID)
	metaJSON, _ := json.Marshal(meta)
	insertPendingMigrationRecordForTest(t, db, "request_pending_1", meta.EndpointID, thread.ThreadID, "first imported input", string(metaJSON), 10)
	insertPendingMigrationRecordForTest(t, db, "request_pending_2", meta.EndpointID, thread.ThreadID, "second imported input", string(metaJSON), 20)
	const uploadID = "upl_aaaaaaaaaaaaaaaaaaaaaaaa"
	attachmentContent := []byte("migration attachment")
	attachmentDigest := sha256.Sum256(attachmentContent)
	if err := os.WriteFile(filepath.Join(stateDir, "ai", "uploads", uploadID+".data"), attachmentContent, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO ai_uploads(upload_id, endpoint_id, owner_scope_kind, owner_user_hash, storage_relpath, name, declared_media_type, detected_media_type, size_bytes, content_sha256, source, state, created_at_unix_ms, claimed_at_unix_ms, delete_after_unix_ms) VALUES(?, ?, 'user', ?, ?, 'migration.txt', 'text/plain', 'text/plain', ?, ?, 'uploaded_file', 'live', 1, 1, 0)`, uploadID, meta.EndpointID, strings.Repeat("a", 64), uploadID+".data", len(attachmentContent), fmt.Sprintf("%x", attachmentDigest)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms) VALUES(?, ?, ?, 'thread', ?, 1)`, meta.EndpointID, uploadID, thread.ThreadID, thread.ThreadID); err != nil {
		t.Fatal(err)
	}
	contextActionJSON, err := json.Marshal(ContextActionEnvelope{
		SchemaVersion: ContextActionSchemaVersion,
		ActionID:      "assistant.ask.flower",
		Provider:      "flower",
		Target:        ContextActionTarget{TargetID: "current", Locality: "auto"},
		Source:        ContextActionSource{Surface: "git_browser"},
		Context:       []ContextActionContextItem{{Kind: "text_snapshot", Title: "Migrated selection", Content: "selected migration text"}},
		Presentation:  ContextActionPresentation{Label: "Ask Flower", Priority: 100},
	})
	if err != nil {
		t.Fatal(err)
	}
	attachmentsJSON, err := json.Marshal([]RunAttachmentIn{{AttachmentID: uploadID}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE ai_pending_input_imports SET attachments_json = ?, context_action_json = ? WHERE request_id = 'request_pending_1'`, string(attachmentsJSON), string(contextActionJSON)); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	restarted, err := newService()
	if err != nil {
		t.Fatalf("restart pending input migration: %v", err)
	}
	t.Cleanup(func() { _ = restarted.Close() })
	view, err := restarted.threadRuntime.View(context.Background(), identity.ThreadID(thread.ThreadID))
	if err != nil {
		t.Fatal(err)
	}
	if view.Activity != flruntime.ThreadActivityActive || len(view.Items) != 1 || view.Items[0].Text != "first imported input" || len(view.Items[0].Attachments) != 1 || !strings.Contains(view.Items[0].Attachments[0].ResourceRef, uploadID) || len(view.Items[0].References) != 1 || view.Items[0].References[0].Text != "selected migration text" || len(view.Queue) != 1 || view.Queue[0].Input.Text != "second imported input" {
		t.Fatalf("imported canonical order/state=%#v", view)
	}
	db, err = sql.Open("sqlite", threadsPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	assertRetiredPendingStorageAbsentForTest(t, db)
	for _, requestID := range []string{"request_pending_1", "request_pending_2"} {
		assertPendingMigrationAuthorityForTest(t, db, requestID, meta)
	}
}

func TestPendingInputCanonicalFailureRollsBackProductMigration(t *testing.T) {
	stateDir := t.TempDir()
	threadsPath := filepath.Join(stateDir, "ai", "threads.sqlite")
	if err := os.MkdirAll(filepath.Dir(threadsPath), 0o700); err != nil {
		t.Fatal(err)
	}
	createReviewedV4ThreadstoreForTest(t, threadsPath)
	db, err := sql.Open("sqlite", threadsPath)
	if err != nil {
		t.Fatal(err)
	}
	meta := session.Meta{EndpointID: "env_missing_canonical", NamespacePublicID: "ns", ChannelID: "ch", UserPublicID: "user", CanRead: true, CanWrite: true, CanExecute: true}
	const threadID = "thread_missing_canonical_import"
	insertPendingMigrationThreadForTest(t, db, meta, threadID)
	metaJSON, _ := json.Marshal(meta)
	insertPendingMigrationRecordForTest(t, db, "request_missing_canonical", meta.EndpointID, threadID, "must remain in retired source", string(metaJSON), 1)
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	failed, err := NewService(Options{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateDir, AgentHomeDir: stateDir,
		Shell: "/bin/bash", Config: &config.AIConfig{}, PersistOpTimeout: time.Second,
	})
	var startupError *FloretStoreStartupError
	if !errors.As(err, &startupError) || startupError.Class != FloretStoreStartupMigrationFailed || startupError.Component != "product" {
		if failed != nil {
			_ = failed.Close()
		}
		t.Fatalf("startup error=%v, want canonical migration failure", err)
	}
	db, err = sql.Open("sqlite", threadsPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var version, sourceRows int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM ai_pending_input_imports`).Scan(&sourceRows); err != nil {
		t.Fatal(err)
	}
	if version != 4 || sourceRows != 1 {
		t.Fatalf("rolled back version=%d source rows=%d, want 4 and 1", version, sourceRows)
	}
}

func replaceCurrentThreadstoreWithV4ForTest(t *testing.T, path string) {
	t.Helper()
	for _, candidate := range []string{path, path + "-wal", path + "-shm"} {
		if err := os.Remove(candidate); err != nil && !os.IsNotExist(err) {
			t.Fatal(err)
		}
	}
	createReviewedV4ThreadstoreForTest(t, path)
}

func createReviewedV4ThreadstoreForTest(t *testing.T, path string) {
	t.Helper()
	body, err := os.ReadFile(filepath.Join("threadstore", "reviewed_schema_manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		Versions []reviewedSchemaFixtureVersion `json:"versions"`
	}
	if err := json.Unmarshal(body, &manifest); err != nil {
		t.Fatal(err)
	}
	var snapshot reviewedSchemaFixtureVersion
	for _, version := range manifest.Versions {
		if version.Version == 4 {
			snapshot = version
			break
		}
	}
	if len(snapshot.Objects) == 0 {
		t.Fatal("reviewed threadstore manifest is missing v4")
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()
	for _, objectType := range []string{"table", "trigger"} {
		for _, object := range snapshot.Objects {
			if object.Type != objectType || object.SQL == "" || strings.HasPrefix(object.Name, "sqlite_") {
				continue
			}
			if _, err := tx.Exec(object.SQL); err != nil {
				t.Fatalf("create v4 %s %s: %v", object.Type, object.Name, err)
			}
		}
	}
	indexSequence := make(map[string]int)
	for _, table := range snapshot.Tables {
		for _, index := range table.Indexes {
			indexSequence[index.Name] = index.Sequence
		}
	}
	indexes := append([]reviewedSchemaFixtureObject(nil), snapshot.Objects...)
	sort.SliceStable(indexes, func(left, right int) bool {
		if indexes[left].TableName != indexes[right].TableName {
			return indexes[left].TableName < indexes[right].TableName
		}
		return indexSequence[indexes[left].Name] > indexSequence[indexes[right].Name]
	})
	for _, object := range indexes {
		if object.Type != "index" || object.SQL == "" || strings.HasPrefix(object.Name, "sqlite_") {
			continue
		}
		if _, err := tx.Exec(object.SQL); err != nil {
			t.Fatalf("create v4 index %s: %v", object.Name, err)
		}
	}
	if _, err := tx.Exec(`INSERT INTO __redeven_db_meta(singleton, db_kind, created_at_unix_ms, last_migrated_at_unix_ms, last_migrated_from_version, last_migrated_to_version) VALUES(1, 'ai_threadstore_product_v1', 1, 1, 4, 4)`); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(`PRAGMA user_version=4`); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

func insertPendingMigrationThreadForTest(t *testing.T, db *sql.DB, meta session.Meta, threadID string) {
	t.Helper()
	if _, err := db.Exec(`INSERT INTO ai_thread_settings(thread_id, parent_thread_id, endpoint_id, namespace_public_id, model_id, permission_type, settings_created_at_unix_ms, settings_updated_at_unix_ms) VALUES(?, '', ?, ?, 'openai/gpt-5-mini', 'approval_required', 1, 1)`, threadID, meta.EndpointID, meta.NamespacePublicID); err != nil {
		t.Fatal(err)
	}
}

func insertPendingMigrationRecordForTest(t *testing.T, db *sql.DB, requestID, endpointID, threadID, text, metaJSON string, createdAt int64) {
	t.Helper()
	_, err := db.Exec(`INSERT INTO ai_pending_input_imports(request_id, endpoint_id, thread_id, model_id, text_content, attachments_json, context_action_json, options_json, session_meta_json, created_at_unix_ms) VALUES(?, ?, ?, 'openai/gpt-5-mini', ?, '[]', '', '{}', ?, ?)`, requestID, endpointID, threadID, text, metaJSON, createdAt)
	if err != nil {
		t.Fatal(err)
	}
}

func assertRetiredPendingStorageAbsentForTest(t *testing.T, db *sql.DB) {
	t.Helper()
	for _, name := range []string{"ai_pending_input_imports", "sqlite_sequence"} {
		var count int
		if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`, name).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("retired table %s remains", name)
		}
	}
	var retiredID int
	if err := db.QueryRow(`SELECT COUNT(*) FROM pragma_table_xinfo('ai_upload_refs') WHERE name='id'`).Scan(&retiredID); err != nil {
		t.Fatal(err)
	}
	if retiredID != 0 {
		t.Fatal("retired ai_upload_refs.id remains")
	}
}

func assertPendingMigrationAuthorityForTest(t *testing.T, db *sql.DB, requestID string, want session.Meta) {
	t.Helper()
	var endpointID, namespacePublicID, channelID, userPublicID, userEmail string
	if err := db.QueryRow(`SELECT endpoint_id, namespace_public_id, channel_id, user_public_id, user_email FROM ai_flower_execution_authority WHERE request_key = ?`, requestID).Scan(
		&endpointID, &namespacePublicID, &channelID, &userPublicID, &userEmail,
	); err != nil {
		t.Fatalf("load pending migration authority %q: %v", requestID, err)
	}
	if endpointID != want.EndpointID || namespacePublicID != want.NamespacePublicID || channelID != want.ChannelID || userPublicID != want.UserPublicID || userEmail != want.UserEmail {
		t.Fatalf("pending migration authority %q=(%q, %q, %q, %q, %q), want (%q, %q, %q, %q, %q)",
			requestID, endpointID, namespacePublicID, channelID, userPublicID, userEmail,
			want.EndpointID, want.NamespacePublicID, want.ChannelID, want.UserPublicID, want.UserEmail,
		)
	}
}

type interruptedPendingImport struct{ flruntime.ThreadService }

func (service interruptedPendingImport) ImportPendingInputs(ctx context.Context, input flruntime.ImportPendingInputsInput) (flruntime.ImportResult, error) {
	result, err := service.ThreadService.ImportPendingInputs(ctx, input)
	if err != nil {
		return result, err
	}
	return result, errors.New("simulated exit after canonical commit")
}

func TestPendingInputMigrationContinuesAfterCanonicalCommitWithoutProductCommit(t *testing.T) {
	state := t.TempDir()
	opts := fixtureMaintenanceOptions(t, state)
	opts.Config = &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Type: "openai", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}}
	service, err := NewServiceContext(t.Context(), opts)
	if err != nil {
		t.Fatal(err)
	}
	meta := session.Meta{EndpointID: "env_partial", NamespacePublicID: "ns_partial", ChannelID: "ch_partial", UserPublicID: "user_partial", CanRead: true, CanWrite: true, CanExecute: true}
	thread, err := service.CreateThread(t.Context(), &meta, "partial import", "openai/gpt-5-mini", "approval_required", "")
	if err != nil {
		t.Fatal(err)
	}
	if err = service.Close(); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(state, "ai", "threads.sqlite")
	replaceCurrentThreadstoreWithV4ForTest(t, path)
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	insertPendingMigrationThreadForTest(t, db, meta, thread.ThreadID)
	raw, _ := json.Marshal(meta)
	insertPendingMigrationRecordForTest(t, db, "request_partial", meta.EndpointID, thread.ThreadID, "preserve exactly", string(raw), 1)
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	runtime, err := openFloretRuntime(t.Context(), filepath.Join(state, "ai", "floret_threads.sqlite"), nil, opts.Logger)
	if err != nil {
		t.Fatal(err)
	}
	partial, err := threadstore.OpenWithPendingInputMigration(t.Context(), path, newPendingInputMigrationHandler(interruptedPendingImport{runtime.threadRuntime}, runtime.effects))
	if err == nil {
		partial.Close()
		t.Fatal("expected interrupted product transaction")
	}
	view, err := runtime.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
	if err != nil || len(view.Queue) != 1 || view.Activity != flruntime.ThreadActivityIdle {
		t.Fatalf("partial canonical commit: %+v %v", view, err)
	}
	before, _ := json.Marshal(view.Queue[0])
	if err = runtime.close(); err != nil {
		t.Fatal(err)
	}
	// A new generation imports the exact same historical record again.
	resumed, err := NewServiceContext(t.Context(), opts)
	if err != nil {
		t.Fatal(err)
	}
	defer resumed.Close()
	view, err = resumed.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
	if err != nil || len(view.Queue) != 1 || view.Activity != flruntime.ThreadActivityIdle {
		t.Fatalf("duplicate or executing retry: %+v %v", view, err)
	}
	after, _ := json.Marshal(view.Queue[0])
	if !bytes.Equal(before, after) {
		t.Fatalf("canonical import changed on retry:\n%s\n%s", before, after)
	}
	authority, err := resumed.threadsDB.GetExecutionAuthority(t.Context(), "request_partial")
	if err != nil || authority == nil || authority.UserPublicID != meta.UserPublicID {
		t.Fatalf("authority=%+v %v", authority, err)
	}
}
