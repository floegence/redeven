package tools

import (
	"reflect"
	"testing"
)

func TestClassifyTerminalCommandRisk_Readonly(t *testing.T) {
	t.Parallel()

	risk := ClassifyTerminalCommandRisk(`rg "TODO" . --hidden --glob '!.git'`)
	if risk != TerminalCommandRiskReadonly {
		t.Fatalf("risk=%q, want %q", risk, TerminalCommandRiskReadonly)
	}
}

func TestClassifyTerminalCommandRisk_GitReadonlyChain(t *testing.T) {
	t.Parallel()

	risk := ClassifyTerminalCommandRisk("git status && git diff")
	if risk != TerminalCommandRiskReadonly {
		t.Fatalf("risk=%q, want %q", risk, TerminalCommandRiskReadonly)
	}
}

func TestClassifyTerminalCommandRisk_WrappedReadonly(t *testing.T) {
	t.Parallel()

	risk := ClassifyTerminalCommandRisk(`bash -lc 'pwd && rg --files | head -n 20'`)
	if risk != TerminalCommandRiskReadonly {
		t.Fatalf("risk=%q, want %q", risk, TerminalCommandRiskReadonly)
	}
}

func TestClassifyTerminalCommandRisk_FindPipeEgrepReadonly(t *testing.T) {
	t.Parallel()

	risk := ClassifyTerminalCommandRisk(`find . -type f | egrep "README|go.mod" | head -n 20`)
	if risk != TerminalCommandRiskReadonly {
		t.Fatalf("risk=%q, want %q", risk, TerminalCommandRiskReadonly)
	}
}

func TestClassifyTerminalCommandRisk_ReadonlyInspectionCommands(t *testing.T) {
	t.Parallel()

	cases := []string{
		`file /tmp/demo.docx`,
		`strings /tmp/demo.docx | head -n 20`,
		`unzip -p /tmp/demo.docx word/document.xml | head -c 5000`,
		`unzip -l /tmp/demo.zip | head -n 20`,
	}
	for _, command := range cases {
		command := command
		t.Run(command, func(t *testing.T) {
			t.Parallel()
			risk := ClassifyTerminalCommandRisk(command)
			if risk != TerminalCommandRiskReadonly {
				t.Fatalf("command=%q risk=%q, want %q", command, risk, TerminalCommandRiskReadonly)
			}
		})
	}
}

func TestClassifyTerminalCommandRisk_UnzipExtractionIsMutating(t *testing.T) {
	t.Parallel()

	cases := []string{
		`unzip archive.zip`,
		`unzip -d out archive.zip`,
	}
	for _, command := range cases {
		command := command
		t.Run(command, func(t *testing.T) {
			t.Parallel()
			risk := ClassifyTerminalCommandRisk(command)
			if risk != TerminalCommandRiskMutating {
				t.Fatalf("command=%q risk=%q, want %q", command, risk, TerminalCommandRiskMutating)
			}
		})
	}
}

func TestClassifyTerminalCommandRisk_CurlReadonlyFetches(t *testing.T) {
	t.Parallel()

	cases := []string{
		`curl -s https://example.com`,
		`curl -fsSL https://example.com/path`,
		`curl -I https://example.com`,
		`curl -s https://example.com 2>/dev/null`,
		`curl -s https://example.com | head -n 20`,
		`curl -s https://example.com/data.json | python3 -m json.tool`,
		`curl -G --data-urlencode city=Toronto https://example.com/weather`,
		`curl -o /dev/null -I https://example.com`,
	}
	for _, command := range cases {
		command := command
		t.Run(command, func(t *testing.T) {
			t.Parallel()
			risk := ClassifyTerminalCommandRisk(command)
			if risk != TerminalCommandRiskReadonly {
				t.Fatalf("command=%q risk=%q, want %q", command, risk, TerminalCommandRiskReadonly)
			}
		})
	}
}

func TestClassifyTerminalCommandRisk_WgetReadonlyFetches(t *testing.T) {
	t.Parallel()

	cases := []string{
		`wget -qO- https://example.com`,
		`wget --spider https://example.com`,
		`wget --output-document=- https://example.com`,
		`wget -qO/dev/null https://example.com`,
	}
	for _, command := range cases {
		command := command
		t.Run(command, func(t *testing.T) {
			t.Parallel()
			risk := ClassifyTerminalCommandRisk(command)
			if risk != TerminalCommandRiskReadonly {
				t.Fatalf("command=%q risk=%q, want %q", command, risk, TerminalCommandRiskReadonly)
			}
		})
	}
}

