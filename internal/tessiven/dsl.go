package tessiven

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	tessivenspec "github.com/floegence/redeven/spec/tessiven"
	"gopkg.in/yaml.v3"
)

type DSLMigration struct {
	From string `json:"from"`
	To   string `json:"to"`
}

func dslFormat(version string) (tessivenspec.Format, bool) {
	for _, format := range tessivenspec.Formats() {
		if format.Version == version {
			return format, true
		}
	}
	return tessivenspec.Format{}, false
}

func unsupportedDSLVersion(version string) error {
	versions := []string{}
	for _, format := range tessivenspec.Formats() {
		versions = append(versions, format.Version)
	}
	return fmt.Errorf("unsupported Tessiven DSL version %q; supported versions: %s. Upgrade the Runtime to read a newer DSL; never relabel or downgrade an unknown document", version, strings.Join(versions, ", "))
}

// SchemaForVersion returns an exact frozen schema, not a semver-range fallback.
func SchemaForVersion(version string) (json.RawMessage, error) {
	if version == "" {
		version = tessivenspec.CurrentVersion
	}
	format, ok := dslFormat(version)
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrInvalidRequest, unsupportedDSLVersion(version))
	}
	return json.RawMessage(format.Schema), nil
}

// The reviewed v1 -> v1.0.0 and v1.0.0 -> v1.1.0 edges change only the root version scalar. In
// particular, names, references, bindings, evidence and layout hints remain
// byte-for-byte unchanged. Later migrations must have their own explicit edge.
func upgradeDSLHeader(source string, node *yaml.Node, from, target string) (string, error) {
	if node == nil || node.Kind != yaml.ScalarNode || node.Value != from {
		return "", fmt.Errorf("the source DSL version scalar is invalid")
	}
	// Match yaml.v3's line/column convention, retaining every original byte.
	lines := []string{}
	lineStart := 0
	for index, character := range source {
		if index < lineStart {
			continue
		}
		if character != '\r' && character != '\n' && character != '\u0085' && character != '\u2028' && character != '\u2029' {
			continue
		}
		end := index + utf8.RuneLen(character)
		if character == '\r' && end < len(source) && source[end] == '\n' {
			end++
		}
		lines = append(lines, source[lineStart:end])
		lineStart = end
	}
	lines = append(lines, source[lineStart:])
	if node.Line < 1 || node.Line > len(lines) {
		return "", fmt.Errorf("the legacy version source location is invalid")
	}
	offset := 0
	for _, line := range lines[:node.Line-1] {
		offset += len(line)
	}
	column := 1
	for index, character := range lines[node.Line-1] {
		if node.Line == 1 && index == 0 && character == '\ufeff' {
			continue
		}
		if column == node.Column {
			offset += index
			break
		}
		column++
	}
	if node.Style&(yaml.LiteralStyle|yaml.FoldedStyle) != 0 {
		// A valid legacy version in a block scalar has exactly one nonempty
		// content line. Its indicator and comments need no rewriting.
		offset = 0
		for index, line := range lines {
			if index >= node.Line && strings.TrimSpace(line) == node.Value {
				start := offset + strings.Index(line, node.Value)
				return source[:start] + target + source[start+len(node.Value):], nil
			}
			offset += len(line)
		}
		return "", fmt.Errorf("the legacy block version scalar cannot be upgraded")
	}
	// Explicit YAML scalar tags are retained along with the scalar style.
	start := offset
	if start >= len(source) {
		return "", fmt.Errorf("the legacy version source location is invalid")
	}
	if source[start] == '!' {
		end := strings.IndexAny(source[start:], " \t\r\n")
		if end < 0 {
			return "", fmt.Errorf("the legacy version tag is incomplete")
		}
		start += end
		for start < len(source) && strings.ContainsRune(" \t\r\n", rune(source[start])) {
			start++
		}
	}
	if node.Style&(yaml.SingleQuotedStyle|yaml.DoubleQuotedStyle) != 0 {
		quote := source[start]
		for end := start + 1; end < len(source); end++ {
			if quote == '"' && source[end] == '\\' {
				end++
				continue
			}
			if source[end] != quote {
				continue
			}
			if quote == '\'' && end+1 < len(source) && source[end+1] == quote {
				end++
				continue
			}
			return source[:start+1] + target + source[end:], nil
		}
	} else if strings.HasPrefix(source[start:], node.Value) {
		return source[:start] + target + source[start+len(node.Value):], nil
	}
	return "", fmt.Errorf("the legacy version scalar cannot be upgraded")
}
