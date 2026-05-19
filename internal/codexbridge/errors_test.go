package codexbridge

import (
	"encoding/json"
	"testing"
)

func TestTurnErrorFromErrorExtractsStructuredRPCDetails(t *testing.T) {
	raw := wireTurnError{
		Message:           "Provider rejected the request",
		CodexErrorInfo:    json.RawMessage(`{"rateLimitExceeded":{"httpStatusCode":429}}`),
		AdditionalDetails: stringPtr("HTTP 429 rate limit exceeded"),
	}
	data, err := json.Marshal(raw)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}

	turnErr := TurnErrorFromError(&rpcMethodError{
		Method:  "turn/start",
		Code:    -32000,
		Message: "request failed",
		Data:    data,
	})
	if turnErr == nil {
		t.Fatal("TurnErrorFromError returned nil")
	}
	if turnErr.Message != "Provider rejected the request" {
		t.Fatalf("Message = %q", turnErr.Message)
	}
	if turnErr.AdditionalDetails != "HTTP 429 rate limit exceeded" {
		t.Fatalf("AdditionalDetails = %q", turnErr.AdditionalDetails)
	}
	if turnErr.CodexErrorCode != "rateLimitExceeded" {
		t.Fatalf("CodexErrorCode = %q", turnErr.CodexErrorCode)
	}
}
