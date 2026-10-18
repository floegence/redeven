package ai

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	fltools "github.com/floegence/floret/v7/tools"
	aitools "github.com/floegence/redeven/internal/ai/tools"
)

func computerResultFixture() map[string]any {
	return map[string]any{"observation": map[string]any{"semantic": map[string]any{"truncated": false, "nodes": []any{map[string]any{"bounds": map[string]any{"x": json.Number("9007199254740993"), "y": json.Number("1.25")}, "states": map[string]any{"enabled": true, "value": nil}, "actions": []any{"click"}, "child_refs": []any{"child"}}}}}}
}
func assertComputerResultTypes(t *testing.T, payload map[string]any) {
	t.Helper()
	data := payload["data"].(map[string]any)
	node := data["observation"].(map[string]any)["semantic"].(map[string]any)["nodes"].([]any)[0].(map[string]any)
	bounds, ok := node["bounds"].(map[string]any)
	if !ok {
		t.Fatalf("bounds must remain an object: %#v", node["bounds"])
	}
	if bounds["x"] != json.Number("9007199254740993") || bounds["y"] != json.Number("1.25") {
		t.Fatalf("numbers changed: %#v", bounds)
	}
	states, ok := node["states"].(map[string]any)
	if !ok || states["enabled"] != true {
		t.Fatalf("states lost: %#v", node["states"])
	}
	if v, exists := states["value"]; !exists || v != nil {
		t.Fatal("null lost")
	}
	for _, key := range []string{"actions", "child_refs"} {
		if _, ok := node[key].([]any); !ok {
			t.Fatalf("%s must remain an array: %#v", key, node[key])
		}
	}
	if payload["truncated"] != false {
		t.Fatal("presentation marked model output truncated")
	}
}
func TestComputerResultPreservesJSONTypesAndSnapshot(t *testing.T) {
	source := computerResultFixture()
	result, err := floretToolResultFromFlower(nil, ToolResult{ToolID: "observe", ToolName: "computer.observe", Status: toolResultStatusSuccess, Data: source})
	if err != nil {
		t.Fatal(err)
	}
	assertComputerResultTypes(t, result.Structured)
	var text map[string]any
	decoder := json.NewDecoder(strings.NewReader(result.Text))
	decoder.UseNumber()
	if err := decoder.Decode(&text); err != nil {
		t.Fatal(err)
	}
	assertComputerResultTypes(t, text)
	if !reflect.DeepEqual(text, result.Structured) {
		t.Fatal("Text and Structured differ")
	}
	source["observation"].(map[string]any)["semantic"].(map[string]any)["nodes"].([]any)[0].(map[string]any)["bounds"] = "changed"
	assertComputerResultTypes(t, result.Structured)
}
func TestConfirmedCancellationTextMatchesStructured(t *testing.T) {
	for _, data := range []any{nil, map[string]any{"invalid": math.NaN()}} {
		result, err := floretToolResultFromFlower(nil, ToolResult{ToolID: "cancel", ToolName: "computer.exec", Status: toolResultStatusAborted, cancellationConfirmed: true, Data: data})
		if err != nil {
			t.Fatal(err)
		}
		var payload map[string]any
		if err := json.NewDecoder(bytes.NewBufferString(result.Text)).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if payload["outcome"] != fltools.ResultOutcomeCanceled || result.Structured["outcome"] != fltools.ResultOutcomeCanceled {
			t.Fatalf("cancellation parity: %s %#v", result.Text, result.Structured)
		}
	}
}

