package threadstore

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestForkOperationUsesFixedSnapshotAndReplaysAfterReopen(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{
		ThreadID:        "thread_source",
		EndpointID:      "env_1",
		Title:           "Source",
		RunStatus:       "success",
		CreatedAtUnixMs: 100,
		UpdatedAtUnixMs: 100,
	}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if _, err := s.AppendMessage(ctx, "env_1", "thread_source", Message{
		MessageID:       "message_before_prepare",
		Role:            "user",
		Status:          "complete",
		CreatedAtUnixMs: 110,
		UpdatedAtUnixMs: 110,
		TextContent:     "before prepare",
		MessageJSON:     `{"id":"message_before_prepare","role":"user","blocks":[{"type":"text","content":"before prepare"}]}`,
	}, "user_1", "user@example.com"); err != nil {
		t.Fatalf("AppendMessage before prepare: %v", err)
	}
	req := ForkThreadRequest{
		OperationID:           "fork_operation_fixed_snapshot",
		EndpointID:            "env_1",
		SourceThreadID:        "thread_source",
		DestinationThreadID:   "thread_destination",
		Title:                 "Forked",
		CreatedByUserPublicID: "user_2",
		CreatedByUserEmail:    "user2@example.com",
		CreatedAtUnixMs:       200,
	}
	prepared, err := s.PrepareForkOperation(ctx, req)
	if err != nil {
		t.Fatalf("PrepareForkOperation: %v", err)
	}
	if prepared.Status != ForkOperationPending || prepared.SnapshotSchemaVersion != ForkSnapshotSchemaVersion || prepared.SnapshotJSON == "" {
		t.Fatalf("prepared operation=%+v", prepared)
	}
	if _, err := s.AppendMessage(ctx, "env_1", "thread_source", Message{
		MessageID:       "message_after_prepare",
		Role:            "user",
		Status:          "complete",
		CreatedAtUnixMs: 210,
		UpdatedAtUnixMs: 210,
		TextContent:     "after prepare",
		MessageJSON:     `{"id":"message_after_prepare","role":"user","blocks":[{"type":"text","content":"after prepare"}]}`,
	}, "user_1", "user@example.com"); err != nil {
		t.Fatalf("AppendMessage after prepare: %v", err)
	}

	forked, err := s.CommitForkOperation(ctx, CommitForkOperationRequest{
		OperationID:      req.OperationID,
		FloretResultJSON: `{"operation_id":"fork_operation_fixed_snapshot","thread":{"id":"thread_destination"}}`,
		UpdatedAtUnixMs:  300,
	})
	if err != nil {
		t.Fatalf("CommitForkOperation: %v", err)
	}
	if forked.ThreadID != req.DestinationThreadID {
		t.Fatalf("forked thread=%+v", forked)
	}
	messages, _, _, err := s.ListMessages(ctx, req.EndpointID, req.DestinationThreadID, 10, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if len(messages) != 1 || messages[0].TextContent != "before prepare" {
		t.Fatalf("destination messages=%+v, want fixed pre-prepare snapshot", messages)
	}
	committed, err := s.GetForkOperation(ctx, req.OperationID)
	if err != nil {
		t.Fatalf("GetForkOperation: %v", err)
	}
	if committed.Status != ForkOperationCommitted || committed.SnapshotJSON != "" || committed.FloretResultJSON == "" {
		t.Fatalf("committed operation=%+v", committed)
	}
	if err := s.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	reopened, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open after commit: %v", err)
	}
	defer func() { _ = reopened.Close() }()
	replayed, err := reopened.CommitForkOperation(ctx, CommitForkOperationRequest{
		OperationID:      req.OperationID,
		FloretResultJSON: committed.FloretResultJSON,
		UpdatedAtUnixMs:  400,
	})
	if err != nil {
		t.Fatalf("CommitForkOperation replay: %v", err)
	}
	if replayed.ThreadID != forked.ThreadID || replayed.CreatedAtUnixMs != forked.CreatedAtUnixMs || replayed.Title != forked.Title {
		t.Fatalf("replayed=%+v, want %+v", replayed, forked)
	}
}

func TestForkOperationRejectsRequestAndDestinationConflicts(t *testing.T) {
	t.Parallel()

	s, err := Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()
	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "source", EndpointID: "env", Title: "Source", RunStatus: "idle", CreatedAtUnixMs: 1, UpdatedAtUnixMs: 1}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	req := ForkThreadRequest{
		OperationID:         "operation",
		EndpointID:          "env",
		SourceThreadID:      "source",
		DestinationThreadID: "destination",
		Title:               "Fork",
		CreatedAtUnixMs:     2,
	}
	first, err := s.PrepareForkOperation(ctx, req)
	if err != nil {
		t.Fatalf("PrepareForkOperation: %v", err)
	}
	replay, err := s.PrepareForkOperation(ctx, req)
	if err != nil {
		t.Fatalf("PrepareForkOperation replay: %v", err)
	}
	if replay.RequestFingerprint != first.RequestFingerprint || replay.SnapshotJSON != first.SnapshotJSON {
		t.Fatalf("replay=%+v, want same prepared result %+v", replay, first)
	}
	conflict := req
	conflict.Title = "Different"
	if _, err := s.PrepareForkOperation(ctx, conflict); !errors.Is(err, ErrForkOperationConflict) {
		t.Fatalf("request conflict error=%v", err)
	}
	destinationConflict := req
	destinationConflict.OperationID = "other_operation"
	if _, err := s.PrepareForkOperation(ctx, destinationConflict); !errors.Is(err, ErrForkDestinationConflict) {
		t.Fatalf("destination conflict error=%v", err)
	}
}

