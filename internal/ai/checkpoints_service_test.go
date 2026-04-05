package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

func TestServiceCreatePreRunThreadCheckpoint_PrunesLegacyArtifacts(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := testRWXMeta()

	th, err := svc.CreateThread(ctx, meta, "checkpoint prune", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	legacyCheckpointID := "cp_0000"
	for i := 0; i < threadCheckpointRetentionCount; i++ {
		runID := "run_seed_" + leftPadInt(i, 4)
		checkpointID := "cp_" + leftPadInt(i, 4)
		if _, err := svc.threadsDB.CreateThreadCheckpoint(ctx, meta.EndpointID, th.ThreadID, checkpointID, runID, threadstore.CheckpointKindPreRun); err != nil {
			t.Fatalf("CreateThreadCheckpoint %q: %v", checkpointID, err)
		}
	}

	artifactDir := checkpointArtifactsDir(svc.stateDir, legacyCheckpointID)
	if err := os.MkdirAll(artifactDir, 0o700); err != nil {
		t.Fatalf("MkdirAll artifactDir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(artifactDir, "snapshot.tar.gz"), []byte("legacy"), 0o600); err != nil {
		t.Fatalf("WriteFile snapshot.tar.gz: %v", err)
	}

	if err := svc.createPreRunThreadCheckpoint(ctx, meta.EndpointID, th.ThreadID, "run_new"); err != nil {
		t.Fatalf("createPreRunThreadCheckpoint: %v", err)
	}

	checkpointIDs, err := svc.threadsDB.ListThreadCheckpointIDs(ctx, meta.EndpointID, th.ThreadID)
	if err != nil {
		t.Fatalf("ListThreadCheckpointIDs: %v", err)
	}
	if len(checkpointIDs) != threadCheckpointRetentionCount {
		t.Fatalf("checkpoint count=%d, want %d", len(checkpointIDs), threadCheckpointRetentionCount)
	}
	for _, checkpointID := range checkpointIDs {
		if checkpointID == legacyCheckpointID {
			t.Fatalf("legacy checkpoint %q should have been pruned", legacyCheckpointID)
		}
	}
	if _, err := os.Stat(artifactDir); !os.IsNotExist(err) {
		t.Fatalf("artifactDir stat err=%v, want not exist", err)
	}
}

func TestNewService_SweepsOrphanLegacyWorkspaceCheckpointArtifacts(t *testing.T) {
	t.Parallel()

	stateDir := t.TempDir()
	orphanDir := checkpointArtifactsDir(stateDir, "cp_orphan")
	if err := os.MkdirAll(orphanDir, 0o700); err != nil {
		t.Fatalf("MkdirAll orphanDir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(orphanDir, "snapshot.tar.gz"), []byte("legacy"), 0o600); err != nil {
		t.Fatalf("WriteFile snapshot.tar.gz: %v", err)
	}

	svc, err := NewService(Options{
		Logger:           slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		StateDir:         stateDir,
		AgentHomeDir:     t.TempDir(),
		Shell:            "/bin/bash",
		PersistOpTimeout: 2 * time.Second,
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(orphanDir); os.IsNotExist(err) {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	if _, err := os.Stat(orphanDir); !os.IsNotExist(err) {
		t.Fatalf("orphanDir stat err=%v, want not exist", err)
	}
}

func TestServiceRewindThreadCheckpoint_AllowsEmptyWorkspaceJSON(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := testRWXMeta()

	th, err := svc.CreateThread(ctx, meta, "rewind state only", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	appendThreadMessage(t, svc.threadsDB, meta.EndpointID, th.ThreadID, threadstore.Message{
		ThreadID:           th.ThreadID,
		EndpointID:         meta.EndpointID,
		MessageID:          "m_user_1",
		Role:               "user",
		AuthorUserPublicID: meta.UserPublicID,
		AuthorUserEmail:    meta.UserEmail,
		Status:             "complete",
		CreatedAtUnixMs:    1,
		UpdatedAtUnixMs:    1,
		TextContent:        "before rewind",
		MessageJSON:        `{"id":"m_user_1","role":"user","blocks":[{"type":"text","text":"before rewind"}]}`,
	}, meta.UserPublicID, meta.UserEmail)

	const checkpointID = "cp_state_only"
	if _, err := svc.threadsDB.CreateThreadCheckpoint(ctx, meta.EndpointID, th.ThreadID, checkpointID, "run_state_only", threadstore.CheckpointKindPreRun); err != nil {
		t.Fatalf("CreateThreadCheckpoint: %v", err)
	}

	appendThreadMessage(t, svc.threadsDB, meta.EndpointID, th.ThreadID, threadstore.Message{
		ThreadID:        th.ThreadID,
		EndpointID:      meta.EndpointID,
		MessageID:       "m_assistant_2",
		Role:            "assistant",
		Status:          "complete",
		CreatedAtUnixMs: 2,
		UpdatedAtUnixMs: 2,
		TextContent:     "after checkpoint",
		MessageJSON:     `{"id":"m_assistant_2","role":"assistant","blocks":[{"type":"text","text":"after checkpoint"}]}`,
	}, "", "")

	gotCheckpointID, err := svc.rewindThreadCheckpoint(ctx, meta, meta.EndpointID, th.ThreadID, checkpointID, "rewind")
	if err != nil {
		t.Fatalf("rewindThreadCheckpoint: %v", err)
	}
	if gotCheckpointID != checkpointID {
		t.Fatalf("checkpoint_id=%q, want %q", gotCheckpointID, checkpointID)
	}

	messages, _, hasMore, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 10, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if hasMore {
		t.Fatalf("hasMore=%v, want false", hasMore)
	}
	if len(messages) != 1 {
		t.Fatalf("message count=%d, want 1", len(messages))
	}
	if messages[0].MessageID != "m_user_1" {
		t.Fatalf("message_id=%q, want m_user_1", messages[0].MessageID)
	}
}

func TestServiceRewindThreadCheckpoint_RestoresLegacyWorkspaceCheckpoint(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := testRWXMeta()

	th, err := svc.CreateThread(ctx, meta, "rewind legacy workspace", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	root := t.TempDir()
	filePath := filepath.Join(root, "note.txt")
	if err := os.WriteFile(filePath, []byte("before\n"), 0o600); err != nil {
		t.Fatalf("WriteFile before: %v", err)
	}

	const checkpointID = "cp_legacy_workspace"
	workspaceMeta, err := createTarCheckpoint(ctx, svc.stateDir, checkpointID, root, 1)
	if err != nil {
		t.Fatalf("createTarCheckpoint: %v", err)
	}
	workspaceJSON, err := json.Marshal(workspaceMeta)
	if err != nil {
		t.Fatalf("Marshal workspaceMeta: %v", err)
	}

	appendThreadMessage(t, svc.threadsDB, meta.EndpointID, th.ThreadID, threadstore.Message{
		ThreadID:           th.ThreadID,
		EndpointID:         meta.EndpointID,
		MessageID:          "m_user_1",
		Role:               "user",
		AuthorUserPublicID: meta.UserPublicID,
		AuthorUserEmail:    meta.UserEmail,
		Status:             "complete",
		CreatedAtUnixMs:    1,
		UpdatedAtUnixMs:    1,
		TextContent:        "before checkpoint",
		MessageJSON:        `{"id":"m_user_1","role":"user","blocks":[{"type":"text","text":"before checkpoint"}]}`,
	}, meta.UserPublicID, meta.UserEmail)
	if _, err := svc.threadsDB.CreateThreadCheckpoint(ctx, meta.EndpointID, th.ThreadID, checkpointID, "run_legacy_workspace", threadstore.CheckpointKindPreRun); err != nil {
		t.Fatalf("CreateThreadCheckpoint: %v", err)
	}
	if err := svc.threadsDB.SetThreadCheckpointWorkspaceJSON(ctx, meta.EndpointID, th.ThreadID, checkpointID, string(workspaceJSON)); err != nil {
		t.Fatalf("SetThreadCheckpointWorkspaceJSON: %v", err)
	}

	if err := os.WriteFile(filePath, []byte("after\n"), 0o600); err != nil {
		t.Fatalf("WriteFile after: %v", err)
	}
	appendThreadMessage(t, svc.threadsDB, meta.EndpointID, th.ThreadID, threadstore.Message{
		ThreadID:        th.ThreadID,
		EndpointID:      meta.EndpointID,
		MessageID:       "m_assistant_2",
		Role:            "assistant",
		Status:          "complete",
		CreatedAtUnixMs: 2,
		UpdatedAtUnixMs: 2,
		TextContent:     "after checkpoint",
		MessageJSON:     `{"id":"m_assistant_2","role":"assistant","blocks":[{"type":"text","text":"after checkpoint"}]}`,
	}, "", "")

	if _, err := svc.rewindThreadCheckpoint(ctx, meta, meta.EndpointID, th.ThreadID, checkpointID, "rewind"); err != nil {
		t.Fatalf("rewindThreadCheckpoint: %v", err)
	}

	content, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("ReadFile note.txt: %v", err)
	}
	if string(content) != "before\n" {
		t.Fatalf("note.txt=%q, want before", string(content))
	}
	messages, _, _, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 10, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if len(messages) != 1 || messages[0].MessageID != "m_user_1" {
		t.Fatalf("messages after rewind=%v, want only m_user_1", messages)
	}
}

func testRWXMeta() *session.Meta {
	return &session.Meta{
		ChannelID:         "ch_test",
		EndpointID:        "env_test",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		NamespacePublicID: "ns_test",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
	}
}

func appendThreadMessage(t *testing.T, store *threadstore.Store, endpointID string, threadID string, msg threadstore.Message, actorID string, actorEmail string) {
	t.Helper()
	if _, err := store.AppendMessage(context.Background(), endpointID, threadID, msg, actorID, actorEmail); err != nil {
		t.Fatalf("AppendMessage %q: %v", msg.MessageID, err)
	}
}

func leftPadInt(v int, width int) string {
	if width <= 0 {
		return fmt.Sprintf("%d", v)
	}
	return fmt.Sprintf("%0*d", width, v)
}
