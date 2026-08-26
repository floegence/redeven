package ai

import (
	"strings"
	"unicode/utf8"
)

// normalizeUTF8Text is the single boundary for text derived from byte-oriented
// integrations. Raw bytes remain authoritative inside their owning subsystem;
// product and provider projections receive valid UTF-8 only.
func normalizeUTF8Text(value string) (string, bool) {
	if utf8.ValidString(value) {
		return value, false
	}
	return strings.ToValidUTF8(value, "\uFFFD"), true
}
