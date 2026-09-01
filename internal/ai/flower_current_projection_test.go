package ai

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

func TestStopThreadResponseIsAcknowledgementOnly(t *testing.T) {
	typeOfResponse := reflect.TypeOf(StopThreadResponse{})
	if typeOfResponse.NumField() != 1 || typeOfResponse.Field(0).Name != "OK" || typeOfResponse.Field(0).Tag.Get("json") != "ok" {
		t.Fatalf("stop response fields=%#v, want acknowledgement-only OK field", typeOfResponse)
	}
	encoded, err := json.Marshal(StopThreadResponse{OK: true})
	if err != nil {
		t.Fatal(err)
	}
	if string(encoded) != `{"ok":true}` {
		t.Fatalf("stop response=%s, want acknowledgement only", encoded)
	}
}

func TestFlowerCurrentJSONProjectsUnknownEffectFailureWithoutExposingRawError(t *testing.T) {
	rawError := "Tool side effects could not be confirmed. The turn was stopped to avoid duplicate execution."
	outcome := flruntime.TurnOutcomeFailed
	encoded, err := flowerCurrentJSON(flruntime.ThreadView{
		ThreadID:    identity.ThreadID("thread-authority-failure"),
		LastOutcome: &outcome,
		Failure:     &flruntime.ThreadTurnFailure{Code: flruntime.ThreadTurnFailureEffectOutcomeUnknown, Message: rawError},
	})
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(encoded, &got); err != nil {
		t.Fatal(err)
	}
	if got["run_error_code"] != runErrorCodeFloretEffectOutcomeUnknown {
		t.Fatalf("run_error_code=%#v", got["run_error_code"])
	}
	message, _ := got["error"].(string)
	if message == "" || strings.Contains(strings.ToLower(message), "tool side effects") {
		t.Fatalf("projected error=%q exposed raw authority failure", message)
	}
}

