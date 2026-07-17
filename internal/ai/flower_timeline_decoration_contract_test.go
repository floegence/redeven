package ai

import (
	"encoding/json"
	"testing"
)

func TestFlowerTimelineDecorationRejectsPayloadKindMismatchEvenWhenPayloadIsEmpty(t *testing.T) {
	t.Parallel()

	for _, raw := range []string{
		`{"decoration_id":"unavailable:1","kind":"turn_projection_unavailable","anchor":{"target_kind":"message","message_id":"user-1","edge":"after"},"ordinal":0,"compaction":{},"projection_unavailable":{"turn_id":"turn-1","run_id":"run-1","expected_message_id":"assistant-1","reason":"not_renderable"}}`,
		`{"decoration_id":"compaction:1","kind":"context_compaction","anchor":{"target_kind":"message","message_id":"assistant-1","edge":"before"},"ordinal":0,"compaction":{"operation_id":"compact-1","phase":"complete","status":"compacted","updated_at_ms":1},"projection_unavailable":null}`,
	} {
		var decoration FlowerTimelineDecoration
		if err := json.Unmarshal([]byte(raw), &decoration); err == nil {
			t.Fatalf("json.Unmarshal(%s) succeeded, want payload/kind mismatch", raw)
		}
	}
}

func TestFlowerTimelineDecorationRoundTripsUnavailablePayload(t *testing.T) {
	t.Parallel()

	decoration := FlowerTimelineDecoration{
		DecorationID: "unavailable:turn-1",
		Kind:         FlowerTimelineDecorationTurnProjectionUnavailable,
		Anchor:       FlowerTimelineAnchor{TargetKind: "message", MessageID: "user-1", Edge: "after"},
		ProjectionUnavailable: &FlowerTurnProjectionUnavailable{
			TurnID:            "turn-1",
			RunID:             "run-1",
			ExpectedMessageID: "assistant-1",
			Reason:            FlowerTurnProjectionUnavailableNotRenderable,
		},
	}
	raw, err := json.Marshal(decoration)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	var decoded FlowerTimelineDecoration
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("json.Unmarshal: %v", err)
	}
	if decoded.Kind != decoration.Kind || decoded.ProjectionUnavailable == nil || decoded.ProjectionUnavailable.ExpectedMessageID != "assistant-1" {
		t.Fatalf("decoded=%+v", decoded)
	}
}
