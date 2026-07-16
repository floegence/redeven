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

func deleteThreadPermissionArtifactsTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string) error {
	steps := []struct {
		name string
		sql  string
		args []any
	}{
		{
			name: "ai_delegated_approval_idempotency",
			sql:  `DELETE FROM ai_delegated_approval_idempotency WHERE endpoint_id = ? AND parent_thread_id = ?`,
			args: []any{endpointID, threadID},
		},
		{
			name: "ai_delegated_approval_outbox",
			sql:  `DELETE FROM ai_delegated_approval_outbox WHERE endpoint_id = ? AND parent_thread_id = ?`,
			args: []any{endpointID, threadID},
		},
		{
			name: "ai_delegated_approval_events",
			sql:  `DELETE FROM ai_delegated_approval_events WHERE endpoint_id = ? AND parent_thread_id = ?`,
			args: []any{endpointID, threadID},
		},
		{
			name: "ai_delegated_approval_requests",
			sql:  `DELETE FROM ai_delegated_approval_requests WHERE endpoint_id = ? AND parent_thread_id = ?`,
			args: []any{endpointID, threadID},
		},
		{
			name: "ai_child_permission_snapshots",
			sql:  `DELETE FROM ai_child_permission_snapshots WHERE endpoint_id = ? AND (parent_thread_id = ? OR child_thread_id = ?)`,
			args: []any{endpointID, threadID, threadID},
		},
		{
			name: "ai_permission_snapshots",
			sql:  `DELETE FROM ai_permission_snapshots WHERE endpoint_id = ? AND owner_thread_id = ?`,
			args: []any{endpointID, threadID},
		},
	}
	for _, step := range steps {
		if _, err := tx.ExecContext(ctx, step.sql, step.args...); err != nil {
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
	if err := deleteThreadPermissionArtifactsTx(ctx, tx, endpointID, threadID); err != nil {
		return err
	}
	for _, q := range []string{
		`DELETE FROM ai_thread_state WHERE endpoint_id = ? AND thread_id = ?`,
		`DELETE FROM ai_thread_todos WHERE endpoint_id = ? AND thread_id = ?`,
		`DELETE FROM ai_queued_turns WHERE endpoint_id = ? AND thread_id = ?`,
		`DELETE FROM ai_flower_thread_metadata WHERE endpoint_id = ? AND thread_id = ?`,
		`DELETE FROM ai_flower_transfers WHERE endpoint_id = ? AND (source_thread_id = ? OR destination_thread_id = ?)`,
		`DELETE FROM ai_flower_handoffs WHERE endpoint_id = ? AND (source_thread_id = ? OR destination_thread_id = ?)`,
	} {
		args := []any{endpointID, threadID}
		if strings.Contains(q, " OR destination_thread_id") {
			args = []any{endpointID, threadID, threadID}
		}
		if _, err := tx.ExecContext(ctx, q, args...); err != nil {
			return fmt.Errorf("delete thread state rows failed: %w", err)
		}
	}
	return nil
}
