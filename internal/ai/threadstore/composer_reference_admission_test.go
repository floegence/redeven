package threadstore

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

type composerReferenceAdmissionFixture struct {
	path        string
	isDirectory bool
}

func composerReferenceActionJSONForTest(t *testing.T, references ...composerReferenceAdmissionFixture) string {
	t.Helper()
	items := make([]map[string]any, 0, len(references))
	for _, reference := range references {
		items = append(items, map[string]any{
			"kind": "file_path", "path": reference.path, "is_directory": reference.isDirectory,
		})
	}
	raw, err := json.Marshal(map[string]any{
		"schema_version": 2,
		"action_id":      "assistant.ask.flower",
		"provider":       "flower",
		"target":         map[string]any{"target_id": "current", "locality": "auto"},
		"source":         map[string]any{"surface": "flower_composer"},
		"context":        items,
		"presentation":   map[string]any{"label": "Ask Flower", "priority": 100},
	})
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func seedComposerReferenceAdmissionDraftForTest(
	t *testing.T,
	store *Store,
	endpointID, ownerHash, scopeID, turnID string,
	references ...composerReferenceAdmissionFixture,
) ComposerDraftRecord {
	t.Helper()
	lease, err := store.AcquireComposerDraftLease(t.Context(), endpointID, ownerHash, scopeID, "surface_references", false, 1_000)
	if err != nil {
		t.Fatal(err)
	}
	draftReferences := make([]map[string]any, 0, len(references))
	for index, reference := range references {
		kind := "file"
		if reference.isDirectory {
			kind = "directory"
		}
		draftReferences = append(draftReferences, map[string]any{
			"local_id": "reference_" + string(rune('a'+index)),
			"kind":     kind,
			"label":    ComposerReferencePathLabel(reference.path),
			"path":     reference.path,
		})
	}
	raw, err := json.Marshal(map[string]any{
		"text": "review references", "attachments": []any{}, "references": draftReferences,
		"mode": ComposerDraftModeAdmissionInFlight, "model_id": "openai/model",
		"admission_started": true, "proposed_turn_id": turnID,
	})
	if err != nil {
		t.Fatal(err)
	}
	draft, err := store.MutateComposerDraft(t.Context(), ComposerDraftMutation{
		EndpointID: endpointID, OwnerUserHash: ownerHash, ScopeID: scopeID,
		HolderID: "surface_references", LeaseID: lease.Draft.LeaseID, ExpectedRevision: lease.Draft.Revision,
		Value: raw, NowUnixMs: 1_001,
	})
	if err != nil {
		t.Fatal(err)
	}
	return draft
}

func composerReferenceQueuedTurnForTest(endpointID, threadID, queueID, turnID, contextActionJSON string) QueuedTurn {
	return QueuedTurn{
		QueueID: queueID, EndpointID: endpointID, ThreadID: threadID, ChannelID: "channel_references",
		Lane: FollowupLaneQueued, TurnID: turnID, RunID: "run_" + queueID, ModelID: "openai/model",
		TextContent: "review references", AttachmentsJSON: "[]", ContextActionJSON: contextActionJSON,
		OptionsJSON: "{}", SessionMetaJSON: "{}", CreatedAtUnixMs: 2_000,
	}
}

func composerReferenceAdmissionForTest(ownerHash, scopeID string, revision int64, contextActionJSON string) ComposerDraftAdmission {
	return ComposerDraftAdmission{
		OwnerUserHash: ownerHash, DraftID: scopeID, ExpectedRevision: revision, ContextActionJSON: contextActionJSON,
		Attachment: attachmentAdmissionForTest(ownerHash, strings.Repeat("c", 64), map[string]string{}),
	}
}

func TestComposerReferenceAdmissionCreatesAndDeletesDraftAtomically(t *testing.T) {
	t.Parallel()
	store := openStoreForTest(t)
	const endpointID = "env_reference_create"
	const threadID = "thread_reference_create"
	const turnID = "turn_reference_create"
	ownerHash := strings.Repeat("a", 64)
	if err := store.CreateThreadSettings(t.Context(), ThreadSettings{EndpointID: endpointID, ThreadID: threadID, PermissionType: "approval_required"}); err != nil {
		t.Fatal(err)
	}
	references := []composerReferenceAdmissionFixture{{path: "/workspace/main.go"}, {path: "/workspace/src", isDirectory: true}}
	draft := seedComposerReferenceAdmissionDraftForTest(t, store, endpointID, ownerHash, threadID, turnID, references...)
	actionJSON := composerReferenceActionJSONForTest(t, references...)
	queued, _, _, err := store.CreateFollowupFromComposerDraft(
		t.Context(), composerReferenceQueuedTurnForTest(endpointID, threadID, "queue_reference_create", turnID, actionJSON), nil, 2_000,
		composerReferenceAdmissionForTest(ownerHash, threadID, draft.Revision, actionJSON),
	)
	if err != nil {
		t.Fatal(err)
	}
	if queued.ContextActionJSON != actionJSON {
		t.Fatalf("queued context action=%q", queued.ContextActionJSON)
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_composer_drafts WHERE endpoint_id = ? AND owner_user_hash = ? AND scope_id = ?`, endpointID, ownerHash, threadID) != 0 {
		t.Fatal("successful reference admission retained draft")
	}
}

func TestComposerReferenceAdmissionRejectsChangedProjectionWithoutSideEffects(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name                  string
		action                []composerReferenceAdmissionFixture
		surface               string
		mismatchAdmissionJSON bool
	}{
		{name: "path", action: []composerReferenceAdmissionFixture{{path: "/workspace/other.go"}, {path: "/workspace/src", isDirectory: true}}},
		{name: "order", action: []composerReferenceAdmissionFixture{{path: "/workspace/src", isDirectory: true}, {path: "/workspace/main.go"}}},
		{name: "directory bit", action: []composerReferenceAdmissionFixture{{path: "/workspace/main.go", isDirectory: true}, {path: "/workspace/src", isDirectory: true}}},
		{name: "missing", action: []composerReferenceAdmissionFixture{{path: "/workspace/main.go"}}},
		{name: "non composer source", action: []composerReferenceAdmissionFixture{{path: "/workspace/main.go"}, {path: "/workspace/src", isDirectory: true}}, surface: "file_browser"},
		{name: "admission json differs from record", action: []composerReferenceAdmissionFixture{{path: "/workspace/main.go"}, {path: "/workspace/src", isDirectory: true}}, mismatchAdmissionJSON: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := openStoreForTest(t)
			endpointID := "env_reference_" + strings.ReplaceAll(test.name, " ", "_")
			threadID := "thread_reference_" + strings.ReplaceAll(test.name, " ", "_")
			turnID := "turn_reference_" + strings.ReplaceAll(test.name, " ", "_")
			ownerHash := strings.Repeat("b", 64)
			if err := store.CreateThreadSettings(t.Context(), ThreadSettings{EndpointID: endpointID, ThreadID: threadID, PermissionType: "approval_required"}); err != nil {
				t.Fatal(err)
			}
			draftReferences := []composerReferenceAdmissionFixture{{path: "/workspace/main.go"}, {path: "/workspace/src", isDirectory: true}}
			draft := seedComposerReferenceAdmissionDraftForTest(t, store, endpointID, ownerHash, threadID, turnID, draftReferences...)
			actionJSON := composerReferenceActionJSONForTest(t, test.action...)
			if test.surface != "" {
				var action map[string]any
				if err := json.Unmarshal([]byte(actionJSON), &action); err != nil {
					t.Fatal(err)
				}
				action["source"] = map[string]any{"surface": test.surface}
				raw, err := json.Marshal(action)
				if err != nil {
					t.Fatal(err)
				}
				actionJSON = string(raw)
			}
			admissionJSON := actionJSON
			if test.mismatchAdmissionJSON {
				admissionJSON = composerReferenceActionJSONForTest(t, composerReferenceAdmissionFixture{path: "/workspace/different.go"})
			}
			rec := composerReferenceQueuedTurnForTest(endpointID, threadID, "queue_rejected", turnID, actionJSON)
			_, _, _, err := store.CreateFollowupFromComposerDraft(
				t.Context(), rec, nil, 2_000,
				composerReferenceAdmissionForTest(ownerHash, threadID, draft.Revision, admissionJSON),
			)
			if err == nil {
				t.Fatal("changed composer reference admission was accepted")
			}
			if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_queued_turns WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID) != 0 ||
				countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_composer_drafts WHERE endpoint_id = ? AND owner_user_hash = ? AND scope_id = ?`, endpointID, ownerHash, threadID) != 1 {
				t.Fatal("rejected reference admission had transactional side effects")
			}
		})
	}
}