func TestClassifyTerminalCommandRisk_CurlMutatingOutputsAndBodies(t *testing.T) {
	t.Parallel()

	cases := []string{
		`curl -o out.json https://example.com`,
		`curl -O https://example.com/file.tar.gz`,
		`curl --output out.json https://example.com`,
		`curl -c cookies.txt https://example.com`,
		`curl --hsts cache.txt https://example.com`,
		`curl --alt-svc cache.txt https://example.com`,
		`curl -d a=1 https://example.com`,
		`curl --json '{}' https://example.com`,
		`curl -F file=@a.txt https://example.com`,
		`curl -T a.txt https://example.com/upload`,
		`curl -X POST https://example.com`,
		`curl -X PUT https://example.com`,
		`curl -X PATCH https://example.com`,
		`curl -X DELETE https://example.com`,
	}
	for _, command := range cases {
		command := command
		t.Run(command, func(t *testing.T) {
			t.Parallel()
			risk := ClassifyTerminalCommandRisk(command)
			if risk != TerminalCommandRiskMutating {
				t.Fatalf("command=%q risk=%q, want %q", command, risk, TerminalCommandRiskMutating)
			}
		})
	}
}

func TestClassifyTerminalCommandRisk_WgetMutatingOutputsAndBodies(t *testing.T) {
	t.Parallel()

	cases := []string{
		`wget -O out.html https://example.com`,
		`wget -o wget.log https://example.com`,
		`wget --save-cookies cookies.txt https://example.com`,
		`wget --post-data='a=1' https://example.com`,
		`wget --method=POST https://example.com`,
	}
	for _, command := range cases {
		command := command
		t.Run(command, func(t *testing.T) {
			t.Parallel()
			risk := ClassifyTerminalCommandRisk(command)
			if risk != TerminalCommandRiskMutating {
				t.Fatalf("command=%q risk=%q, want %q", command, risk, TerminalCommandRiskMutating)
			}
		})
	}
}

func TestClassifyTerminalCommandRisk_Mutating(t *testing.T) {
	t.Parallel()

	risk := ClassifyTerminalCommandRisk("printf 'hello' > note.txt")
	if risk != TerminalCommandRiskMutating {
		t.Fatalf("risk=%q, want %q", risk, TerminalCommandRiskMutating)
	}
}

func TestClassifyTerminalCommandRisk_Dangerous(t *testing.T) {
	t.Parallel()

	risk := ClassifyTerminalCommandRisk("rm -rf /")
	if risk != TerminalCommandRiskDangerous {
		t.Fatalf("risk=%q, want %q", risk, TerminalCommandRiskDangerous)
	}
}

func TestClassifyTerminalCommandRisk_WrappedDangerous(t *testing.T) {
	t.Parallel()

	risk := ClassifyTerminalCommandRisk(`sh -c "rm -rf /"`)
	if risk != TerminalCommandRiskDangerous {
		t.Fatalf("risk=%q, want %q", risk, TerminalCommandRiskDangerous)
	}
}

func TestClassifyTerminalCommandRisk_RmWorkspacePathIsMutating(t *testing.T) {
	t.Parallel()

	risk := ClassifyTerminalCommandRisk("rm -rf /tmp/redeven-workspace")
	if risk != TerminalCommandRiskMutating {
		t.Fatalf("risk=%q, want %q", risk, TerminalCommandRiskMutating)
	}
}

func TestProfileTerminalCommand_CurlReadonlyIncludesEffectsAndReason(t *testing.T) {
	t.Parallel()

	profile := ProfileTerminalCommand(`curl -s https://example.com | head -n 5`)
	if profile.Risk != TerminalCommandRiskReadonly {
		t.Fatalf("risk=%q, want %q", profile.Risk, TerminalCommandRiskReadonly)
	}
	if profile.Reason != "http_fetch_stdout_readonly" {
		t.Fatalf("reason=%q, want %q", profile.Reason, "http_fetch_stdout_readonly")
	}
	if !reflect.DeepEqual(profile.Effects, []string{terminalCommandEffectNetworkRead, terminalCommandEffectLocalRead}) {
		t.Fatalf("effects=%v", profile.Effects)
	}
}

func TestProfileTerminalCommand_CurlPipePythonJSONToolStaysReadonly(t *testing.T) {
	t.Parallel()

	profile := ProfileTerminalCommand(`curl -s https://example.com/data.json | python3 -m json.tool`)
	if profile.Risk != TerminalCommandRiskReadonly {
		t.Fatalf("risk=%q, want %q", profile.Risk, TerminalCommandRiskReadonly)
	}
	if profile.Reason != "http_fetch_stdout_readonly" {
		t.Fatalf("reason=%q, want %q", profile.Reason, "http_fetch_stdout_readonly")
	}
	if !reflect.DeepEqual(profile.Effects, []string{terminalCommandEffectNetworkRead, terminalCommandEffectLocalRead}) {
		t.Fatalf("effects=%v", profile.Effects)
	}
}

func TestProfileTerminalCommand_PythonJSONToolFileIsReadonly(t *testing.T) {
	t.Parallel()

	profile := ProfileTerminalCommand(`python3 -m json.tool sample.json`)
	if profile.Risk != TerminalCommandRiskReadonly {
		t.Fatalf("risk=%q, want %q", profile.Risk, TerminalCommandRiskReadonly)
	}
	if profile.Reason != "python_json_tool_stdout" {
		t.Fatalf("reason=%q, want %q", profile.Reason, "python_json_tool_stdout")
	}
}

