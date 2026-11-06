package ai

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	flruntime "github.com/floegence/floret/v7/runtime"
	aitools "github.com/floegence/redeven/internal/ai/tools"
)

func localToolFeedbackContext(t *testing.T, name string) context.Context {
	t.Helper()
	snapshot := buildPermissionSnapshot(FlowerPermissionFullAccess, builtInToolDefinitions(), nil)
	snapshot.SnapshotID = "local-feedback"
	ctx := contextWithToolAuthorizationSnapshot(t.Context(), snapshot)
	return contextWithFloretToolExecutionAuthorization(ctx, "call", name, "attempt", snapshot, ApprovalDecisionAllow, true, nil)
}

func assertLocalToolFeedback(t *testing.T, r *run, source ToolResult, code aitools.ErrorCode, meta map[string]any) {
	t.Helper()
	if source.Status != toolResultStatusError || source.Error == nil || source.Error.Code != code || source.Error.Retryable || !reflect.DeepEqual(source.Error.Meta, meta) {
		t.Fatalf("incorrect owner diagnostic: %+v error=%+v", source, source.Error)
	}
	result, err := floretToolResultFromFlower(r, source)
	if err != nil {
		t.Fatal(err)
	}
	text, err := decodeToolJSON([]byte(result.Text))
	if err != nil || !reflect.DeepEqual(text, result.Structured) {
		t.Fatalf("model boundaries differ: %v", err)
	}
	expectedBytes, err := json.Marshal(toolErrorPayload(source.Error))
	if err != nil {
		t.Fatal(err)
	}
	expected, err := decodeToolJSON(expectedBytes)
	if err != nil || !reflect.DeepEqual(result.Structured["error"], expected) {
		t.Fatalf("diagnostic lost at model boundary: %s, %v", result.Text, err)
	}
	if !result.IsError || result.InputRequired != nil || result.Pending != nil || result.DispatchErr != nil || source.effectUncertain {
		t.Fatalf("validation invented execution or interaction: %+v", result)
	}
	if result.Activity == nil {
		t.Fatal("missing user-visible Activity")
	}
	activity, err := json.Marshal(result.Activity)
	message, _ := json.Marshal(source.Error.Message)
	if err != nil || !strings.Contains(string(activity), string(message)) || !strings.Contains(string(activity), string(code)) {
		t.Fatalf("Activity lost error facts: %s, %v", activity, err)
	}
}

func TestFileEditMatchFailuresPreserveFileAndReachModel(t *testing.T) {
	for _, tc := range []struct {
		name, old, reason string
		all               bool
		count             int
	}{
		{"missing", "absent", "old_string_not_found", false, 0},
		{"missing with replace all", "absent", "old_string_not_found", true, 0},
		{"ambiguous", "alpha", "old_string_ambiguous", false, 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			workspace := t.TempDir()
			path := filepath.Join(workspace, "edit.txt")
			original := "alpha\nbeta\nalpha\n"
			if err := os.WriteFile(path, []byte(original), 0o640); err != nil {
				t.Fatal(err)
			}
			before, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			r := &run{agentHomeDir: workspace, workingDir: workspace, sessionMeta: testSendTurnMeta()}
			args := map[string]any{"file_path": "edit.txt", "old_string": tc.old, "new_string": "omega", "replace_all": tc.all}
			handler := &builtInToolHandler{r: r, toolName: "file.edit"}
			result, err := handler.Execute(localToolFeedbackContext(t, "file.edit"), ToolCall{ID: "call", Name: "file.edit", Args: args})
			if err != nil {
				t.Fatal(err)
			}
			got, err := os.ReadFile(path)
			if err != nil || string(got) != original {
				t.Fatalf("rejected edit changed file: %q, %v", got, err)
			}
			after, err := os.Stat(path)
			if err != nil || !after.ModTime().Equal(before.ModTime()) || after.Mode() != before.Mode() {
				t.Fatalf("rejected edit touched file metadata: %v", err)
			}
			assertLocalToolFeedback(t, r, result, aitools.ErrorCodeInvalidArguments, map[string]any{"reason": tc.reason, "match_count": tc.count, "file_modified": false})
		})
	}
}

