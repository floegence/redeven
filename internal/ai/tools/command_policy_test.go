package tools

import "testing"

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

func TestInvocationPolicies_TerminalExec(t *testing.T) {
	t.Parallel()

	readonlyArgs := map[string]any{"command": "pwd"}
	if RequiresApprovalForInvocation("terminal.exec", readonlyArgs) {
		t.Fatalf("readonly command should not require approval")
	}
	if IsMutatingForInvocation("terminal.exec", readonlyArgs) {
		t.Fatalf("readonly command should not be mutating")
	}
	if IsDangerousInvocation("terminal.exec", readonlyArgs) {
		t.Fatalf("readonly command should not be dangerous")
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
