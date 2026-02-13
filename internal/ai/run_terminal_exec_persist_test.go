package ai

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestRedactAnyForPersist_TerminalExec_RedactsStdinAndPreservesNewlines(t *testing.T) {
	t.Parallel()

	args := map[string]any{
		"command": "line1\nline2",
		"stdin":   "secret\nvalue",
	}

	redacted := redactToolArgsForPersist("terminal.exec", args)

	if got := redacted["command"]; got != "line1\nline2" {
		t.Fatalf("command=%q, want %q", got, "line1\nline2")
	}

	stdinAny, ok := redacted["stdin"]
	if !ok {
		t.Fatalf("stdin missing")
	}
	stdinMap, ok := stdinAny.(map[string]any)
	if !ok {
		t.Fatalf("stdin type=%T, want map[string]any", stdinAny)
	}
	if redactedFlag, _ := stdinMap["redacted"].(bool); !redactedFlag {
		t.Fatalf("stdin.redacted=%v, want true", stdinMap["redacted"])
	}
	if bytes, _ := stdinMap["bytes"].(int); bytes == 0 {
		t.Fatalf("stdin.bytes=%v, want >0", stdinMap["bytes"])
	}
	if lines, _ := stdinMap["lines"].(int); lines != 2 {
		t.Fatalf("stdin.lines=%v, want 2", stdinMap["lines"])
	}

	if !isSensitiveLogKey("stdin") {
		t.Fatalf("stdin should be treated as sensitive")
	}
	if s, _ := redactAnyForLog("stdin", "secret\nvalue", 0).(string); !strings.HasPrefix(s, "[redacted:") {
		t.Fatalf("redactAnyForLog(stdin)=%q, want redacted placeholder", s)
	}
}

func TestMarshalPersistJSON_TerminalExecArgs_JSONIsValid(t *testing.T) {
	t.Parallel()

	args := map[string]any{
		"command": "line1\nline2",
		"stdin":   "secret\nvalue",
	}
	argsJSON := marshalPersistJSON(redactAnyForPersist("args", args, 0), 4000)
	if !json.Valid([]byte(argsJSON)) {
		t.Fatalf("argsJSON must be valid JSON, got: %q", argsJSON)
	}

	var parsed map[string]any
	if err := json.Unmarshal([]byte(argsJSON), &parsed); err != nil {
		t.Fatalf("unmarshal argsJSON: %v", err)
	}
	if parsed["command"] != "line1\nline2" {
		t.Fatalf("parsed.command=%q, want %q", parsed["command"], "line1\nline2")
	}
	stdinAny, ok := parsed["stdin"]
	if !ok {
		t.Fatalf("parsed.stdin missing")
	}
	if _, ok := stdinAny.(map[string]any); !ok {
		t.Fatalf("parsed.stdin type=%T, want map[string]any", stdinAny)
	}
}