func TestForkOperationRejectsIncompleteFloretIdentityMapping(t *testing.T) {
	t.Parallel()

	s, err := Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()
	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "source", EndpointID: "env", Title: "Source", RunStatus: "idle", CreatedAtUnixMs: 1, UpdatedAtUnixMs: 1}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if _, err := s.AppendMessage(ctx, "env", "source", Message{
		MessageID:       "user_message",
		Role:            "user",
		Status:          "complete",
		CreatedAtUnixMs: 2,
		UpdatedAtUnixMs: 2,
		TextContent:     "fork this",
		MessageJSON:     `{"id":"user_message","role":"user","blocks":[{"type":"text","content":"fork this"}]}`,
	}, "", ""); err != nil {
		t.Fatalf("AppendMessage: %v", err)
	}
	if _, err := s.AppendConversationTurn(ctx, ConversationTurn{
		TurnID:             "source_turn",
		EndpointID:         "env",
		ThreadID:           "source",
		RunID:              "source_run",
		UserMessageID:      "user_message",
		AssistantMessageID: "source_turn",
		CreatedAtUnixMs:    3,
	}); err != nil {
		t.Fatalf("AppendConversationTurn: %v", err)
	}
	req := ForkThreadRequest{
		OperationID:         "strict_mapping_operation",
		EndpointID:          "env",
		SourceThreadID:      "source",
		DestinationThreadID: "destination",
		Title:               "Fork",
		CreatedAtUnixMs:     4,
	}
	if _, err := s.PrepareForkOperation(ctx, req); err != nil {
		t.Fatalf("PrepareForkOperation: %v", err)
	}
	_, err = s.CommitForkOperation(ctx, CommitForkOperationRequest{
		OperationID:      req.OperationID,
		FloretResultJSON: `{"operation_id":"strict_mapping_operation","thread":{"id":"destination"}}`,
		UpdatedAtUnixMs:  5,
	})
	if !errors.Is(err, ErrForkResultConflict) {
		t.Fatalf("CommitForkOperation missing mapping error=%v", err)
	}
	operation, err := s.GetForkOperation(ctx, req.OperationID)
	if err != nil {
		t.Fatalf("GetForkOperation: %v", err)
	}
	if operation.Status != ForkOperationPending || operation.SnapshotJSON == "" {
		t.Fatalf("operation=%+v, want pending operation with fixed snapshot", operation)
	}
	if destination, err := s.GetThread(ctx, req.EndpointID, req.DestinationThreadID); err != nil || destination != nil {
		t.Fatalf("destination=%+v err=%v, want no partial materialization", destination, err)
	}
	if _, err := s.CommitForkOperation(ctx, CommitForkOperationRequest{
		OperationID: req.OperationID,
		FloretTurnRefs: []ForkTurnRef{{
			SourceTurnID:      "source_turn",
			SourceRunID:       "source_run",
			DestinationTurnID: "destination_turn",
			DestinationRunID:  "destination_run",
		}, {
			SourceTurnID:      "floret_only_turn",
			SourceRunID:       "floret_only_run",
			DestinationTurnID: "floret_only_destination_turn",
			DestinationRunID:  "floret_only_destination_run",
		}},
		FloretResultJSON: `{"operation_id":"strict_mapping_operation","thread":{"id":"destination"}}`,
		UpdatedAtUnixMs:  6,
	}); err != nil {
		t.Fatalf("CommitForkOperation exact mapping: %v", err)
	}
}

func TestStoreMigratesV37ToV38ForkOperations(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	schema := threadstoreSchemaSpec()
	tx, err := raw.Begin()
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	for _, migration := range schema.Migrations {
		if migration.ToVersion > 37 {
			break
		}
		if err := migration.Apply(tx); err != nil {
			_ = tx.Rollback()
			t.Fatalf("apply migration %d->%d: %v", migration.FromVersion, migration.ToVersion, err)
		}
	}
	if _, err := tx.Exec(`PRAGMA user_version=37;`); err != nil {
		_ = tx.Rollback()
		t.Fatalf("set user_version: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	if err := raw.Close(); err != nil {
		t.Fatalf("Close raw: %v", err)
	}

	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open migrated: %v", err)
	}
	defer func() { _ = s.Close() }()
	if !tableExistsForTest(t, s.db, "ai_thread_fork_operations") {
		t.Fatalf("missing ai_thread_fork_operations")
	}
	for _, index := range []string{"idx_ai_thread_fork_operations_status_updated", "idx_ai_thread_fork_operations_source"} {
		if !indexExistsForTest(t, s.db, index) {
			t.Fatalf("missing index %q", index)
		}
	}
	var version int
	if err := s.db.QueryRow(`PRAGMA user_version;`).Scan(&version); err != nil {
		t.Fatalf("read user_version: %v", err)
	}
	if version != 38 {
		t.Fatalf("user_version=%d, want 38", version)
	}
}
