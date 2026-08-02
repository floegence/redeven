package logsafe

import "testing"

func TestTextRemovesControlCharactersAndBoundsValue(t *testing.T) {
	got := Text("prefix\r\n\t"+"abcdef", 6)
	if got != "prefix..." {
		t.Fatalf("Text() = %q, want bounded single-line value", got)
	}
}

func TestErrorHandlesNil(t *testing.T) {
	if got := Error(nil); got != "" {
		t.Fatalf("Error(nil) = %q, want empty string", got)
	}
}
