package ai

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	fltools "github.com/floegence/floret/v7/tools"
	aitools "github.com/floegence/redeven/internal/ai/tools"
)

func TestTerminalWriteSchemaRequiresSafeDescription(t *testing.T) {
	for _, def := range builtInToolDefinitions() {
		if def.Name != "terminal.write" {
			continue
		}
		var schema map[string]any
		if err := json.Unmarshal(def.InputSchema, &schema); err != nil {
			t.Fatal(err)
		}
		required := extractStringSlice(schema["required"])
		if !strings.Contains(strings.Join(required, ","), "description") {
			t.Fatal("write description is optional")
		}
		description := schema["properties"].(map[string]any)["description"].(map[string]any)
		if description["minLength"] != float64(1) || description["maxLength"] != float64(120) {
			t.Fatalf("unbounded description: %#v", description)
		}
		return
	}
	t.Fatal("write definition missing")
}

func TestTerminalInteractionPresentationPreservesPurposeAndSafeFacts(t *testing.T) {
	for _, op := range []string{"exec", "read", "write", "terminate"} {
		name := "terminal." + op
		args := map[string]any{"process_id": "proc-1", "description": "检查 GPU/LM Studio 诊断输出", "command": "ssh host", "input": "private-password\n", "stdin": "private-stdin"}
		call := floretActivityForToolCall(name, args)
		data := map[string]any{"command": "ssh host", "process_id": "proc-1", "input_bytes": 12, "output": "ok", "first_seq": 1, "last_seq": 2, "latest_seq": 3, "has_more": true, "total_bytes": 128, "execution_location": "local", "timed_out": true, "terminated": op == "terminate"}
		result, err := floretActivityForToolResult(nil, ToolResult{ToolName: name, Status: toolResultStatusSuccess, Data: data, activityInput: terminalActivityInput(args)})
		if err != nil {
			t.Fatal(err)
		}
		merged := fltools.MergeActivityPresentations(call, result)
		if merged.Label != args["description"] {
			t.Fatalf("%s lost purpose: %#v", name, merged)
		}
		got := merged.Payload.(fltools.TerminalActivityPayload)
		if got.Operation != op || got.Command != "ssh host" || got.ProcessID != "proc-1" || got.ExecutionLocation != "local" || !got.TimedOut {
			t.Fatalf("%s lost facts: %#v", name, got)
		}
		if op == "write" {
			if got.InputBytes != 12 || got.Output != "" {
				t.Fatalf("unsafe write detail: %#v", got)
			}
		} else if got.FirstSeq != 1 || got.LastSeq != 2 || got.LatestSeq != 3 || !got.HasMore || got.TotalBytes != 128 {
			t.Fatalf("%s lost cursor: %#v", name, got)
		}
		if op == "terminate" && !got.Terminated {
			t.Fatal("termination lost")
		}
		payloadJSON, err := json.Marshal(got)
		if err != nil {
			t.Fatal(err)
		}
		var payload map[string]any
		if err := json.Unmarshal(payloadJSON, &payload); err != nil {
			t.Fatal(err)
		}
		public, ok := sanitizeActivityPayloadValue(payload, fltools.ActivityRendererTerminal, name)
		if !ok || public["operation"] != op || public["timed_out"] != true {
			t.Fatalf("%s lost public outcome: %#v", name, public)
		}
		if op == "terminate" && public["terminated"] != true {
			t.Fatalf("termination lost at public boundary: %#v", public)
		}
		raw, _ := json.Marshal(merged)
		if strings.Contains(string(raw), "private-password") || strings.Contains(string(raw), "private-stdin") {
			t.Fatalf("input leaked: %s", raw)
		}
	}
}

func TestTerminalActivityRedactsInputRepeatedInDescription(t *testing.T) {
	args := map[string]any{"description": "Submit hunter2 to SSH", "input": "hunter2\n", "process_id": "proc-1"}
	for _, v := range []any{terminalActivityInput(args), floretActivityForToolCall("terminal.write", args)} {
		raw, _ := json.Marshal(v)
		if strings.Contains(string(raw), "hunter2") || strings.Contains(string(raw), `"input"`) {
			t.Fatalf("input retained: %s", raw)
		}
	}
}

func TestTerminalActivityFallbackAndEmptyRead(t *testing.T) {
	for _, desc := range []string{"", "View command output", "Terminal output"} {
		call := floretActivityForToolCall("terminal.read", map[string]any{"description": desc, "command": "GPU diagnostic", "process_id": "proc-1"})
		if !strings.Contains(call.Label, "GPU diagnostic") {
			t.Fatalf("missing target: %#v", call)
		}
	}
	call := floretActivityForToolCall("terminal.read", map[string]any{"description": "再次检查诊断输出", "process_id": "gone"})
	result, err := floretActivityForToolResult(nil, ToolResult{ToolName: "terminal.read", Status: toolResultStatusError, Error: &aitools.ToolError{Code: aitools.ErrorCodeUnknown, Message: "terminal process not found"}})
	if err != nil {
		t.Fatal(err)
	}
	merged := fltools.MergeActivityPresentations(call, result)
	if merged.Label != call.Label || merged.Payload.(fltools.TerminalActivityPayload).Error == nil {
		t.Fatalf("missing snapshot erased purpose: %#v", merged)
	}
	snapshot := terminalProcessSnapshot{ProcessID: "proc-1", Command: "GPU diagnostic", Status: terminalProcessStatusSuccess, LatestSeq: 3, Error: &aitools.ToolError{Code: aitools.ErrorCodeTimeout}}
	payload := terminalProcessResultPayload(snapshot)
	if payload["has_more"] != false || payload["output"] != "" || payload["timed_out"] != true {
		t.Fatalf("empty read facts: %#v", payload)
	}
}

func TestTerminalWriteCountsActualUTF8BytesAndPreservesFailureTarget(t *testing.T) {
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	defer writer.Close()
	process := &terminalProcess{id: "proc-1", command: "ssh host", status: terminalProcessStatusRunning, tty: writer, startedAt: time.Now()}
	input := "密码\n"
	snapshot, err := process.Write(input)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.InputBytes != int64(len(input)) || snapshot.Command != "ssh host" {
		t.Fatalf("wrong write receipt: %#v", snapshot)
	}
	received := make([]byte, len(input))
	if _, err := reader.Read(received); err != nil {
		t.Fatal(err)
	}
	if string(received) != input {
		t.Fatal("execution input changed")
	}
	process.status = terminalProcessStatusSuccess
	snapshot, err = process.Write(input)
	if err == nil || snapshot.InputBytes != 0 || snapshot.ProcessID != "proc-1" {
		t.Fatalf("failed write receipt: %#v, %v", snapshot, err)
	}
	process.status, process.tty = terminalProcessStatusRunning, nil
	snapshot, err = process.Write(input)
	if err == nil || snapshot.InputBytes != 0 || snapshot.ProcessID != "proc-1" {
		t.Fatalf("unavailable input receipt: %#v, %v", snapshot, err)
	}
}
