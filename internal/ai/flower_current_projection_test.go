package ai

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/floegence/floret/v5/identity"
	flruntime "github.com/floegence/floret/v5/runtime"
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

func TestFlowerCurrentJSONClassifiesAuthorityFailureWithoutExposingRawError(t *testing.T) {
	rawError := "floret authority state is corrupt: session tree authority state is corrupt"
	encoded, err := flowerCurrentJSON(flruntime.ThreadView{
		ThreadID: identity.ThreadID("thread-authority-failure"),
		Error:    rawError,
	})
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(encoded, &got); err != nil {
		t.Fatal(err)
	}
	if got["run_error_code"] != runErrorCodeFloretAuthorityConsistency {
		t.Fatalf("run_error_code=%#v", got["run_error_code"])
	}
	message, _ := got["error"].(string)
	if message == "" || strings.Contains(strings.ToLower(message), "authority state is corrupt") {
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
		Error: rawError,
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
		Code:    flruntime.ThreadTurnFailureStorage,
		Message: "private storage write failed",
	}
	current := flruntime.ThreadView{
		ThreadID: identity.ThreadID("thread-typed-summary"), LastOutcome: &outcome, Failure: failure, Error: failure.Message,
	}
	status, currentCode, currentMessage := threadViewRunState(current)
	if status != string(RunStateFailed) || currentCode != runErrorCodeFloretEngineFailed {
		t.Fatalf("current state=(%q, %q, %q)", status, currentCode, currentMessage)
	}
	view := ThreadView{ThreadID: "thread-typed-summary"}
	applyThreadRuntimeSummary(&view, current)
	if view.RunStatus != status || view.RunErrorCode != currentCode || view.RunError != currentMessage {
		t.Fatalf("summary projection=%#v, want status=%q code=%q message=%q", view, status, currentCode, currentMessage)
	}
	if strings.Contains(strings.ToLower(currentMessage), "storage write") {
		t.Fatalf("current message=%q exposed internal storage failure", currentMessage)
	}
}

func TestThreadListSummaryConsumesTypedFailureCode(t *testing.T) {
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
		Code:    flruntime.ThreadTurnFailureEngineContract,
		Message: "provider attempt superseded with pending canonical tool batch",
	}
	view, err := svc.threadViewFromSummary(t.Context(), settings, flruntime.ThreadSummary{
		ID: identity.ThreadID(created.ThreadID), LastOutcome: &outcome, Failure: failure, Error: failure.Message,
	})
	if err != nil {
		t.Fatal(err)
	}
	if view.RunStatus != string(RunStateFailed) || view.RunErrorCode != runErrorCodeFloretEngineFailed {
		t.Fatalf("summary view=%#v", view)
	}
	if strings.Contains(strings.ToLower(view.RunError), "pending canonical tool batch") {
		t.Fatalf("summary error=%q exposed internal projection failure", view.RunError)
	}
}