func TestComposerReferenceAdmissionReplacementIsAtomic(t *testing.T) {
	t.Parallel()
	store := openStoreForTest(t)
	const endpointID = "env_reference_replace"
	const threadID = "thread_reference_replace"
	const turnID = "turn_reference_replace"
	ownerHash := strings.Repeat("d", 64)
	if err := store.CreateThreadSettings(t.Context(), ThreadSettings{EndpointID: endpointID, ThreadID: threadID, PermissionType: "approval_required"}); err != nil {
		t.Fatal(err)
	}
	source, _, _, err := store.CreateFollowup(t.Context(), composerReferenceQueuedTurnForTest(endpointID, threadID, "queue_reference_source", "turn_reference_source", ""))
	if err != nil {
		t.Fatal(err)
	}
	references := []composerReferenceAdmissionFixture{{path: "/workspace/main.go"}}
	draft := seedComposerReferenceAdmissionDraftForTest(t, store, endpointID, ownerHash, threadID, turnID, references...)
	actionJSON := composerReferenceActionJSONForTest(t, references...)
	result, err := store.ReplaceFollowupFromComposerDraft(
		t.Context(), source.QueueID,
		composerReferenceQueuedTurnForTest(endpointID, threadID, "queue_reference_replacement", turnID, actionJSON), nil, 2_000,
		composerReferenceAdmissionForTest(ownerHash, threadID, draft.Revision, actionJSON),
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.Queued.QueueID != "queue_reference_replacement" {
		t.Fatalf("replacement=%#v", result)
	}
	if original, err := store.GetQueuedTurn(t.Context(), endpointID, threadID, source.QueueID); !errors.Is(err, sql.ErrNoRows) || original != nil {
		t.Fatalf("source after replacement=%#v err=%v", original, err)
	}
	if countRowsForTest(t, store.db, `SELECT COUNT(1) FROM ai_composer_drafts WHERE endpoint_id = ? AND owner_user_hash = ? AND scope_id = ?`, endpointID, ownerHash, threadID) != 0 {
		t.Fatal("successful replacement retained draft")
	}
}
