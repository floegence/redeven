package ai

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/floegence/floret/v5/identity"
	flruntime "github.com/floegence/floret/v5/runtime"
)

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
