package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	aitools "github.com/floegence/redeven/internal/ai/tools"
	"github.com/floegence/redeven/internal/browserbridge"
)

func TestComputerSourceContractRegistryFailureIsTypedBeforeScript(t *testing.T) {
	for _, cause := range []error{errTargetNotRegistered, errTargetAmbiguous} {
		failure := computerScriptTargetResolutionFailure(cause, "target")
		if got := aitools.ClassifyError(failure); got.Code != aitools.ErrorCodeTargetUnavailable {
			t.Fatalf("lost type: %+v", got)
		}
	}
}
func TestComputerSourceContractExtensionDiagnosticsCrossTransport(t *testing.T) {
	_, client, peer := extensionFixture(t)
	done := make(chan error, 1)
	go func() {
		raw, err := browserbridge.ReadMessage(peer, 1<<20)
		if err != nil {
			done <- err
			return
		}
		var request map[string]any
		if err = json.Unmarshal(raw, &request); err != nil {
			done <- err
			return
		}
		done <- browserbridge.WriteMessage(peer, map[string]any{"id": request["id"], "error": "EXTENSION_COMMAND_FAILED", "connection_diagnostic": map[string]any{"phase": "tab_restore", "reason": "timed_out", "elapsed_ms": 20000, "page_text": "private"}}, 1<<20)
	}()
	_, err := client.call(context.Background(), "bind", map[string]any{})
	var failure *computerConnectionError
	if !errors.As(err, &failure) || failure.diagnostic["reason"] != "timed_out" || failure.diagnostic["phase"] != "tab_restore" {
		t.Fatalf("diagnostics lost: %v %+v", err, failure)
	}
	encoded, _ := json.Marshal(failure.diagnostic)
	if strings.Contains(string(encoded), "private") {
		t.Fatal("source text escaped")
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
func TestComputerSourceContractSuccessfulScriptShowsActualOperations(t *testing.T) {
	rows := computerActivityResultRows("computer_exec", map[string]any{"completed": true, "completed_actions": []any{"snapshot", "source"}})
	found := false
	for _, r := range rows {
		if r.Meta == "completed_actions" {
			found = true
			if !strings.Contains(r.Content, "snapshot") || !strings.Contains(r.Content, "source") {
				t.Fatal(r)
			}
		}
	}
	if !found {
		t.Fatal("successful script hid completed operations")
	}
}

func TestComputerSourceContractActivityKeepsEmptyOperationsAndConnectionFacts(t *testing.T) {
	for _, fixture := range []struct {
		payload  map[string]any
		expected string
	}{
		{map[string]any{"completed": true, "completed_actions": []any{}}, "[]"},
		{map[string]any{"selected": false, "connection_diagnostic": map[string]any{"phase": "tab_restore", "reason": "timed_out"}}, "timed_out"},
	} {
		rows := computerActivityResultRows("computer_exec", fixture.payload)
		body, _ := json.Marshal(rows)
		if !strings.Contains(string(body), fixture.expected) {
			t.Fatalf("facts missing: %s", body)
		}
	}
}
