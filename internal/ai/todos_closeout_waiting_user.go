package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/ai/threadstore"
)

const waitingUserCloseoutNotePrefix = "blocked_waiting_user:"

type waitingUserTodoCloseout struct {
	Updated         bool
	VersionBefore   int64
	VersionAfter    int64
	OpenBefore      int
	OpenAfter       int
	TotalBefore     int
	TotalAfter      int
	ConflictRetries int
}

func waitingUserCloseoutNote(question string, source string) string {
	question = strings.TrimSpace(question)
	source = strings.TrimSpace(source)
	if question == "" {
		question = "I need clarification to continue safely."
	}
	if source == "" {
		source = "unknown"
	}
	question = strings.ReplaceAll(question, "\n", " ")
	question = strings.ReplaceAll(question, "\r", " ")
	question = strings.TrimSpace(question)
	question = truncateRunes(question, 240)
	return fmt.Sprintf("%s source=%s; ask: %s", waitingUserCloseoutNotePrefix, source, question)
}

func (r *run) closeOpenTodosBeforeWaitingUser(ctx context.Context, step int, question string, source string) (waitingUserTodoCloseout, error) {
	out := waitingUserTodoCloseout{}
	if r == nil || r.threadsDB == nil {
		return out, nil
	}
	endpointID := strings.TrimSpace(r.endpointID)
	threadID := strings.TrimSpace(r.threadID)
	if endpointID == "" || threadID == "" {
		return out, nil
	}
	if ctx == nil {
		ctx = context.Background()
	}

	// Keep waiting-user closeout fast and bounded to avoid blocking termination.
	closeCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	note := waitingUserCloseoutNote(question, source)
	const maxRetries = 3
	for attempt := 0; attempt < maxRetries; attempt++ {
		snapshot, err := r.threadsDB.GetThreadTodosSnapshot(closeCtx, endpointID, threadID)
		if err != nil {
			return out, err
		}

		todos, err := decodeTodoItemsJSON(snapshot.TodosJSON)
		if err != nil {
			// If the snapshot is corrupted, clear it deterministically so waiting_user never ships with open todos.
			expected := snapshot.Version
			out.VersionBefore = snapshot.Version
			out.OpenBefore = -1
			out.TotalBefore = -1
			out.ConflictRetries = attempt
			result, writeErr := r.toolWriteTodos(closeCtx, "system_waiting_user_closeout", nil, &expected, "clear invalid todo snapshot before waiting_user")
			if writeErr != nil {
				if errors.Is(writeErr, threadstore.ErrThreadTodosVersionConflict) {
					continue
				}
				return out, writeErr
			}
			versionAfter := int64(0)
			if m, ok := result.(map[string]any); ok {
				versionAfter = int64(readAnyInt(m["version"]))
			}
			out.Updated = true
			out.VersionAfter = versionAfter
			out.OpenAfter = 0
			r.persistRunEvent("todos.closeout.waiting_user", RealtimeStreamKindLifecycle, map[string]any{
				"step_index":      step,
				"source":          strings.TrimSpace(source),
				"updated":         true,
				"cleared_invalid": true,
				"version_before":  snapshot.Version,
				"version_after":   versionAfter,
				"open_before":     -1,
				"open_after":      0,
			})
			return out, nil
		}

		beforeSummary := summarizeTodos(todos)
		openBefore := beforeSummary.Pending + beforeSummary.InProgress

		out.VersionBefore = snapshot.Version
		out.TotalBefore = beforeSummary.Total
		out.OpenBefore = openBefore
		if openBefore <= 0 {
			return out, nil
		}

		updated := false
		mustKeep := make([]TodoItem, 0, len(todos))
		closed := make([]TodoItem, 0, len(todos))
		for _, item := range todos {
			status := strings.ToLower(strings.TrimSpace(item.Status))
			switch status {
			case TodoStatusPending, TodoStatusInProgress:
				updated = true
				item.Status = TodoStatusCancelled
				if strings.TrimSpace(item.Note) == "" {
					item.Note = note
				}
				mustKeep = append(mustKeep, item)
			default:
				closed = append(closed, item)
			}
		}
		if !updated {
			return out, nil
		}

		// Keep all closeout items, then backfill with recent closed items to satisfy maxTodosPerWrite.
		keep := make([]TodoItem, 0, maxTodosPerWrite)
		keep = append(keep, mustKeep...)
		if len(keep) < maxTodosPerWrite && len(closed) > 0 {
			remaining := maxTodosPerWrite - len(keep)
			if remaining > len(closed) {
				remaining = len(closed)
			}
			keep = append(keep, closed[len(closed)-remaining:]...)
		}

		expected := snapshot.Version
		result, err := r.toolWriteTodos(closeCtx, "system_waiting_user_closeout", keep, &expected, "close open todos before waiting_user")
		if err != nil {
			if errors.Is(err, threadstore.ErrThreadTodosVersionConflict) {
				out.ConflictRetries = attempt + 1
				continue
			}
			return out, err
		}

		versionAfter := int64(0)
		after := keep
		if normalized, ok := result.(map[string]any); ok {
			versionAfter = int64(readAnyInt(normalized["version"]))
			if items, ok := normalized["todos"].([]TodoItem); ok && len(items) > 0 {
				after = items
			}
		}
		afterSummary := summarizeTodos(after)
		out.Updated = true
		out.VersionAfter = versionAfter
		out.TotalAfter = afterSummary.Total
		out.OpenAfter = afterSummary.Pending + afterSummary.InProgress
		r.persistRunEvent("todos.closeout.waiting_user", RealtimeStreamKindLifecycle, map[string]any{
			"step_index":       step,
			"source":           strings.TrimSpace(source),
			"updated":          true,
			"version_before":   snapshot.Version,
			"version_after":    versionAfter,
			"open_before":      openBefore,
			"open_after":       out.OpenAfter,
			"total_before":     beforeSummary.Total,
			"total_after":      afterSummary.Total,
			"note_prefix":      waitingUserCloseoutNotePrefix,
			"conflict_retries": out.ConflictRetries,
		})
		return out, nil
	}

	return out, fmt.Errorf("todo closeout failed after %d retries: %w", maxRetries, threadstore.ErrThreadTodosVersionConflict)
}
