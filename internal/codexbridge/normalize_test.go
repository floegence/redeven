package codexbridge

import (
	"encoding/json"
	"testing"
)

func TestNormalizeItem_UsesContentTextWhenDirectTextMissing(t *testing.T) {
	t.Parallel()

	item := normalizeItem(wireThreadItem{
		ID:   "item_1",
		Type: "userMessage",
		Content: []wireUserInput{
			{Type: "text", Text: "first line"},
			{Type: "local_image", Path: "/tmp/image.png"},
			{Type: "text", Text: "second line"},
		},
	})

	if item.Text != "first line\n\n/tmp/image.png\n\nsecond line" {
		t.Fatalf("Text=%q", item.Text)
	}
	if len(item.Inputs) != 3 {
		t.Fatalf("Inputs len=%d, want=3", len(item.Inputs))
	}
}

func TestNormalizeAvailableDecisions_DeduplicatesAndNormalizesValues(t *testing.T) {
	t.Parallel()

	raw := []json.RawMessage{
		json.RawMessage(`"accept"`),
		json.RawMessage(`"acceptForSession"`),
		json.RawMessage(`"decline"`),
		json.RawMessage(`{"acceptWithExecpolicyAmendment":{}}`),
		json.RawMessage(`"accept"`),
		json.RawMessage(`"cancel"`),
	}

	got := normalizeAvailableDecisions(raw)
	want := []string{"accept", "accept_for_session", "decline", "cancel"}
	if len(got) != len(want) {
		t.Fatalf("len(got)=%d, want=%d; got=%v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got[%d]=%q, want=%q (all=%v)", i, got[i], want[i], got)
		}
	}
}

func TestNormalizePermissionProfile_ReturnsNilWhenEmpty(t *testing.T) {
	t.Parallel()

	if got := normalizePermissionProfile(&wirePermissionProfile{}); got != nil {
		t.Fatalf("expected nil profile, got=%+v", got)
	}

	enabled := true
	got := normalizePermissionProfile(&wirePermissionProfile{
		Network: &wireAdditionalNetworkPermissions{Enabled: &enabled},
		FileSystem: &wireAdditionalFileSystemPermissions{
			Read:  []string{"/workspace/readme.md"},
			Write: []string{"/workspace"},
		},
	})
	if got == nil {
		t.Fatalf("expected non-nil profile")
	}
	if len(got.FileSystemRead) != 1 || got.FileSystemRead[0] != "/workspace/readme.md" {
		t.Fatalf("unexpected read permissions: %+v", got.FileSystemRead)
	}
	if len(got.FileSystemWrite) != 1 || got.FileSystemWrite[0] != "/workspace" {
		t.Fatalf("unexpected write permissions: %+v", got.FileSystemWrite)
	}
	if got.NetworkEnabled == nil || !*got.NetworkEnabled {
		t.Fatalf("expected network_enabled=true, got=%v", got.NetworkEnabled)
	}
}

func TestNormalizeThreadRuntimeConfig_UsesActualRuntimeFields(t *testing.T) {
	t.Parallel()

	effort := "high"
	got := normalizeThreadRuntimeConfig(
		"gpt-5.4",
		"openai",
		"/workspace/ui",
		json.RawMessage(`"on-request"`),
		"human",
		wireSandboxPolicy{Type: "workspaceWrite"},
		&effort,
	)

	if got.Model != "gpt-5.4" {
		t.Fatalf("Model=%q", got.Model)
	}
	if got.ModelProvider != "openai" {
		t.Fatalf("ModelProvider=%q", got.ModelProvider)
	}
	if got.CWD != "/workspace/ui" {
		t.Fatalf("CWD=%q", got.CWD)
	}
	if got.ApprovalPolicy != "on-request" {
		t.Fatalf("ApprovalPolicy=%q", got.ApprovalPolicy)
	}
	if got.ApprovalsReviewer != "human" {
		t.Fatalf("ApprovalsReviewer=%q", got.ApprovalsReviewer)
	}
	if got.SandboxMode != "workspace-write" {
		t.Fatalf("SandboxMode=%q", got.SandboxMode)
	}
	if got.ReasoningEffort != "high" {
		t.Fatalf("ReasoningEffort=%q", got.ReasoningEffort)
	}
}

func TestNormalizeCapabilitiesParts_KeepModelAndRequirementSemantics(t *testing.T) {
	t.Parallel()

	model := normalizeModelOption(wireModel{
		ID:                     "gpt-5.4",
		DisplayName:            "GPT-5.4",
		Description:            "Default host model",
		IsDefault:              true,
		DefaultReasoningEffort: "medium",
		SupportedReasoningEfforts: []wireReasoningEffortOption{
			{ReasoningEffort: "low"},
			{ReasoningEffort: "medium"},
			{ReasoningEffort: "high"},
			{ReasoningEffort: "medium"},
		},
		InputModalities: []string{"text", "image"},
	})
	if model.ID != "gpt-5.4" || model.DisplayName != "GPT-5.4" {
		t.Fatalf("unexpected model: %+v", model)
	}
	if !model.SupportsImageInput {
		t.Fatalf("expected image input support")
	}
	if len(model.SupportedReasoningEfforts) != 3 {
		t.Fatalf("unexpected supported efforts: %+v", model.SupportedReasoningEfforts)
	}

	requirements := normalizeConfigRequirements(&wireConfigRequirements{
		AllowedApprovalPolicies: []json.RawMessage{
			json.RawMessage(`"on-request"`),
			json.RawMessage(`{"granular":{}}`),
			json.RawMessage(`"on-request"`),
		},
		AllowedSandboxModes: []string{"workspaceWrite", "dangerFullAccess", "workspaceWrite"},
	})
	if requirements == nil {
		t.Fatalf("expected requirements")
	}
	if len(requirements.AllowedApprovalPolicies) != 2 {
		t.Fatalf("unexpected approval policies: %+v", requirements.AllowedApprovalPolicies)
	}
	if requirements.AllowedApprovalPolicies[1] != "granular" {
		t.Fatalf("unexpected normalized approval policies: %+v", requirements.AllowedApprovalPolicies)
	}
	if len(requirements.AllowedSandboxModes) != 2 {
		t.Fatalf("unexpected sandbox modes: %+v", requirements.AllowedSandboxModes)
	}
	if requirements.AllowedSandboxModes[0] != "workspace-write" || requirements.AllowedSandboxModes[1] != "danger-full-access" {
		t.Fatalf("unexpected normalized sandbox modes: %+v", requirements.AllowedSandboxModes)
	}
}
