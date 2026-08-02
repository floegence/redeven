package ai

import "testing"

func TestSafeRunLogAttrsSanitizesKeysValuesAndErrors(t *testing.T) {
	attrs := safeRunLogAttrs([]any{
		"user\nkey", "first\r\nsecond",
		"password", "secret-value",
		"error", testLogError("failed\nforged"),
	})

	want := []any{
		"user key", "first second",
		"password", "[redacted:12 chars]",
		"error", "failed forged",
	}
	if len(attrs) != len(want) {
		t.Fatalf("safeRunLogAttrs() length = %d, want %d", len(attrs), len(want))
	}
	for i := range want {
		if attrs[i] != want[i] {
			t.Fatalf("safeRunLogAttrs()[%d] = %#v, want %#v", i, attrs[i], want[i])
		}
	}
}

func TestQueuedTurnStartLogAttrsSanitizesErrorIdentityOverrides(t *testing.T) {
	attrs := queuedTurnStartLogAttrs(&queuedTurnStartError{
		endpointID: "endpoint\nforged",
		threadID:   "thread\rforged",
		err:        testLogError("failed\nforged"),
	}, "fallback", "fallback")

	if attrs[1] != "endpoint forged" {
		t.Fatalf("endpoint_id = %#v, want sanitized value", attrs[1])
	}
	if attrs[3] != "thread forged" {
		t.Fatalf("thread_id = %#v, want sanitized value", attrs[3])
	}
}

type testLogError string

func (e testLogError) Error() string { return string(e) }
