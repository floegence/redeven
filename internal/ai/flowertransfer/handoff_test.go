package flowertransfer

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestBuildFlowerHandoffEnvelope_IsDeterministicAndValidatesHashes(t *testing.T) {
	t.Parallel()

	req := FlowerHandoffEnvelopeRequest{
		Source: FlowerHandoffEndpoint{
			EndpointID:   " env_src ",
			ThreadID:     " th_src ",
			RunID:        " run_src ",
			UserPublicID: " user_1 ",
		},
		Destination: FlowerHandoffEndpoint{
			EndpointID: "env_dest",
			ThreadID:   "th_dest",
		},
		Action: FlowerHandoffAction{
			ActionID:            " assistant.ask.flower ",
			Provider:            " flower ",
			SourceSurface:       " file_browser ",
			SourceSurfaceID:     " files-main ",
			SuggestedWorkingDir: " /workspace/app ",
			ContextJSON:         json.RawMessage(`{"b":2,"a":1}`),
		},
		TransferPlanHash: "sha256:" + "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		CreatedAtUnixMs:  1000,
		ExpiresAtUnixMs:  2000,
	}

	first, err := BuildFlowerHandoffEnvelope(req)
	if err != nil {
		t.Fatalf("BuildFlowerHandoffEnvelope: %v", err)
	}
	second, err := BuildFlowerHandoffEnvelope(req)
	if err != nil {
		t.Fatalf("BuildFlowerHandoffEnvelope second: %v", err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("handoff envelope is not deterministic:\nfirst=%#v\nsecond=%#v", first, second)
	}
	if first.EnvelopeID == "" || first.IdempotencyKey == "" || first.SemanticHash == "" || first.EnvelopeHash == "" {
		t.Fatalf("missing envelope identity: %#v", first)
	}
	if err := ValidateFlowerHandoffEnvelope(first); err != nil {
		t.Fatalf("ValidateFlowerHandoffEnvelope: %v", err)
	}
	if got := string(first.Action.ContextJSON); got != `{"a":1,"b":2}` {
		t.Fatalf("canonical context json=%s", got)
	}

	tampered := first
	tampered.Destination.ThreadID = "th_other"
	if err := ValidateFlowerHandoffEnvelope(tampered); err == nil {
		t.Fatalf("ValidateFlowerHandoffEnvelope accepted tampered envelope")
	}
}

func TestCompareFlowerHandoffEnvelope_DetectsIdempotencyAndCollision(t *testing.T) {
	t.Parallel()

	base, err := BuildFlowerHandoffEnvelope(FlowerHandoffEnvelopeRequest{
		Source:      FlowerHandoffEndpoint{EndpointID: "env_src", ThreadID: "th_src"},
		Destination: FlowerHandoffEndpoint{EndpointID: "env_dest", ThreadID: "th_dest"},
		Action:      FlowerHandoffAction{ActionID: "assistant.ask.flower", Provider: "flower"},
	})
	if err != nil {
		t.Fatalf("BuildFlowerHandoffEnvelope base: %v", err)
	}
	same, err := BuildFlowerHandoffEnvelope(FlowerHandoffEnvelopeRequest{
		Source:      FlowerHandoffEndpoint{EndpointID: "env_src", ThreadID: "th_src"},
		Destination: FlowerHandoffEndpoint{EndpointID: "env_dest", ThreadID: "th_dest"},
		Action:      FlowerHandoffAction{ActionID: "assistant.ask.flower", Provider: "flower"},
	})
	if err != nil {
		t.Fatalf("BuildFlowerHandoffEnvelope same: %v", err)
	}
	if got := CompareFlowerHandoffEnvelope(base, same); got.Status != HandoffCompareIdempotent {
		t.Fatalf("same compare=%#v, want idempotent", got)
	}

	collision := same
	collision.EnvelopeHash = "sha256:" + "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	if got := CompareFlowerHandoffEnvelope(base, collision); got.Status != HandoffCompareCollision {
		t.Fatalf("collision compare=%#v, want collision", got)
	}

	distinct, err := BuildFlowerHandoffEnvelope(FlowerHandoffEnvelopeRequest{
		Source:      FlowerHandoffEndpoint{EndpointID: "env_src", ThreadID: "th_src"},
		Destination: FlowerHandoffEndpoint{EndpointID: "env_dest", ThreadID: "th_other"},
		Action:      FlowerHandoffAction{ActionID: "assistant.ask.flower", Provider: "flower"},
	})
	if err != nil {
		t.Fatalf("BuildFlowerHandoffEnvelope distinct: %v", err)
	}
	if got := CompareFlowerHandoffEnvelope(base, distinct); got.Status != HandoffCompareDistinct {
		t.Fatalf("distinct compare=%#v, want distinct", got)
	}
}
