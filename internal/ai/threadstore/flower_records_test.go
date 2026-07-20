package threadstore

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/ai/flowertransfer"
)

func TestStore_FlowerThreadMetadataTransferAndHandoffRoundTrip(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThreadSettings(ctx, ThreadSettings{ThreadID: "th_src", EndpointID: "env_1", PermissionType: "approval_required"}); err != nil {
		t.Fatalf("CreateThread source: %v", err)
	}
	if err := s.CreateThreadSettings(ctx, ThreadSettings{ThreadID: "th_dest", EndpointID: "env_1", PermissionType: "approval_required"}); err != nil {
		t.Fatalf("CreateThread dest: %v", err)
	}

	if err := s.UpsertFlowerThreadMetadata(ctx, FlowerThreadMetadata{
		EndpointID:          "env_1",
		ThreadID:            "th_dest",
		OwnerKind:           "handoff",
		OwnerID:             "handoff_1",
		ParentThreadID:      "th_src",
		ParentRunID:         "run_src",
		ContextJSON:         `{"source":"files"}`,
		ActionJSON:          `{"action_id":"assistant.ask.flower"}`,
		HomeRuntimeID:       "local-environment:test",
		HomeRuntimeKind:     "local_environment",
		OriginEnvPublicID:   "env_a",
		PrimaryTargetID:     "provider:https%3A%2F%2Fredeven.test:env:env_a",
		ActiveTargetIDsJSON: `["provider:https%3A%2F%2Fredeven.test:env:env_a"]`,
		UpdatedAtUnixMs:     100,
	}); err != nil {
		t.Fatalf("UpsertFlowerThreadMetadata: %v", err)
	}
	meta, err := s.GetFlowerThreadMetadata(ctx, "env_1", "th_dest")
	if err != nil {
		t.Fatalf("GetFlowerThreadMetadata: %v", err)
	}
	if meta == nil || meta.OwnerKind != "handoff" || meta.ParentThreadID != "th_src" || meta.ContextJSON == "" {
		t.Fatalf("unexpected metadata: %#v", meta)
	}
	if meta.HomeRuntimeID != "local-environment:test" || meta.HomeRuntimeKind != "local_environment" || meta.PrimaryTargetID != "provider:https%3A%2F%2Fredeven.test:env:env_a" {
		t.Fatalf("unexpected ownership metadata: %#v", meta)
	}

	plan, err := flowertransfer.BuildTransferPlan(flowertransfer.TransferManifest{
		SourceEndpoint: "env_1",
		SourceThreadID: "th_src",
		SourceRunID:    "run_src",
		Items: []flowertransfer.TransferManifestItem{
			{ItemID: "file", Kind: "file", RelativePath: "note.txt", SizeBytes: 4, SHA256: "abcd"},
		},
	}, flowertransfer.TransferDestination{EndpointID: "env_1", ThreadID: "th_dest", RootPath: "/workspace"}, flowertransfer.TransferPolicy{})
	if err != nil {
		t.Fatalf("BuildTransferPlan: %v", err)
	}
	planJSON, err := json.Marshal(plan)
	if err != nil {
		t.Fatalf("json.Marshal plan: %v", err)
	}
	transfer, err := s.InsertFlowerTransfer(ctx, FlowerTransferRecord{
		TransferID:          "transfer_1",
		EndpointID:          "env_1",
		SourceThreadID:      "th_src",
		DestinationThreadID: "th_dest",
		IdempotencyKey:      plan.ApprovalHash,
		ManifestHash:        plan.ManifestHash,
		ApprovalHash:        plan.ApprovalHash,
		PlanJSON:            string(planJSON),
		CreatedAtUnixMs:     101,
		UpdatedAtUnixMs:     101,
	})
	if err != nil {
		t.Fatalf("InsertFlowerTransfer: %v", err)
	}
	transferAgain, err := s.InsertFlowerTransfer(ctx, FlowerTransferRecord{
		TransferID:          "transfer_1_replay",
		EndpointID:          "env_1",
		SourceThreadID:      "th_src",
		DestinationThreadID: "th_dest",
		IdempotencyKey:      plan.ApprovalHash,
		ManifestHash:        plan.ManifestHash,
		ApprovalHash:        plan.ApprovalHash,
		PlanJSON:            string(planJSON),
		CreatedAtUnixMs:     102,
		UpdatedAtUnixMs:     102,
	})
	if err != nil {
		t.Fatalf("InsertFlowerTransfer replay: %v", err)
	}
	if transferAgain.TransferID != transfer.TransferID {
		t.Fatalf("idempotent transfer returned %q, want %q", transferAgain.TransferID, transfer.TransferID)
	}
	_, err = s.InsertFlowerTransfer(ctx, FlowerTransferRecord{
		TransferID:          "transfer_collision",
		EndpointID:          "env_1",
		SourceThreadID:      "th_src",
		DestinationThreadID: "th_dest",
		IdempotencyKey:      plan.ApprovalHash,
		ManifestHash:        plan.ManifestHash,
		ApprovalHash:        plan.ApprovalHash,
		PlanJSON:            `{"different":true}`,
	})
	if !errors.Is(err, ErrFlowerIdempotencyCollision) {
		t.Fatalf("collision err=%v, want %v", err, ErrFlowerIdempotencyCollision)
	}

	env, err := flowertransfer.BuildFlowerHandoffEnvelope(flowertransfer.FlowerHandoffEnvelopeRequest{
		Source:           flowertransfer.FlowerHandoffEndpoint{EndpointID: "env_1", ThreadID: "th_src", RunID: "run_src"},
		Destination:      flowertransfer.FlowerHandoffEndpoint{EndpointID: "env_1", ThreadID: "th_dest"},
		Action:           flowertransfer.FlowerHandoffAction{ActionID: "assistant.ask.flower", Provider: "flower"},
		TransferPlanHash: plan.ApprovalHash,
		CreatedAtUnixMs:  103,
	})
	if err != nil {
		t.Fatalf("BuildFlowerHandoffEnvelope: %v", err)
	}
	envJSON, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("json.Marshal envelope: %v", err)
	}
	handoff, err := s.InsertFlowerHandoff(ctx, FlowerHandoffRecord{
		HandoffID:           env.EnvelopeID,
		EndpointID:          "env_1",
		SourceThreadID:      "th_src",
		DestinationThreadID: "th_dest",
		IdempotencyKey:      env.IdempotencyKey,
		EnvelopeHash:        env.EnvelopeHash,
		EnvelopeJSON:        string(envJSON),
		CreatedAtUnixMs:     103,
		UpdatedAtUnixMs:     103,
	})
	if err != nil {
		t.Fatalf("InsertFlowerHandoff: %v", err)
	}
	handoffAgain, err := s.InsertFlowerHandoff(ctx, FlowerHandoffRecord{
		HandoffID:           env.EnvelopeID + "_replay",
		EndpointID:          "env_1",
		SourceThreadID:      "th_src",
		DestinationThreadID: "th_dest",
		IdempotencyKey:      env.IdempotencyKey,
		EnvelopeHash:        env.EnvelopeHash,
		EnvelopeJSON:        string(envJSON),
	})
	if err != nil {
		t.Fatalf("InsertFlowerHandoff replay: %v", err)
	}
	if handoffAgain.HandoffID != handoff.HandoffID {
		t.Fatalf("idempotent handoff returned %q, want %q", handoffAgain.HandoffID, handoff.HandoffID)
	}
}
