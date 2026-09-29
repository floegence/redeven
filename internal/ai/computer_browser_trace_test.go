package ai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/browserbridge"
)

type browserTraceLogBuffer struct {
	mu sync.Mutex
	bytes.Buffer
}

func (b *browserTraceLogBuffer) Write(value []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.Buffer.Write(value)
}

func (b *browserTraceLogBuffer) text() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.Buffer.String()
}

func TestExtensionSourceTraceCorrelatesCommandsWithoutPageContent(t *testing.T) {
	var logs browserTraceLogBuffer
	previousLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(previousLogger) })
	_, client, native := extensionFixture(t)
	local, helper := net.Pipe()
	t.Cleanup(func() { _ = helper.Close() })
	ctx, cancel := context.WithCancel(t.Context())
	pipe := &extensionSourcePipe{
		client: client, conn: local, ctx: ctx, cancel: cancel,
		target: "fixture-target", request: "fixture-request", tab: "7", binding: "fixture-binding",
		queue: make(chan json.RawMessage, 8), slots: make(chan struct{}, 2),
	}
	t.Cleanup(pipe.close)
	go pipe.read(bufio.NewReader(local))
	go pipe.write()
	go func() {
		for {
			raw, err := browserbridge.ReadMessage(native, 1<<20)
			if err != nil {
				return
			}
			var command struct {
				ID, Command string
				Arguments   struct{ Session string }
			}
			if json.Unmarshal(raw, &command) != nil {
				return
			}
			reply := map[string]any{"id": command.ID, "result": true}
			if command.Command == "cdp" {
				reply["result"] = map[string]string{"value": "private-source-result"}
				if command.Arguments.Session != "" {
					delete(reply, "result")
					reply["error"] = "https://private.example/secret private-source-error"
				}
			} else if command.Command != "unbind" {
				t.Errorf("unexpected native command: %s", command.Command)
			}
			if browserbridge.WriteMessage(native, reply, 1<<20) != nil {
				return
			}
		}
	}()
	if err := helper.SetDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatal(err)
	}
	for index, session := range []string{"", "private-child-session"} {
		command := map[string]any{
			"id": fmt.Sprint(index), "method": "Runtime.evaluate", "session": session,
			"params": map[string]string{"expression": "private-source-expression", "url": "https://private.example/secret"},
		}
		if err := browserbridge.WriteMessage(helper, command, 1<<20); err != nil {
			t.Fatal(err)
		}
		if _, err := browserbridge.ReadMessage(helper, 1<<20); err != nil {
			t.Fatal(err)
		}
	}
	if err := pipe.drain(t.Context()); err != nil {
		t.Fatal(err)
	}
	output := logs.text()
	for _, secret := range []string{"private-source", "private.example", "private-child-session", "expression"} {
		if strings.Contains(output, secret) {
			t.Fatalf("browser diagnostics exposed source content: %s", secret)
		}
	}
	allowed := map[string]bool{
		"time": true, "level": true, "msg": true, "stage": true, "target_id": true,
		"binding": true, "request": true, "command": true, "method": true,
		"child_frame": true, "phase": true, "duration_ms": true,
	}
	stages := map[string][]string{}
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		var record map[string]any
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatal(err)
		}
		if record["msg"] != "browser source trace" {
			continue
		}
		for field := range record {
			if !allowed[field] {
				t.Fatalf("unreviewed diagnostic field: %s", field)
			}
		}
		if record["stage"] != "cdp_method" || record["target_id"] != pipe.target || record["binding"] != pipe.binding || record["request"] != pipe.request || record["method"] != "Runtime.evaluate" {
			t.Fatalf("command trace lost correlation: %v", record)
		}
		command := record["command"].(string)
		if record["child_frame"] != (command == "1") {
			t.Fatal("trace lost the root/child distinction")
		}
		phase := record["phase"].(string)
		stages[command] = append(stages[command], phase)
		if phase != "started" {
			if duration, ok := record["duration_ms"].(float64); !ok || duration < 0 {
				t.Fatal("completed command trace has no valid duration")
			}
		}
	}
	if strings.Join(stages["0"], ",") != "started,completed" || strings.Join(stages["1"], ",") != "started,failed" || len(stages) != 2 {
		t.Fatalf("command outcomes are ambiguous: %v", stages)
	}
}
