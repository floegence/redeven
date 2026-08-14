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

type testLogError string

func (e testLogError) Error() string { return string(e) }