func TestProfileTerminalCommand_PythonInlineCodeRemainsMutating(t *testing.T) {
	t.Parallel()

	profile := ProfileTerminalCommand(`python3 -c 'print(123)'`)
	if profile.Risk != TerminalCommandRiskMutating {
		t.Fatalf("risk=%q, want %q", profile.Risk, TerminalCommandRiskMutating)
	}
	if profile.Reason != "python_inline_code" {
		t.Fatalf("reason=%q, want %q", profile.Reason, "python_inline_code")
	}
}

func TestProfileTerminalCommand_CurlOutputFileIncludesEffectsAndReason(t *testing.T) {
	t.Parallel()

	profile := ProfileTerminalCommand(`curl -o out.json https://example.com`)
	if profile.Risk != TerminalCommandRiskMutating {
		t.Fatalf("risk=%q, want %q", profile.Risk, TerminalCommandRiskMutating)
	}
	if profile.Reason != "curl_output_file" {
		t.Fatalf("reason=%q, want %q", profile.Reason, "curl_output_file")
	}
	if !reflect.DeepEqual(profile.Effects, []string{terminalCommandEffectLocalWrite}) {
		t.Fatalf("effects=%v", profile.Effects)
	}
}

func TestInvocationPolicies_TerminalExec(t *testing.T) {
	t.Parallel()

	readonlyArgs := map[string]any{"command": `curl -s https://example.com`}
	if RequiresApprovalForInvocation("terminal.exec", readonlyArgs) {
		t.Fatalf("readonly command should not require approval")
	}
	if IsMutatingForInvocation("terminal.exec", readonlyArgs) {
		t.Fatalf("readonly command should not be mutating")
	}
	if IsDangerousInvocation("terminal.exec", readonlyArgs) {
		t.Fatalf("readonly command should not be dangerous")
	}

	mutatingArgs := map[string]any{"command": `curl -d a=1 https://example.com`}
	if !RequiresApprovalForInvocation("terminal.exec", mutatingArgs) {
		t.Fatalf("mutating command must require approval")
	}
	if !IsMutatingForInvocation("terminal.exec", mutatingArgs) {
		t.Fatalf("mutating command must be classified as mutating")
	}
	if IsDangerousInvocation("terminal.exec", mutatingArgs) {
		t.Fatalf("mutating but non-dangerous command should not be dangerous")
	}

	dangerousArgs := map[string]any{"command": "rm -rf /"}
	if !RequiresApprovalForInvocation("terminal.exec", dangerousArgs) {
		t.Fatalf("dangerous command must require approval")
	}
	if !IsMutatingForInvocation("terminal.exec", dangerousArgs) {
		t.Fatalf("dangerous command must be mutating")
	}
	if !IsDangerousInvocation("terminal.exec", dangerousArgs) {
		t.Fatalf("dangerous command must be flagged")
	}
}

func TestInvocationCommandProfile(t *testing.T) {
	t.Parallel()

	profile := InvocationCommandProfile("terminal.exec", map[string]any{
		"command": `bash -lc 'curl -I https://example.com'`,
	})
	if profile.Risk != TerminalCommandRiskReadonly {
		t.Fatalf("risk=%q, want %q", profile.Risk, TerminalCommandRiskReadonly)
	}
	if profile.NormalizedCommand != "curl -I https://example.com" {
		t.Fatalf("normalized=%q, want %q", profile.NormalizedCommand, "curl -I https://example.com")
	}
}

func TestInvocationRiskInfo_NormalizedCommand(t *testing.T) {
	t.Parallel()

	risk, normalized := InvocationRiskInfo("terminal.exec", map[string]any{
		"command": `bash -lc 'pwd && rg --files | head -n 20'`,
	})
	if risk != string(TerminalCommandRiskReadonly) {
		t.Fatalf("risk=%q, want %q", risk, TerminalCommandRiskReadonly)
	}
	if normalized != "pwd && rg --files | head -n 20" {
		t.Fatalf("normalized=%q, want %q", normalized, "pwd && rg --files | head -n 20")
	}
}

func TestInvocationPolicies_WriteTodos(t *testing.T) {
	t.Parallel()

	args := map[string]any{
		"todos": []any{
			map[string]any{
				"content": "Inspect workspace",
				"status":  "in_progress",
			},
		},
	}
	if RequiresApprovalForInvocation("write_todos", args) {
		t.Fatalf("write_todos should not require approval")
	}
	if IsMutatingForInvocation("write_todos", args) {
		t.Fatalf("write_todos should not be classified as mutating")
	}
	if IsDangerousInvocation("write_todos", args) {
		t.Fatalf("write_todos should not be dangerous")
	}
}
