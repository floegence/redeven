package threadstore

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

func deleteThreadContextPlanesTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string) error {
	queries := []string{
		`DELETE FROM conversation_turns WHERE endpoint_id = ? AND thread_id = ?`,
		`DELETE FROM transcript_messages WHERE endpoint_id = ? AND thread_id = ?`,
		`DELETE FROM structured_user_inputs WHERE endpoint_id = ? AND thread_id = ?`,
		`DELETE FROM request_user_input_secret_answers WHERE endpoint_id = ? AND thread_id = ?`,
		`DELETE FROM memory_items WHERE endpoint_id = ? AND thread_id = ?`,
		`DELETE FROM context_snapshots WHERE endpoint_id = ? AND thread_id = ?`,
		`DELETE FROM execution_spans WHERE endpoint_id = ? AND thread_id = ?`,
	}
	for _, q := range queries {
		if _, err := tx.ExecContext(ctx, q, endpointID, threadID); err != nil {
			return fmt.Errorf("delete thread context plane rows failed: %w", err)
		}
	}
	return nil
}

func deleteThreadRunArtifactsTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string) error {
	queries := []struct {
		name string
		sql  string
	}{
		{
			name: "ai_run_events",
			sql:  `DELETE FROM ai_run_events WHERE endpoint_id = ? AND thread_id = ?`,
		},
		{
			name: "ai_tool_calls",
			sql: `
DELETE FROM ai_tool_calls
WHERE id IN (
  SELECT tc.id
  FROM ai_tool_calls tc
  JOIN ai_runs r ON r.run_id = tc.run_id
  WHERE r.endpoint_id = ? AND r.thread_id = ?
)`,
		},
		{
			name: "ai_thread_checkpoints",
			sql:  `DELETE FROM ai_thread_checkpoints WHERE endpoint_id = ? AND thread_id = ?`,
		},
		{
			name: "ai_runs",
			sql:  `DELETE FROM ai_runs WHERE endpoint_id = ? AND thread_id = ?`,
		},
	}
	for _, step := range queries {
		if _, err := tx.ExecContext(ctx, step.sql, endpointID, threadID); err != nil {
			return fmt.Errorf("delete thread %s rows failed: %w", step.name, err)
		}
	}
	return nil
}

// deleteThreadScopedRowsTx owns all per-thread persistence cleanup. Global caches such as
// provider_capabilities are intentionally excluded.
func deleteThreadScopedRowsTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string) error {
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return fmt.Errorf("invalid thread scope")
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM ai_messages WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID); err != nil {
		return fmt.Errorf("delete thread ai_messages rows failed: %w", err)
	}
	if err := deleteThreadContextPlanesTx(ctx, tx, endpointID, threadID); err != nil {
		return err
	}
	if err := deleteThreadRunArtifactsTx(ctx, tx, endpointID, threadID); err != nil {
		return err
	}
	for _, q := range []string{
		`DELETE FROM ai_thread_state WHERE endpoint_id = ? AND thread_id = ?`,
		`DELETE FROM ai_thread_todos WHERE endpoint_id = ? AND thread_id = ?`,
		`DELETE FROM ai_queued_turns WHERE endpoint_id = ? AND thread_id = ?`,
	} {
		if _, err := tx.ExecContext(ctx, q, endpointID, threadID); err != nil {
			return fmt.Errorf("delete thread state rows failed: %w", err)
		}
	}
	return nil
}
