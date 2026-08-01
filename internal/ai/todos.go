package ai

import (
	"fmt"
	"strings"

	flruntime "github.com/floegence/floret/v3/runtime"
)

const (
	TodoStatusPending    = string(flruntime.AgentTodoPending)
	TodoStatusInProgress = string(flruntime.AgentTodoInProgress)
	TodoStatusCompleted  = string(flruntime.AgentTodoCompleted)
)

var controlSignalTodoNames = []string{"task_complete", "ask_user"}

type TodoItem struct {
	ID      string `json:"id"`
	Content string `json:"content"`
	Status  string `json:"status"`
}

type TodoSummary struct {
	Total      int `json:"total"`
	Pending    int `json:"pending"`
	InProgress int `json:"in_progress"`
	Completed  int `json:"completed"`
}

type ThreadTodosView struct {
	Version         int64      `json:"version"`
	UpdatedAtUnixMs int64      `json:"updated_at_unix_ms"`
	Todos           []TodoItem `json:"todos"`
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
		}
	}
	return out
}

func actionableTodoSummary(items []TodoItem) TodoSummary {
	out := TodoSummary{}
	for _, item := range items {
		if todoControlSignalName(item.Content) != "" {
			continue
		}
		out.Total++
		switch strings.ToLower(strings.TrimSpace(item.Status)) {
		case TodoStatusPending:
			out.Pending++
		case TodoStatusInProgress:
			out.InProgress++
		case TodoStatusCompleted:
			out.Completed++
		}
	}
	return out
}

func validateActionableTodoItems(items []TodoItem) error {
	for i, item := range items {
		signal := todoControlSignalName(item.Content)
		if signal == "" {
			continue
		}
		return fmt.Errorf("todo[%d]: %s is a control signal, not actionable work; remove this todo and call %s directly after actionable todos are complete", i, signal, signal)
	}
	return nil
}

func todoControlSignalName(content string) string {
	content = strings.ToLower(strings.TrimSpace(content))
	if content == "" {
		return ""
	}
	content = strings.NewReplacer("`", "", "\"", "", "'", "", "：", ":", "，", ",", "。", ".").Replace(content)
	for _, signal := range controlSignalTodoNames {
		if !strings.Contains(content, signal) {
			continue
		}
		if content == signal || strings.HasPrefix(content, signal+" ") || strings.HasPrefix(content, signal+":") {
			return signal
		}
		for _, prefix := range []string{
			"call ", "use ", "run ", "invoke ", "emit ",
			"finish with ", "complete with ",
			"调用", "使用", "执行", "用",
			"调用 ", "使用 ", "执行 ", "用 ",
		} {
			if strings.HasPrefix(content, prefix+signal) {
				return signal
			}
		}
	}
	return ""
}
