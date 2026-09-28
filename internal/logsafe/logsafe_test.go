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

func TestTextPreservesSingleLineDiagnosticContent(t *testing.T) {
	got := Text("  diagnostic\r\nforged entry\tcontrol\x1b  ", 100)
	if got != "diagnostic  forged entry control" {
		t.Fatalf("Text() = %q, want line and control boundaries escaped", got)
	}
}
