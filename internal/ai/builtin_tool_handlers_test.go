package ai

import (
	"strings"
	"testing"
)

func TestBuiltInToolDefinitions_AskUserDescriptionMentionsStructuredInput(t *testing.T) {
	t.Parallel()

	defs := builtInToolDefinitions()
	for _, def := range defs {
		if strings.TrimSpace(def.Name) != "ask_user" {
			continue
		}
		if !strings.Contains(def.Description, "required structured input") {
			t.Fatalf("ask_user description missing structured-input guidance: %q", def.Description)
		}
		if !strings.Contains(def.Description, "guided interaction turn") {
			t.Fatalf("ask_user description missing guided interaction guidance: %q", def.Description)
		}
		if !strings.Contains(def.Description, "Each question must declare response_mode") {
			t.Fatalf("ask_user description missing response_mode guidance: %q", def.Description)
		}
		if !strings.Contains(def.Description, "choices_exhaustive") {
			t.Fatalf("ask_user description missing choices_exhaustive guidance: %q", def.Description)
		}
		if !strings.Contains(def.Description, "Preserve explicit interaction-shape constraints from the user") {
			t.Fatalf("ask_user description missing interaction-shape guidance: %q", def.Description)
		}
		if !strings.Contains(def.Description, "choices[] should contain fixed options only") {
			t.Fatalf("ask_user description missing fixed-choice-only guidance: %q", def.Description)
		}
		if !strings.Contains(def.Description, "Do not use it to delegate tool-collectable work") {
			t.Fatalf("ask_user description missing collectable-work rejection: %q", def.Description)
		}
		return
	}

	t.Fatalf("ask_user tool definition not found")
}
