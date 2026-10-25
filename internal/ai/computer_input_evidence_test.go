package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"github.com/floegence/floret/v7/identity"
	"github.com/floegence/floret/v7/observation"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/threadquery"
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

func TestFlowerComputerEvidenceReadsOnlyBoundedSafetyFacts(t *testing.T) {
	for _, variant := range []string{"current", "superseded", "moving-path", "changed-during-fields", "canceled"} {
		t.Run(variant, func(t *testing.T) {
			full, interaction := computerEvidenceFixture()
			blocked := full.Items[0]
			later := flruntime.ThreadItem{ID: "later", TurnID: interaction.TurnID, Kind: flruntime.ThreadItemTool,
				Activity: &observation.ActivityItem{ToolName: "computer.observe", Presentation: &fltools.ActivityPresentation{}}}
			if variant == "superseded" {
				later.Activity.Presentation.TargetRefs = []fltools.ActivityTargetRef{{Kind: "computer_target", ResourceRef: "target"}}
			}
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			if variant == "canceled" {
				cancel()
			}
			reads, resolved := 0, 0
			view, err := readFlowerComputerEvidence(ctx, full.ThreadID, []flruntime.ThreadInteraction{interaction},
				func(ctx context.Context, input flruntime.ThreadWindowInput) (flruntime.ThreadView, *FlowerHistoryWindow, error) {
					if err := ctx.Err(); err != nil {
						return flruntime.ThreadView{}, nil, err
					}
					reads++
					if reads == 3 && input.Limit == 1 {
						version := uint64(7)
						if variant == "changed-during-fields" {
							version++
						}
						return flruntime.ThreadView{ThreadID: full.ThreadID, ViewVersion: version}, &FlowerHistoryWindow{LeafID: "leaf"}, nil
					}
					if input.Limit != 64 || !input.ActivityFields || input.PreviewBytes != 128 || input.IncludeSummary {
						t.Fatalf("unbounded input: %+v", input)
					}
					page := flruntime.ThreadView{ThreadID: full.ThreadID, ViewVersion: 7}
					window := &FlowerHistoryWindow{LeafID: "leaf", FirstItemID: "later", HasBefore: true}
					if reads == 1 {
						page.Items = []flruntime.ThreadItem{later}
					} else {
						if input.AnchorID != "later" {
							t.Fatal("missing stable anchor")
						}
						page.Items = []flruntime.ThreadItem{{ID: "user", TurnID: interaction.TurnID, Kind: flruntime.ThreadItemUser}, blocked}
						if variant == "moving-path" {
							window.LeafID = "changed"
						}
					}
					if reads > 2 {
						t.Fatal("read unrelated older turns")
					}
					return page, window, nil
				}, func(_ context.Context, item flruntime.ThreadItem) (flruntime.ThreadItem, error) {
					resolved++
					return item, nil
				})
			if variant == "moving-path" || variant == "changed-during-fields" {
				if !errors.Is(err, threadquery.ErrRecordUnavailable) {
					t.Fatal(err)
				}
				return
			}
			if variant == "canceled" {
				if !errors.Is(err, context.Canceled) {
					t.Fatal(err)
				}
				return
			}
			if err != nil || reads != 3 || resolved != 2 {
				t.Fatalf("reads=%d resolved=%d err=%v", reads, resolved, err)
			}
			if (resolveComputerInputEvidence(*view, interaction) != nil) != (variant == "current") {
				t.Fatal("lost ordered supersession semantics")
			}
		})
	}
}

type computerSafetyValueRuntime struct {
	flruntime.ThreadService
	read func(context.Context, threadquery.Scope, flruntime.ThreadActivityValueInput) (flruntime.ThreadActivityValue, error)
}

func (r computerSafetyValueRuntime) ReadActivityValue(ctx context.Context, scope threadquery.Scope, input flruntime.ThreadActivityValueInput) (flruntime.ThreadActivityValue, error) {
	return r.read(ctx, scope, input)
}

func TestFlowerComputerEvidenceResolvesOmittedSafetyCollections(t *testing.T) {
	for _, changed := range []bool{false, true} {
		t.Run(fmt.Sprint(changed), func(t *testing.T) {
			full, _ := computerEvidenceFixture()
			item := full.Items[0]
			item.ActivitySummary = &flruntime.ThreadActivitySummary{Fields: []flruntime.ThreadActivityField{{Path: "/chips", Kind: "array", Count: 2}, {Path: "/target_refs", Kind: "array", Count: 2}}}
			calls := 0
			scope := threadquery.Scope{Authority: "authorized", ThreadIDs: []identity.ThreadID{full.ThreadID}}
			values := map[string]string{"/chips/0": "{\"kind\":\"computer_assistance\",\"value\":\"login\"}", "/chips/1": "{\"kind\":\"label\",\"value\":\"Other\"}", "/target_refs/0": "{\"kind\":\"computer_control\",\"resource_ref\":\"target\"}", "/target_refs/1": "{\"kind\":\"computer_target\",\"resource_ref\":\"target\"}"}
			svc := &Service{threadRuntime: computerSafetyValueRuntime{read: func(ctx context.Context, got threadquery.Scope, input flruntime.ThreadActivityValueInput) (flruntime.ThreadActivityValue, error) {
				calls++
				if got.Authority != scope.Authority || input.ThreadID != full.ThreadID || input.ItemID != item.ID || input.MaximumBytes != 64<<10 || input.MaximumNodes != 16 {
					t.Fatalf("unbounded or unauthorized member read: %+v", input)
				}
				raw, ok := values[input.Path]
				if !ok {
					t.Fatalf("unexpected safety member %q", input.Path)
				}
				value := flruntime.ThreadActivityValue{ThreadID: full.ThreadID, ItemID: item.ID, TurnID: item.TurnID, RunID: item.RunID, Path: input.Path, Value: json.RawMessage(raw)}
				if changed {
					value.RunID = "different-run"
				}
				return value, nil
			}}}
			result, err := svc.flowerComputerEvidenceItem(t.Context(), scope, full.ThreadID, item)
			if changed {
				if !errors.Is(err, threadquery.ErrRecordUnavailable) {
					t.Fatalf("changed safety source: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if calls != 4 || len(result.Activity.Presentation.Chips) != 2 || len(result.Activity.Presentation.TargetRefs) != 2 || result.ActivitySummary != nil {
				t.Fatalf("lost omitted safety facts: calls=%d item=%+v", calls, result)
			}
		})
	}
}
