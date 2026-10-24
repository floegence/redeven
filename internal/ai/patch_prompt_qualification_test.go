package ai

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func patchPromptQualificationCases() []promptQualificationCase {
	const before = "roof=1\nkeep-a\nwater=2\nkeep-b\nsun=3\n"
	const after = "roof=10\nkeep-a\nwater=20\nkeep-b\nsun=30\n"
	const path = "/workspace/demo/scene.txt"
	const input = "The current file /workspace/demo/scene.txt was just read and its complete content is roof=1, keep-a, water=2, keep-b, sun=3 on separate lines, with a final newline. All applicable repository rules are already read; no additional requirements apply. Use a single apply_patch call to change sun to 30, roof to 10, and water to 20, preserving the keep lines. The path and current content are confirmed; submit the edit now."
	patch := func(body string) string {
		return "*** Begin Patch\n*** Update File: " + path + "\n" + body + "\n*** End Patch"
	}
	backwards := patch("@@ keep-b\n-sun=3\n+sun=30\n@@\n-roof=1\n+roof=10\n@@\n-water=2\n+water=20")
	duplicate := patch("@@\n-roof=1\n+roof=10\n*** Update File: " + path + "\n@@\n-water=2\n+water=20\n@@\n-sun=3\n+sun=30")
	check := func(result ModelGatewayResult) error {
		if len(result.ToolCalls) != 1 || result.ToolCalls[0].Name != "apply_patch" {
			return fmt.Errorf("expected one apply_patch call")
		}
		text, _ := result.ToolCalls[0].Args["input"].(string)
		parsed, err := parsePatchText(text)
		if err != nil || len(parsed.files) != 1 {
			return fmt.Errorf("expected one valid file operation: %v", err)
		}
		file := parsed.files[0]
		if file.isNew || file.isDelete || file.oldPath != file.newPath || (file.oldPath != path && file.oldPath != "scene.txt") {
			return fmt.Errorf("patch changed the confirmed operation or target")
		}
		got, err := applyUnifiedDiffHunksToBytes([]byte(before), file.hunks)
		if err != nil || string(got) != after {
			return fmt.Errorf("patch does not produce requested content: %v", err)
		}
		return nil
	}
	cases := []promptQualificationCase{{name: "patch_ordered_chunks", input: input, wantTools: []string{"apply_patch"}, check: check}}
	for _, fixture := range []struct{ name, text string }{{"patch_order_recovery", backwards}, {"patch_duplicate_recovery", duplicate}} {
		parsed, err := parsePatchText(fixture.text)
		if err != nil {
			panic(err)
		}
		var diagnostic error
		if len(parsed.files) == 1 {
			_, diagnostic = applyUnifiedDiffHunksToBytes([]byte(before), parsed.files[0].hunks)
		} else {
			diagnostic = duplicatePatchOperation(path)
		}
		failure := patchToolError(&patchApplyError{cause: diagnostic})
		args, _ := json.Marshal(map[string]any{"input": fixture.text})
		result, _ := json.Marshal(map[string]any{"status": "error", "error": failure})
		cases = append(cases, promptQualificationCase{name: fixture.name, input: input, history: promptQualificationReceipt("apply_patch", string(args), string(result)), wantTools: []string{"apply_patch"}, check: check})
	}
	return cases
}

func TestPatchPromptQualificationRejectsInvalidEdits(t *testing.T) {
	for _, tc := range patchPromptQualificationCases() {
		_, defs := promptQualificationSurface(t, tc)
		good := "*** Begin Patch\n*** Update File: /workspace/demo/scene.txt\n@@\n-roof=1\n+roof=10\n@@\n-water=2\n+water=20\n@@\n-sun=3\n+sun=30\n*** End Patch"
		for _, trial := range []struct {
			name  string
			args  map[string]any
			valid bool
		}{
			{"correct", map[string]any{"input": good}, true},
			{"old_argument", map[string]any{"patch": good}, false},
			{"extra_argument", map[string]any{"input": good, "input_format": "patch"}, false},
			{"wrong_old_text", map[string]any{"input": strings.Replace(good, "-roof=1", "-roof=9", 1)}, false},
			{"wrong_result", map[string]any{"input": strings.Replace(good, "+roof=10", "+roof=11", 1)}, false},
			{"duplicate_header", map[string]any{"input": strings.Replace(good, "@@\n-water", "*** Update File: /workspace/demo/scene.txt\n@@\n-water", 1)}, false},
			{"out_of_order", map[string]any{"input": "*** Begin Patch\n*** Update File: /workspace/demo/scene.txt\n@@\n-sun=3\n+sun=30\n@@\n-roof=1\n+roof=10\n@@\n-water=2\n+water=20\n*** End Patch"}, true},
		} {
			t.Run(tc.name+"/"+trial.name, func(t *testing.T) {
				result := ModelGatewayResult{ToolCalls: []ToolCall{{Name: "apply_patch", Args: trial.args}}}
				issues := evaluatePromptQualificationResponse(t, tc, defs, result)
				if (len(issues) == 0) != trial.valid {
					t.Fatalf("valid=%v issues=%v", trial.valid, issues)
				}
			})
		}
	}
}