func TestFlowerCurrentJSONConsumesTypedFailureWithoutExposingFloretPayload(t *testing.T) {
	rawError := "provider attempt superseded with pending canonical tool batch"
	outcome := flruntime.TurnOutcomeFailed
	encoded, err := flowerCurrentJSON(flruntime.ThreadView{
		ThreadID:    identity.ThreadID("thread-typed-engine-failure"),
		LastOutcome: &outcome,
		Failure: &flruntime.ThreadTurnFailure{
			Code:    flruntime.ThreadTurnFailureEngineContract,
			Message: rawError,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(encoded, &got); err != nil {
		t.Fatal(err)
	}
	if got["run_error_code"] != runErrorCodeFloretEngineFailed {
		t.Fatalf("run_error_code=%#v", got["run_error_code"])
	}
	if _, exists := got["failure"]; exists {
		t.Fatalf("typed Floret failure crossed the Flower UI boundary: %#v", got["failure"])
	}
	message, _ := got["error"].(string)
	if message == "" || strings.Contains(strings.ToLower(message), "pending canonical tool batch") {
		t.Fatalf("projected error=%q exposed raw engine failure", message)
	}
}

func TestTypedFailureProjectionIsConsistentAcrossCurrentAndSummaryPaths(t *testing.T) {
	outcome := flruntime.TurnOutcomeFailed
	failure := &flruntime.ThreadTurnFailure{
		Code:    flruntime.ThreadTurnFailureEffectOutcomeUnknown,
		Message: "private effect dispatch state",
	}
	current := flruntime.ThreadView{
		ThreadID: identity.ThreadID("thread-typed-summary"), LastOutcome: &outcome, Failure: failure,
	}
	status, currentCode, currentMessage := threadViewRunState(current)
	if status != string(RunStateFailed) || currentCode != runErrorCodeFloretEffectOutcomeUnknown {
		t.Fatalf("current state=(%q, %q, %q)", status, currentCode, currentMessage)
	}
	view := ThreadView{ThreadID: "thread-typed-summary"}
	applyThreadRuntimeSummary(&view, current)
	if view.RunStatus != status || view.RunErrorCode != currentCode || view.RunError != currentMessage {
		t.Fatalf("summary projection=%#v, want status=%q code=%q message=%q", view, status, currentCode, currentMessage)
	}
	direct := threadViewFromRuntimeCurrent(threadstore.ThreadSettings{ThreadID: "thread-typed-summary"}, current, flruntime.ThreadSummary{})
	if direct.RunStatus != status || direct.RunErrorCode != currentCode || direct.RunError != currentMessage {
		t.Fatalf("direct projection=%#v, want status=%q code=%q message=%q", direct, status, currentCode, currentMessage)
	}
	if strings.Contains(strings.ToLower(currentMessage), "dispatch state") {
		t.Fatalf("current message=%q exposed internal effect state", currentMessage)
	}
}

func TestFlowerCurrentAndSummaryPreserveExactRunIdentityAndProgress(t *testing.T) {
	current := flruntime.ThreadView{
		ThreadID:    identity.ThreadID("thread-progress"),
		TurnID:      identity.TurnID("turn-progress"),
		RunID:       identity.RunID("run-progress"),
		Activity:    flruntime.ThreadActivityActive,
		RunProgress: &flruntime.ThreadRunProgress{Phase: flruntime.ThreadRunPhaseStreaming},
	}

	encoded, err := flowerCurrentJSON(current)
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(encoded, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["turn_id"] != "turn-progress" || payload["run_id"] != "run-progress" {
		t.Fatalf("current identity=%#v", payload)
	}
	progress, _ := payload["run_progress"].(map[string]any)
	if progress["phase"] != "streaming" {
		t.Fatalf("current run progress=%#v", progress)
	}

	view := ThreadView{ThreadID: "thread-progress"}
	applyThreadRuntimeSummary(&view, current)
	if view.ActiveRunID != "run-progress" {
		t.Fatalf("active run id=%q, want exact RunID", view.ActiveRunID)
	}
	if view.RunProgress == nil || view.RunProgress.RunID != "run-progress" || view.RunProgress.TurnID != "turn-progress" || view.RunProgress.Phase != flruntime.ThreadRunPhaseStreaming {
		t.Fatalf("summary run progress=%#v", view.RunProgress)
	}

	projected := threadViewFromRuntimeCurrent(threadstore.ThreadSettings{ThreadID: "thread-progress"}, current, flruntime.ThreadSummary{})
	if projected.ActiveRunID != "run-progress" || projected.RunProgress == nil || projected.RunProgress.TurnID != "turn-progress" {
		t.Fatalf("runtime current projection=%#v", projected)
	}
}

func TestFlowerCurrentJSONPreservesHistoricalItemAndInteractionRunIdentity(t *testing.T) {
	current := flruntime.ThreadView{
		ThreadID: identity.ThreadID("thread-multiturn"),
		Items: []flruntime.ThreadItem{
			{ID: "user-1", TurnID: "turn-1", RunID: "run-1", Ordinal: 1, Kind: flruntime.ThreadItemUser, Text: "first"},
			{ID: "assistant-2", TurnID: "turn-2", RunID: "run-2", Ordinal: 2, Kind: flruntime.ThreadItemAssistant, Text: "second"},
			{ID: "tool-3", TurnID: "turn-3", RunID: "run-3", Ordinal: 3, Kind: flruntime.ThreadItemTool},
		},
		Interactions: []flruntime.ThreadInteraction{{
			ID: "approval-2", TurnID: "turn-2", RunID: "run-2", Kind: flruntime.ThreadInteractionApproval,
		}},
	}
	encoded, err := flowerCurrentJSON(current)
	if err != nil {
		t.Fatal(err)
	}
	var payload struct {
		Items []struct {
			TurnID string `json:"turn_id"`
			RunID  string `json:"run_id"`
		} `json:"items"`
		Interactions []struct {
			TurnID string `json:"turn_id"`
			RunID  string `json:"run_id"`
		} `json:"interactions"`
	}
	if err := json.Unmarshal(encoded, &payload); err != nil {
		t.Fatal(err)
	}
	if got := []string{payload.Items[0].RunID, payload.Items[1].RunID, payload.Items[2].RunID}; !reflect.DeepEqual(got, []string{"run-1", "run-2", "run-3"}) {
		t.Fatalf("item RunIDs=%v", got)
	}
	if payload.Interactions[0].TurnID != "turn-2" || payload.Interactions[0].RunID != "run-2" {
		t.Fatalf("interaction identity=%#v", payload.Interactions[0])
	}
}

func TestFlowerCurrentJSONRejectsIncompleteRunIdentity(t *testing.T) {
	_, err := flowerCurrentJSON(flruntime.ThreadView{
		ThreadID: identity.ThreadID("thread-invalid"),
		Items:    []flruntime.ThreadItem{{ID: "user-invalid", TurnID: "turn-invalid", Kind: flruntime.ThreadItemUser}},
	})
	if err == nil || !strings.Contains(err.Error(), "exact id, turn_id, and run_id") {
		t.Fatalf("error=%v", err)
	}
}

func TestThreadListSummaryConsumesUnknownEffectFailureCode(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	created, err := svc.CreateThread(t.Context(), meta, "typed failure", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	settings, err := svc.threadsDB.GetThreadSettings(t.Context(), meta.EndpointID, created.ThreadID)
	if err != nil || settings == nil {
		t.Fatalf("settings=%#v err=%v", settings, err)
	}
	outcome := flruntime.TurnOutcomeFailed
	failure := &flruntime.ThreadTurnFailure{
		Code:    flruntime.ThreadTurnFailureEffectOutcomeUnknown,
		Message: "private effect attempt state",
	}
	view, err := svc.threadViewFromSummary(t.Context(), settings, flruntime.ThreadSummary{
		ID: identity.ThreadID(created.ThreadID), LastOutcome: &outcome, Failure: failure,
	})
	if err != nil {
		t.Fatal(err)
	}
	if view.RunStatus != string(RunStateFailed) || view.RunErrorCode != runErrorCodeFloretEffectOutcomeUnknown {
		t.Fatalf("summary view=%#v", view)
	}
	if strings.Contains(strings.ToLower(view.RunError), "effect attempt") {
		t.Fatalf("summary error=%q exposed internal projection failure", view.RunError)
	}
}
