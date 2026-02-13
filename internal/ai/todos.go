package ai

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

const (
	TodoStatusPending    = "pending"
	TodoStatusInProgress = "in_progress"
	TodoStatusCompleted  = "completed"
	TodoStatusCancelled  = "cancelled"

	maxTodosPerWrite = 40
)

type TodoItem struct {
	ID      string `json:"id"`
	Content string `json:"content"`
	Status  string `json:"status"`
	Note    string `json:"note,omitempty"`
}

type TodoSummary struct {
	Total      int `json:"total"`
	Pending    int `json:"pending"`
	InProgress int `json:"in_progress"`
	Completed  int `json:"completed"`
	Cancelled  int `json:"cancelled"`
}

type ThreadTodosView struct {
	Version         int64      `json:"version"`
	UpdatedAtUnixMs int64      `json:"updated_at_unix_ms"`
	Todos           []TodoItem `json:"todos"`
}

func normalizeTodoStatus(raw string) (string, bool) {
	status := strings.ToLower(strings.TrimSpace(raw))
	switch status {
	case TodoStatusPending, TodoStatusInProgress, TodoStatusCompleted, TodoStatusCancelled:
		return status, true
	default:
		return "", false
	}
}

func normalizeTodoItems(items []TodoItem) ([]TodoItem, error) {
	if len(items) > maxTodosPerWrite {
		return nil, fmt.Errorf("too many todos (max %d)", maxTodosPerWrite)
	}
	out := make([]TodoItem, 0, len(items))
	seenID := make(map[string]struct{}, len(items))
	inProgressCount := 0
	for i, item := range items {
		content := strings.TrimSpace(item.Content)
		if content == "" {
			return nil, fmt.Errorf("todo[%d]: missing content", i)
		}
		status, ok := normalizeTodoStatus(item.Status)
		if !ok {
			return nil, fmt.Errorf("todo[%d]: invalid status %q", i, strings.TrimSpace(item.Status))
		}
		id := strings.TrimSpace(item.ID)
		if id == "" {
			id = fmt.Sprintf("todo_%d", i+1)
		}
		if _, exists := seenID[id]; exists {
			return nil, fmt.Errorf("duplicate todo id %q", id)
		}
		seenID[id] = struct{}{}
		note := strings.TrimSpace(item.Note)
		if status == TodoStatusInProgress {
			inProgressCount++
			if inProgressCount > 1 {
				return nil, errors.New("only one todo can be in_progress")
			}
		}
		out = append(out, TodoItem{
			ID:      id,
			Content: content,
			Status:  status,
			Note:    note,
		})
	}
	return out, nil
}

func decodeTodoItemsJSON(raw string) ([]TodoItem, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		raw = "[]"
	}
	var items []TodoItem
	if err := json.Unmarshal([]byte(raw), &items); err != nil {
		return nil, err
	}
	return normalizeTodoItems(items)
}

func encodeTodoItemsJSON(items []TodoItem) (string, error) {
	b, err := json.Marshal(items)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func summarizeTodos(items []TodoItem) TodoSummary {
	out := TodoSummary{Total: len(items)}
	for _, item := range items {
		switch strings.ToLower(strings.TrimSpace(item.Status)) {
		case TodoStatusPending:
			out.Pending++
		case TodoStatusInProgress:
			out.InProgress++
		case TodoStatusCompleted:
			out.Completed++
		case TodoStatusCancelled:
			out.Cancelled++
		}
	}
	return out
}
