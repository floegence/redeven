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
	RunID           string `json:"run_id"`
	ToolID          string `json:"tool_id"`
	ToolName        string `json:"tool_name"`
	Status          string `json:"status"`
	ProcessID       string `json:"process_id,omitempty"`
	Output          string `json:"output"`
	ExitCode        int    `json:"exit_code"`
	DurationMS      int64  `json:"duration_ms"`
	Truncated       bool   `json:"truncated"`
	Cwd             string `json:"cwd,omitempty"`
	FirstSeq        int64  `json:"first_seq"`
	LastSeq         int64  `json:"last_seq"`
	LatestSeq       int64  `json:"latest_seq"`
	HasMore         bool   `json:"has_more"`
	TotalBytes      int64  `json:"total_bytes,omitempty"`
	StartedAtUnixMs int64  `json:"started_at_ms,omitempty"`
	EndedAtUnixMs   int64  `json:"ended_at_ms,omitempty"`
}

type ToolDetail struct {
	RunID           string         `json:"run_id"`
	ToolID          string         `json:"tool_id"`
	ToolName        string         `json:"tool_name"`
	Status          string         `json:"status"`
	Args            map[string]any `json:"args,omitempty"`
	Result          any            `json:"result,omitempty"`
	ErrorCode       string         `json:"error_code,omitempty"`
	ErrorMessage    string         `json:"error_message,omitempty"`
	Retryable       bool           `json:"retryable,omitempty"`
	RecoveryAction  string         `json:"recovery_action,omitempty"`
	StartedAtUnixMs int64          `json:"started_at_unix_ms,omitempty"`
	EndedAtUnixMs   int64          `json:"ended_at_unix_ms,omitempty"`
	LatencyMS       int64          `json:"latency_ms,omitempty"`
	RawArgs         string         `json:"raw_args,omitempty"`
	RawResult       string         `json:"raw_result,omitempty"`
}

func (s *Service) GetToolDetail(ctx context.Context, meta *session.Meta, runID string, toolID string) (*ToolDetail, error) {
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
	argsObj, argsErr := parseObjectJSON(rec.ArgsJSON)
	var result any
	if strings.TrimSpace(rec.ResultJSON) != "" {
		if err := json.Unmarshal([]byte(rec.ResultJSON), &result); err != nil {
			result = nil
		}
	}
	detail := &ToolDetail{
		RunID:           strings.TrimSpace(rec.RunID),
		ToolID:          strings.TrimSpace(rec.ToolID),
		ToolName:        strings.TrimSpace(rec.ToolName),
		Status:          strings.TrimSpace(rec.Status),
		Args:            argsObj,
		Result:          result,
		ErrorCode:       strings.TrimSpace(rec.ErrorCode),
		ErrorMessage:    strings.TrimSpace(rec.ErrorMessage),
		Retryable:       rec.Retryable,
		RecoveryAction:  strings.TrimSpace(rec.RecoveryAction),
		StartedAtUnixMs: rec.StartedAtUnixMs,
		EndedAtUnixMs:   rec.EndedAtUnixMs,
		LatencyMS:       rec.LatencyMS,
	}
	if argsErr != nil && strings.TrimSpace(rec.ArgsJSON) != "" {
		detail.RawArgs = strings.TrimSpace(rec.ArgsJSON)
	}
	if result == nil && strings.TrimSpace(rec.ResultJSON) != "" {
		detail.RawResult = strings.TrimSpace(rec.ResultJSON)
	}
	return detail, nil
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

	resultObj, err := parseObjectJSON(rec.ResultJSON)
	if err != nil {
		return nil, fmt.Errorf("invalid terminal output result: %w", err)
	}
	argsObj, err := parseObjectJSON(rec.ArgsJSON)
	if err != nil {
		return nil, fmt.Errorf("invalid terminal output args: %w", err)
	}

	out := &TerminalToolOutput{
		RunID:           strings.TrimSpace(rec.RunID),
		ToolID:          strings.TrimSpace(rec.ToolID),
		ToolName:        strings.TrimSpace(rec.ToolName),
		Status:          strings.TrimSpace(rec.Status),
		ProcessID:       readStringField(resultObj, "process_id"),
		Output:          readStringField(resultObj, "output"),
		ExitCode:        readIntField(resultObj, "exit_code"),
		DurationMS:      readInt64Field(resultObj, "duration_ms"),
		Truncated:       readBoolField(resultObj, "truncated"),
		Cwd:             readStringField(argsObj, "cwd"),
		FirstSeq:        readInt64Field(resultObj, "first_seq"),
		LastSeq:         readInt64Field(resultObj, "last_seq"),
		LatestSeq:       readInt64Field(resultObj, "latest_seq"),
		HasMore:         readBoolField(resultObj, "has_more"),
		TotalBytes:      readInt64Field(resultObj, "total_bytes"),
		StartedAtUnixMs: readInt64Field(resultObj, "started_at_ms"),
		EndedAtUnixMs:   readInt64Field(resultObj, "ended_at_ms"),
	}
	if cwd := readStringField(resultObj, "cwd"); cwd != "" {
		out.Cwd = cwd
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
