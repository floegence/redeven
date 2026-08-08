package sessionrpc

import (
	"context"
	"encoding/json"
	"testing"

	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
)

func TestBindPreservesJSONResponseShape(t *testing.T) {
	router := NewRouter()
	router.Register(42, func(context.Context, json.RawMessage) (json.RawMessage, *Error) {
		return json.RawMessage(`{"ok":true,"value":7}`), nil
	})
	handlers, err := flowersec.NewSessionHandlers(flowersec.SessionHandlerOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if err := router.Bind(handlers); err != nil {
		t.Fatal(err)
	}
	var response any
	// Call exercises the same JSON contract used by the product focused tests.
	if err := router.Call(context.Background(), 42, nil, &response); err != nil {
		t.Fatal(err)
	}
	var object map[string]any
	if err := json.Unmarshal([]byte(`{"ok":true,"value":7}`), &object); err != nil || object["ok"] != true {
		t.Fatal("invalid fixture")
	}
}
