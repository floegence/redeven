package threadstore

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// deleteThreadScopedRowsTx removes only Redeven-owned product resources. Floret
// owns conversation, run, approval, projection, and todo lifecycle cleanup.
func deleteThreadScopedRowsTx(ctx context.Context, tx *sql.Tx, endpointID string, threadID string) error {
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return fmt.Errorf("invalid thread scope")
	}
	steps := []struct {
		query string
		args  []any
	}{
		{`DELETE FROM ai_upload_staging_scopes WHERE endpoint_id = ? AND target_id = ?`, []any{endpointID, threadID}},
		{`DELETE FROM ai_pending_input_imports WHERE endpoint_id = ? AND thread_id = ?`, []any{endpointID, threadID}},
		{`DELETE FROM ai_flower_thread_routing WHERE endpoint_id = ? AND thread_id = ?`, []any{endpointID, threadID}},
		{`DELETE FROM ai_flower_execution_authority WHERE endpoint_id = ? AND thread_id = ?`, []any{endpointID, threadID}},
	}
	for _, step := range steps {
		if _, err := tx.ExecContext(ctx, step.query, step.args...); err != nil {
			return fmt.Errorf("delete thread product rows: %w", err)
		}
	}
	return nil
}
