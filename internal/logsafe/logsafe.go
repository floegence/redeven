// Package logsafe provides bounded, single-line values for structured logs.
package logsafe

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

func Text(value string, maxRunes int) string {
	value = strings.Map(func(r rune) rune {
		if r == '\r' || r == '\n' || r == '\t' {
			return ' '
		}
		if utf8.ValidRune(r) && r >= 0x20 {
			return r
		}
		return ' '
	}, value)
	value = strings.TrimSpace(value)
	if maxRunes <= 0 {
		maxRunes = 256
	}
	runes := []rune(value)
	if len(runes) > maxRunes {
		value = string(runes[:maxRunes]) + "..."
	}
	return value
}

func Error(err error) string {
	if err == nil {
		return ""
	}
	return Text(err.Error(), 512)
}

func Format(format string, args ...any) string {
	return Text(fmt.Sprintf(format, args...), 512)
}