type terminalFeedbackHost struct {
	terminalReadWaitTestHost
	starts []terminalProcessStartRequest
}

func (h *terminalFeedbackHost) Start(req terminalProcessStartRequest) (*terminalProcess, error) {
	h.starts = append(h.starts, req)
	return nil, errors.New("fixture stopped before process creation")
}

type terminalFeedbackWork struct {
	flruntime.ThreadService
	flruntime.ThreadHostWorkService
	binds, completions int
}

func (w *terminalFeedbackWork) BindHostWork(context.Context, flruntime.BindHostWorkInput) error {
	w.binds++
	return nil
}

func (w *terminalFeedbackWork) CompleteHostWork(context.Context, flruntime.CompleteHostWorkInput) error {
	w.completions++
	return nil
}

func TestTerminalExecDirectoryArgumentsAtDispatch(t *testing.T) {
	for _, name := range []string{"default", "cwd", "workdir", "equivalent", "symlink", "conflicting"} {
		t.Run(name, func(t *testing.T) {
			workspace := t.TempDir()
			sub := filepath.Join(workspace, "sub")
			if err := os.Mkdir(sub, 0o755); err != nil {
				t.Fatal(err)
			}
			args := map[string]any{"command": "printf accepted"}
			want := sub
			switch name {
			case "default":
				want = workspace
			case "cwd":
				args["cwd"] = " sub "
			case "workdir":
				args["workdir"] = sub
			case "equivalent":
				args["cwd"], args["workdir"] = "./sub", sub
			case "symlink":
				if err := os.Symlink(sub, filepath.Join(workspace, "link")); err != nil {
					t.Skipf("symlink unavailable: %v", err)
				}
				args["cwd"], args["workdir"] = "link", sub
			case "conflicting":
				args["cwd"], args["workdir"] = ".", sub
			}
			host := &terminalFeedbackHost{}
			work := &terminalFeedbackWork{}
			r := &run{agentHomeDir: workspace, workingDir: workspace, sessionMeta: testSendTurnMeta(), host: runHostCapabilities{terminal: host}, threadRuntime: work}
			bindTargetTestRun(t, r)
			handler := &builtInToolHandler{r: r, toolName: "terminal.exec"}
			result, err := handler.Execute(localToolFeedbackContext(t, "terminal.exec"), ToolCall{ID: "call", Name: "terminal.exec", Args: args})
			if err != nil {
				t.Fatal(err)
			}
			if name == "conflicting" {
				if len(host.starts) != 0 || work.binds != 0 || work.completions != 0 {
					t.Fatal("conflicting arguments reached process admission or creation")
				}
				assertLocalToolFeedback(t, r, result, aitools.ErrorCodeInvalidPath, map[string]any{"reason": "conflicting_working_directories", "process_started": false})
				return
			}
			want, err = filepath.EvalSymlinks(want)
			if err != nil || len(host.starts) != 1 || host.starts[0].CwdAbs != want {
				t.Fatalf("directory dispatch=%+v, want=%q, result=%+v, error=%v", host.starts, want, result.Error, err)
			}
		})
	}
}

func TestTerminalExecSchemaExplainsDirectoryArguments(t *testing.T) {
	for _, definition := range builtInToolDefinitions() {
		if definition.Name != "terminal.exec" {
			continue
		}
		var schema struct {
			Properties map[string]struct{ Description string }
		}
		if err := json.Unmarshal(definition.InputSchema, &schema); err != nil {
			t.Fatal(err)
		}
		for _, field := range []string{"cwd", "workdir"} {
			text := schema.Properties[field].Description
			if !strings.Contains(text, "cwd") || !strings.Contains(text, "same directory") {
				t.Errorf("%s does not explain equivalence/conflicts: %q", field, text)
			}
		}
		if !strings.Contains(schema.Properties["cwd"].Description, "run working directory") {
			t.Error("cwd does not explain relative paths and default")
		}
		return
	}
	t.Fatal("missing terminal.exec definition")
}