func computerEncodingCode(result fltools.Result) string {
	record, _ := result.Structured["error"].(map[string]any)
	return anyToString(record["code"])
}
func TestComputerFinalEnvelopeBoundaryAndIndependentArchive(t *testing.T) {
	for _, size := range []int{65535, 65536, 65537, 1048575, 1048576, 1048577} {
		source := ToolResult{ToolID: "observe", ToolName: "computer.observe", Status: toolResultStatusSuccess, Data: map[string]any{"text": ""}}
		raw, _, err := encodeToolResultEnvelope(source)
		if err != nil {
			t.Fatal(err)
		}
		source.Data.(map[string]any)["text"] = strings.Repeat("x", size-len(raw))
		result, err := floretToolResultFromFlower(nil, source)
		if err != nil {
			t.Fatal(err)
		}
		if size > computerResultMaxBytes {
			if computerEncodingCode(result) != "TOOL_RESULT_TOO_LARGE" || !result.IsError || result.InputRequired != nil {
				t.Fatalf("oversize: %+v", result)
			}
			continue
		}
		if len(result.Text) != size || result.IsError || result.Structured["truncated"] != false {
			t.Fatalf("boundary %d: len=%d", size, len(result.Text))
		}
		projected := fltools.BuildOutputProjection(result, fltools.MergeOutputPolicy(fltools.DefaultOutputPolicy(), result.OutputPolicy))
		if projected.Truncated || projected.VisibleText != result.Text || (projected.FullOutputPlan != nil) != (size > 65536) {
			t.Fatalf("archive boundary %d", size)
		}
	}
}
func TestComputerEncodingFailureRespectsExecutionAuthority(t *testing.T) {
	for _, name := range []string{"readonly", "completed_action", "unknown", "unconfirmed_cancel", "confirmed_cancel", "declined", "pending"} {
		t.Run(name, func(t *testing.T) {
			source := ToolResult{ToolID: "call", ToolName: "computer.exec", Status: toolResultStatusSuccess, Data: map[string]any{"bad": math.NaN(), "code": "private script"}, executionFacts: toolExecutionFacts{callID: "call", toolName: "computer.exec", targetID: "authorized", completed: true, potentialMutation: true, completedActions: []string{"click"}, needsObservation: true}}
			switch name {
			case "readonly":
				source.executionFacts.potentialMutation = false
			case "unknown":
				source.Status = toolResultStatusError
				source.dispatchErr = errComputerEffectUnknown
			case "unconfirmed_cancel", "confirmed_cancel":
				source.Status = toolResultStatusAborted
				source.cancellationConfirmed = name == "confirmed_cancel"
			case "declined":
				source.Status = toolResultStatusError
				source.Error = &aitools.ToolError{Code: aitools.ErrorCodePermissionDenied}
			case "pending":
				source.Pending = &PendingToolResult{Handle: "pending"}
			}
			result, err := floretToolResultFromFlower(nil, source)
			if err != nil {
				t.Fatal(err)
			}
			if (result.InputRequired != nil) != (name == "completed_action") {
				t.Fatalf("wrong pause for %s", name)
			}
			if strings.Contains(result.Text, "private script") || strings.Contains(result.Text, "NaN") {
				t.Fatal("bad payload leaked")
			}
			if name == "unknown" && result.DispatchErr != errComputerEffectUnknown {
				t.Fatal("unknown authority lost")
			}
			if name == "completed_action" {
				if !result.IsError || computerEncodingCode(result) != "TOOL_RESULT_ENCODING_FAILED" {
					t.Fatal("failure was presented as success")
				}
				for _, chip := range result.Activity.Chips {
					if chip.Kind == "computer_assistance" {
						t.Fatal("fabricated takeover")
					}
				}
				if len(result.Activity.TargetRefs) != 1 || result.Activity.TargetRefs[0].ResourceRef != "authorized" {
					t.Fatal("authorized target missing")
				}
			}
		})
	}
}
func TestExactNumbersProgressAndActivityIsolation(t *testing.T) {
	source := ToolResult{ToolID: "read", ToolName: "terminal.read", Status: toolResultStatusSuccess, Data: map[string]any{"process_id": "p", "last_seq": int64(9007199254740993), "ended_at_ms": int64(9223372036854775807), "status": "running"}}
	result, err := floretToolResultFromFlower(nil, source)
	if err != nil {
		t.Fatal(err)
	}
	if result.Metadata[fltools.ResultMetadataProgressToken] != "p:9007199254740993:running:9223372036854775807" {
		t.Fatalf("token lost precision: %#v", result.Metadata)
	}
	for _, number := range []json.Number{"9007199254740993", "9223372036854775807", "-9223372036854775808"} {
		if got, ok := activityIntValue(number); !ok || fmt.Sprint(got) != string(number) {
			t.Fatalf("activity number %s: %d %v", number, got, ok)
		}
	}
	if _, ok := activityIntValue(json.Number("1.25")); ok {
		t.Fatal("fraction silently truncated")
	}
	original := result.Text
	result.Activity.Label = "modified"
	result.Structured["data"].(map[string]any)["last_seq"] = json.Number("2")
	if source.Data.(map[string]any)["last_seq"] != int64(9007199254740993) || result.Text != original {
		t.Fatal("snapshots share state")
	}
}

