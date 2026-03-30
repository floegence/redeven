package ai

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/floegence/redeven/internal/session"
)

type TerminalToolOutput struct {
	RunID      string `json:"run_id"`
	ToolID     string `json:"tool_id"`
	ToolName   string `json:"tool_name"`
	Status     string `json:"status"`
	Stdout     string `json:"stdout"`
	Stderr     string `json:"stderr"`
	ExitCode   int    `json:"exit_code"`
	DurationMS int64  `json:"duration_ms"`
	TimedOut   bool   `json:"timed_out"`
	Truncated  bool   `json:"truncated"`
	Cwd        string `json:"cwd,omitempty"`
	TimeoutMS  int64  `json:"timeout_ms,omitempty"`
	RawResult  string `json:"raw_result,omitempty"`
}

func (s *Service) GetTerminalToolOutput(ctx context.Context, meta *session.Meta, runID string, toolID string) (*TerminalToolOutput, error) {
	if s == nil {
		return nil, errors.New("service not ready")
	}
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	if ctx == nil {
		ctx = context.Background()
	}

	endpointID := strings.TrimSpace(meta.EndpointID)
	runID = strings.TrimSpace(runID)
	toolID = strings.TrimSpace(toolID)
	if endpointID == "" || runID == "" || toolID == "" {
		return nil, errors.New("invalid request")
	}

	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return nil, errors.New("threads store not ready")
	}

	rec, err := db.GetToolCall(ctx, endpointID, runID, toolID)
	if err != nil {
		return nil, err
	}
	if rec == nil {
		return nil, sql.ErrNoRows
	}
	if strings.TrimSpace(rec.ToolName) != "terminal.exec" {
		return nil, fmt.Errorf("tool %q has no terminal output", strings.TrimSpace(rec.ToolName))
	}

	resultObj, parseErr := parseObjectJSON(rec.ResultJSON)
	argsObj, _ := parseObjectJSON(rec.ArgsJSON)

	out := &TerminalToolOutput{
		RunID:      strings.TrimSpace(rec.RunID),
		ToolID:     strings.TrimSpace(rec.ToolID),
		ToolName:   strings.TrimSpace(rec.ToolName),
		Status:     strings.TrimSpace(rec.Status),
		Stdout:     readStringField(resultObj, "stdout"),
		Stderr:     readStringField(resultObj, "stderr"),
		ExitCode:   readIntField(resultObj, "exit_code", "exitCode"),
		DurationMS: readInt64Field(resultObj, "duration_ms", "durationMs"),
		TimedOut:   readBoolField(resultObj, "timed_out", "timedOut"),
		Truncated:  readBoolField(resultObj, "truncated"),
		Cwd:        readStringField(argsObj, "cwd", "workdir"),
		TimeoutMS:  readInt64Field(argsObj, "timeout_ms", "timeoutMs"),
	}
	if parseErr != nil && strings.TrimSpace(rec.ResultJSON) != "" {
		out.RawResult = strings.TrimSpace(rec.ResultJSON)
	}

	return out, nil
}

func parseObjectJSON(raw string) (map[string]any, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return map[string]any{}, nil
	}
	var obj map[string]any
	if err := json.Unmarshal([]byte(raw), &obj); err != nil {
		return map[string]any{}, err
	}
	return obj, nil
}

func readStringField(obj map[string]any, keys ...string) string {
	for _, key := range keys {
		v, ok := obj[key]
		if !ok {
			continue
		}
		s, ok := v.(string)
		if ok {
			return s
		}
	}
	return ""
}

func readIntField(obj map[string]any, keys ...string) int {
	for _, key := range keys {
		v, ok := obj[key]
		if !ok {
			continue
		}
		switch vv := v.(type) {
		case float64:
			return int(vv)
		case int:
			return vv
		case int64:
			return int(vv)
		case json.Number:
			if n, err := vv.Int64(); err == nil {
				return int(n)
			}
		case string:
			if n, err := strconv.Atoi(strings.TrimSpace(vv)); err == nil {
				return n
			}
		}
	}
	return 0
}

func readInt64Field(obj map[string]any, keys ...string) int64 {
	for _, key := range keys {
		v, ok := obj[key]
		if !ok {
			continue
		}
		switch vv := v.(type) {
		case float64:
			return int64(vv)
		case int:
			return int64(vv)
		case int64:
			return vv
		case json.Number:
			if n, err := vv.Int64(); err == nil {
				return n
			}
		case string:
			if n, err := strconv.ParseInt(strings.TrimSpace(vv), 10, 64); err == nil {
				return n
			}
		}
	}
	return 0
}

func readBoolField(obj map[string]any, keys ...string) bool {
	for _, key := range keys {
		v, ok := obj[key]
		if !ok {
			continue
		}
		switch vv := v.(type) {
		case bool:
			return vv
		case float64:
			return vv != 0
		case int:
			return vv != 0
		case int64:
			return vv != 0
		case string:
			norm := strings.TrimSpace(strings.ToLower(vv))
			if norm == "true" || norm == "1" {
				return true
			}
			if norm == "false" || norm == "0" {
				return false
			}
		}
	}
	return false
}
