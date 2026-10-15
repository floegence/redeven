package ai

import (
	"encoding/json"
	"testing"

	"github.com/floegence/floret/v7/observation"
	flruntime "github.com/floegence/floret/v7/runtime"
	fltools "github.com/floegence/floret/v7/tools"
)

func computerEvidenceFixture() (flruntime.ThreadView, flruntime.ThreadInteraction) {
	source := flruntime.ThreadItem{ID: "result", TurnID: "turn", RunID: "run", Kind: flruntime.ThreadItemTool,
		Activity: &observation.ActivityItem{ToolID: "blocked", ToolName: "computer.screenshot", Status: observation.ActivityStatusError, Presentation: &fltools.ActivityPresentation{
			Renderer: fltools.ActivityRendererStructured, Label: "Capture the page",
			Chips:      []fltools.ActivityChip{{Kind: "computer_assistance", Value: "login"}},
			TargetRefs: []fltools.ActivityTargetRef{{Kind: "computer_control", ResourceRef: "target"}, {Kind: "computer_target", ResourceRef: "target"}},
		}}}
	interaction := flruntime.ThreadInteraction{ID: "ask", TurnID: "turn", RunID: "run", Kind: flruntime.ThreadInteractionInput, ToolCallID: "ask-login",
		Input: &flruntime.InputPresentation{ReasonCode: "missing_external_input", RequiredFromUser: []string{"ready"}, EvidenceRefs: []string{"blocked"}, Questions: []flruntime.InputQuestion{{ID: "ready", Prompt: "Complete sign-in on the page", Kind: "select", Options: []string{"Continue"}}}}}
	return flruntime.ThreadView{ThreadID: "thread", Items: []flruntime.ThreadItem{source}, Interactions: []flruntime.ThreadInteraction{interaction}}, interaction
}

func TestComputerInputEvidenceUsesOneCanonicalSource(t *testing.T) {
	for _, variant := range []string{"independent", "legacy", "missing", "partially-missing", "wrong-turn", "duplicate", "target-ambiguity", "stale", "words-only", "inspection"} {
		t.Run(variant, func(t *testing.T) {
			view, interaction := computerEvidenceFixture()
			switch variant {
			case "legacy":
				interaction.ID = "tool-input:result"
				interaction.ToolCallID = "blocked"
				interaction.Input.EvidenceRefs = nil
			case "missing":
				interaction.Input.EvidenceRefs = []string{"unavailable"}
			case "partially-missing":
				interaction.Input.EvidenceRefs = []string{"blocked", "missing"}
			case "wrong-turn":
				view.Items[0].TurnID = "other"
			case "duplicate":
				interaction.Input.EvidenceRefs = []string{"blocked", "blocked"}
			case "target-ambiguity":
				p := view.Items[0].Activity.Presentation
				p.TargetRefs = append(p.TargetRefs, fltools.ActivityTargetRef{Kind: "computer_control", ResourceRef: "other"})
			case "stale":
				next := view.Items[0]
				next.ID = "new"
				next.Activity = &observation.ActivityItem{ToolID: "next", ToolName: "computer.observe", Presentation: &fltools.ActivityPresentation{TargetRefs: []fltools.ActivityTargetRef{{Kind: "computer_target", ResourceRef: "target"}}}}
				view.Items = append(view.Items, next)
			case "words-only":
				interaction.Input.EvidenceRefs = nil
				interaction.Input.Summary = "computer_control target https://example.test"
			case "inspection":
				view.Items[0].Activity.Presentation.Chips[0].Value = "inspection"
			}
			evidence := resolveComputerInputEvidence(view, interaction)
			valid := variant == "independent" || variant == "legacy"
			if (evidence != nil) != valid {
				t.Fatalf("evidence=%+v valid=%t", evidence, valid)
			}
			if valid && (evidence.call.TargetID != "target" || evidence.call.ThreadID != "thread" || evidence.call.TurnID != "turn" || evidence.kind != "login") {
				t.Fatalf("lost canonical provenance: %+v", evidence)
			}
		})
	}
}

func TestComputerEvidenceProjectionPreservesIndependentQuestions(t *testing.T) {
	view, _ := computerEvidenceFixture()
	wire, err := flowerCurrentJSON(view)
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		Interactions []struct {
			ComputerAssistance *ComputerInputAssistance     `json:"computer_assistance"`
			Input              *flruntime.InputPresentation `json:"input"`
		} `json:"interactions"`
	}
	if err := json.Unmarshal(wire, &decoded); err != nil {
		t.Fatal(err)
	}
	if len(decoded.Interactions) != 1 || decoded.Interactions[0].ComputerAssistance == nil || decoded.Interactions[0].ComputerAssistance.ToolCallID != "blocked" || decoded.Interactions[0].Input.Questions[0].ID != "ready" || decoded.Interactions[0].Input.EvidenceRefs[0] != "blocked" {
		t.Fatalf("projection=%s", wire)
	}
}