func TestComputerSemanticBudgetAndSourceTruncation(t *testing.T) {
	for _, count := range []int{90, 140} {
		tree := computerSemanticSnapshot{Version: computerSemanticSchemaVersion, DocumentID: "budget", Nodes: []computerSemanticNode{}}
		for i := 0; i < count; i++ {
			tree.Nodes = append(tree.Nodes, computerSemanticNode{Ref: fmt.Sprint(i), Role: "button", PlatformRole: "button", Name: strings.Repeat("x", 2000), Actions: []string{"read", "click"}, Bounds: &computerSemanticBounds{Width: 1, Height: 1}})
		}
		semantic, err := normalizeComputerObservation(tree)
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := json.Marshal(semantic)
		if len(raw) > computerSemanticMaxBytes || len(raw) < 190000 {
			t.Fatalf("unexpected semantic size %d", len(raw))
		}
		result, err := floretToolResultFromFlower(nil, ToolResult{ToolID: "semantic", ToolName: "computer.observe", Status: toolResultStatusSuccess, Data: map[string]any{"observation": map[string]any{"semantic": semantic}}})
		if err != nil {
			t.Fatal(err)
		}
		if result.Structured["truncated"] != semantic["truncated"] || semantic["truncated"] != (count == 140) {
			t.Fatal("source truncation changed")
		}
		plan := fltools.BuildOutputProjection(result, fltools.MergeOutputPolicy(fltools.DefaultOutputPolicy(), result.OutputPolicy))
		hash := sha256.Sum256([]byte(result.Text))
		if plan.FullOutputPlan == nil || plan.FullOutputPlan.Text != result.Text || plan.ContentSHA256 != fmt.Sprintf("%x", hash) || plan.Truncated {
			t.Fatal("full output archive differs")
		}
	}
}
func TestFileModelOutputRetainsExistingBounds(t *testing.T) {
	root := t.TempDir()
	paths := []string{}
	for i := 0; i < 20; i++ {
		path := filepath.Join(root, fmt.Sprintf("file-%d.txt", i))
		if err := os.WriteFile(path, []byte(strings.Repeat("x", 2<<20)), 0600); err != nil {
			t.Fatal(err)
		}
		paths = append(paths, path)
	}
	r := newRun(runOptions{AgentHomeDir: root, WorkingDir: root})
	single, err := r.toolFileRead(t.Context(), FileReadArgs{FilePath: paths[0]})
	if err != nil {
		t.Fatal(err)
	}
	multi, err := r.toolReadFiles(t.Context(), paths, 400)
	if err != nil {
		t.Fatal(err)
	}
	for name, data := range map[string]any{"read_file": single, "read_files": multi} {
		result, err := floretToolResultFromFlower(nil, ToolResult{ToolID: name, ToolName: name, Status: toolResultStatusSuccess, Data: data})
		if err != nil {
			t.Fatal(err)
		}
		limit := 9000
		if name == "read_files" {
			limit = 170000
		}
		if len(result.Text) > limit || result.OutputPolicy != nil {
			t.Fatalf("%s expanded to %d", name, len(result.Text))
		}
		projection := fltools.BuildOutputProjection(result, fltools.DefaultOutputPolicy())
		if len(projection.VisibleText) > 65536 {
			t.Fatal("default visibility changed")
		}
	}
}
