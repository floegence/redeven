package runtimepresentation

import (
	"encoding/json"
	"strconv"
	"strings"
	"sync"
	"time"
)

type LogLine struct {
	Seq     uint64
	At      time.Time
	Level   string
	Message string
	Raw     string
}

type LogBuffer struct {
	mu      sync.Mutex
	max     int
	seq     uint64
	partial string
	lines   []LogLine
}

func NewLogBuffer(maxLines int) *LogBuffer {
	if maxLines < 1 {
		maxLines = 1
	}
	return &LogBuffer{max: maxLines}
}

func (b *LogBuffer) Write(p []byte) (int, error) {
	if b == nil {
		return len(p), nil
	}
	b.mu.Lock()
	defer b.mu.Unlock()

	text := b.partial + string(p)
	parts := strings.Split(text, "\n")
	b.partial = parts[len(parts)-1]
	for _, raw := range parts[:len(parts)-1] {
		b.appendLocked(parseLogLine(raw))
	}
	return len(p), nil
}

func (b *LogBuffer) Lines(limit int) []LogLine {
	if b == nil {
		return nil
	}
	b.mu.Lock()
	defer b.mu.Unlock()

	if limit <= 0 || limit > len(b.lines) {
		limit = len(b.lines)
	}
	start := len(b.lines) - limit
	out := make([]LogLine, limit)
	copy(out, b.lines[start:])
	return out
}

func (b *LogBuffer) appendLocked(line LogLine) {
	line.Raw = strings.TrimSpace(line.Raw)
	if line.Raw == "" {
		return
	}
	b.seq++
	line.Seq = b.seq
	if line.Level == "" {
		line.Level = "INFO"
	}
	if line.Message == "" {
		line.Message = line.Raw
	}
	b.lines = append(b.lines, line)
	if len(b.lines) > b.max {
		copy(b.lines, b.lines[len(b.lines)-b.max:])
		b.lines = b.lines[:b.max]
	}
}

func parseLogLine(raw string) LogLine {
	raw = strings.TrimSpace(raw)
	line := LogLine{Raw: raw}
	if raw == "" {
		return line
	}
	if strings.HasPrefix(raw, "{") {
		return parseJSONLogLine(raw)
	}
	fields := splitTextLogFields(raw)
	if value := fields["time"]; value != "" {
		if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
			line.At = parsed
		}
	}
	line.Level = strings.ToUpper(strings.TrimSpace(fields["level"]))
	line.Message = strings.TrimSpace(fields["msg"])
	if line.Message == "" {
		line.Message = raw
	}
	return line
}

func parseJSONLogLine(raw string) LogLine {
	line := LogLine{Raw: raw}
	var fields map[string]any
	if err := json.Unmarshal([]byte(raw), &fields); err != nil {
		line.Message = raw
		return line
	}
	if value, ok := fields["time"].(string); ok {
		if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
			line.At = parsed
		}
	}
	if value, ok := fields["level"].(string); ok {
		line.Level = strings.ToUpper(strings.TrimSpace(value))
	}
	if value, ok := fields["msg"].(string); ok {
		line.Message = strings.TrimSpace(value)
	}
	if line.Message == "" {
		line.Message = raw
	}
	return line
}

func splitTextLogFields(raw string) map[string]string {
	fields := make(map[string]string)
	for len(raw) > 0 {
		raw = strings.TrimLeft(raw, " ")
		if raw == "" {
			break
		}
		keyEnd := strings.IndexByte(raw, '=')
		if keyEnd <= 0 {
			break
		}
		key := raw[:keyEnd]
		rest := raw[keyEnd+1:]
		value, remaining := readTextLogValue(rest)
		fields[key] = value
		raw = remaining
	}
	return fields
}

func readTextLogValue(raw string) (string, string) {
	if strings.HasPrefix(raw, "\"") {
		for i := 1; i < len(raw); i++ {
			if raw[i] == '"' && raw[i-1] != '\\' {
				quoted := raw[:i+1]
				value, err := strconv.Unquote(quoted)
				if err != nil {
					return strings.Trim(quoted, "\""), strings.TrimSpace(raw[i+1:])
				}
				return value, strings.TrimSpace(raw[i+1:])
			}
		}
		return strings.Trim(raw, "\""), ""
	}
	if idx := strings.IndexByte(raw, ' '); idx >= 0 {
		return raw[:idx], strings.TrimSpace(raw[idx+1:])
	}
	return raw, ""
}
