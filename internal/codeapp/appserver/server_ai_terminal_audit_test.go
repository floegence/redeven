package appserver

import "testing"

func TestTerminalProcessAuditDetailDoesNotMirrorFloretToolState(t *testing.T) {
	t.Parallel()

	inputBytes := 17
	detail := terminalProcessAuditDetail(" process_123 ", &inputBytes)
	if got := detail["process_id"]; got != "process_123" {
		t.Fatalf("process_id=%v, want process_123", got)
	}
	if got := detail["input_bytes"]; got != inputBytes {
		t.Fatalf("input_bytes=%v, want %d", got, inputBytes)
	}
	for _, forbidden := range []string{
		"run_id",
		"thread_id",
		"turn_id",
		"tool_id",
		"tool_name",
		"status",
		"output",
		"result",
		"error_code",
		"duration_ms",
		"exit_code",
	} {
		if _, ok := detail[forbidden]; ok {
			t.Fatalf("terminal process audit detail must not contain Floret tool-state field %q", forbidden)
		}
	}
}
