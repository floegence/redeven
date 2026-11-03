package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestTerminalInitialResultAndReadCoverOutputExactly(t *testing.T) {
	p := newTerminalReadWaitTestProcess(0)
	want := strings.Repeat("abcdefghijklmnop", 2000)
	p.appendOutput([]byte(want))
	p.status = terminalProcessStatusSuccess
	page, err := p.WaitForYieldContext(context.Background(), 1)
	if err != nil {
		t.Fatal(err)
	}
	var got strings.Builder
	for i := 0; ; i++ {
		if i > 20 {
			t.Fatal("pagination did not terminate")
		}
		encoded, err := encodeModelToolResult(ToolResult{ToolID: "test", ToolName: "terminal.exec", Status: toolResultStatusSuccess, Data: terminalProcessResultPayload(page)})
		if err != nil {
			t.Fatal(err)
		}
		var envelope map[string]any
		if err := json.Unmarshal(encoded.text, &envelope); err != nil {
			t.Fatal(err)
		}
		data := envelope["data"].(map[string]any)
		output := data["output"].(string)
		if len(output) > terminalProcessModelReadBytes {
			t.Fatalf("page has %d bytes", len(output))
		}
		got.WriteString(output)
		if !page.HasMore {
			break
		}
		next, err := p.ReadAfter(context.Background(), terminalProcessReadRequest{AfterSeq: page.LastSeq, MaxBytes: terminalProcessModelReadBytes})
		if err != nil {
			t.Fatal(err)
		}
		if next.LastSeq <= page.LastSeq {
			t.Fatal("cursor made no progress")
		}
		page = next
	}
	if got.String() != want {
		t.Fatalf("output lost: got %d bytes, want %d", got.Len(), len(want))
	}
}

func TestTerminalUTF8AcrossPTYAndPageBoundaries(t *testing.T) {
	p := newTerminalReadWaitTestProcess(0)
	want := strings.Repeat("中文🪷é", 3000)
	raw := []byte(want)
	for i := 0; i < len(raw); i += 17 {
		p.appendOutput(raw[i:min(i+17, len(raw))])
	}
	var got strings.Builder
	cursor := int64(0)
	for {
		page, err := p.ReadAfter(context.Background(), terminalProcessReadRequest{AfterSeq: cursor, MaxBytes: terminalProcessModelReadBytes})
		if err != nil {
			t.Fatal(err)
		}
		if !utf8.ValidString(page.Output) || page.outputUTF8Repaired {
			t.Fatal("valid UTF-8 was split and repaired")
		}
		got.WriteString(page.Output)
		if !page.HasMore {
			break
		}
		cursor = page.LastSeq
	}
	if got.String() != want {
		t.Fatalf("UTF-8 output changed: got %d bytes, want %d", got.Len(), len(want))
	}
}

func TestTerminalInvalidEncodingAndRetentionAreExplicit(t *testing.T) {
	p := newTerminalReadWaitTestProcess(0)
	p.appendOutput([]byte(strings.Repeat("x", terminalProcessTailCapBytes+12000)))
	p.appendOutput([]byte{0xe4, 0xb8})
	p.flushOutput()
	page, err := p.ReadAfter(t.Context(), terminalProcessReadRequest{AfterSeq: 0, MaxBytes: terminalProcessModelReadBytes})
	if err != nil {
		t.Fatal(err)
	}
	if !page.Truncated || !page.HasMore || !page.outputUTF8Repaired {
		t.Fatalf("missing gap or encoding facts: %+v", page)
	}
	cursor := page.LastSeq
	for page.HasMore {
		page, err = p.ReadAfter(t.Context(), terminalProcessReadRequest{AfterSeq: cursor, MaxBytes: terminalProcessModelReadBytes})
		if err != nil {
			t.Fatal(err)
		}
		if !utf8.ValidString(page.Output) || len(page.Output) > terminalProcessModelReadBytes || page.LastSeq <= cursor {
			t.Fatal("invalid bounded page")
		}
		cursor = page.LastSeq
	}
	empty, err := p.ReadAfter(t.Context(), terminalProcessReadRequest{AfterSeq: cursor, MaxBytes: terminalProcessModelReadBytes})
	if err != nil || empty.LastSeq != cursor || empty.Output != "" || empty.HasMore {
		t.Fatal("empty read changed cursor")
	}
}

func TestTerminalIndependentReadersAndClosedAdmission(t *testing.T) {
	p := newTerminalReadWaitTestProcess(0)
	p.appendOutput([]byte(strings.Repeat("abc中文", 3000)))
	a, err := p.ReadAfter(t.Context(), terminalProcessReadRequest{AfterSeq: 0, MaxBytes: 8000})
	if err != nil {
		t.Fatal(err)
	}
	b, err := p.ReadAfter(t.Context(), terminalProcessReadRequest{AfterSeq: 0, MaxBytes: 8000})
	if err != nil || a.Output != b.Output || a.LastSeq != b.LastSeq {
		t.Fatal("reading consumed shared output")
	}
	m := newTerminalProcessManager()
	if err := m.Close(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Start(terminalProcessStartRequest{ProcessID: "late", Command: "printf late", CwdAbs: t.TempDir(), Shell: "/bin/sh"}); err == nil {
		t.Fatal("started after close")
	}
}

func TestTerminalSealedOutputRejectsCorruption(t *testing.T) {
	facts := terminalProcessSnapshot{ProcessID: "p", LatestSeq: 2, TotalBytes: 6}
	valid := terminalSealedOutput{Version: 1, Snapshot: facts, Chunks: []terminalSealedChunk{{Seq: 1, Text: "abc"}, {Seq: 2, Text: "def"}}}
	if err := validateSealedTerminal(valid, facts); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"identity", "gap", "utf8", "tail", "bytes"} {
		t.Run(mode, func(t *testing.T) {
			broken := valid
			broken.Chunks = append([]terminalSealedChunk(nil), valid.Chunks...)
			switch mode {
			case "identity":
				broken.Snapshot.ProcessID = "other"
			case "gap":
				broken.Chunks[1].Seq = 3
			case "utf8":
				broken.Chunks[0].Text = string([]byte{0xff})
			case "tail":
				broken.Chunks = broken.Chunks[:1]
			case "bytes":
				broken.Chunks[0].Text = "too many bytes"
			}
			if validateSealedTerminal(broken, facts) == nil {
				t.Fatal("accepted corrupt snapshot")
			}
		})
	}
}

func TestTerminalCloseWaitsForAllSettlementsAndReportsFailure(t *testing.T) {
	m := newTerminalProcessManager()
	root := t.TempDir()
	expected := errors.New("completion persistence unavailable")
	entered := make(chan struct{}, 3)
	release := make(chan struct{})
	for i := 0; i < 3; i++ {
		_, err := m.Start(terminalProcessStartRequest{ProcessID: fmt.Sprint("close-", i), Command: "sleep 30", CwdAbs: root, Shell: "/bin/sh", Complete: func(*terminalProcess) error { entered <- struct{}{}; <-release; return expected }})
		if err != nil {
			close(release)
			_ = m.Close(t.Context())
			t.Fatal(err)
		}
	}
	result := make(chan error, 1)
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	go func() { result <- m.Close(ctx) }()
	for i := 0; i < 3; i++ {
		select {
		case <-entered:
		case <-ctx.Done():
			close(release)
			t.Fatal("shutdown did not settle commands concurrently")
		}
	}
	select {
	case err := <-result:
		close(release)
		t.Fatalf("returned before settlement: %v", err)
	default:
	}
	close(release)
	if err := <-result; !errors.Is(err, expected) {
		t.Fatalf("lost persistence failure: %v", err)
	}
	for _, p := range m.processes {
		if p.Snapshot().Status == terminalProcessStatusRunning {
			t.Fatal("process remained running")
		}
	}
}

func TestTerminalActivityPreviewKeepsWholeUTF8Chunks(t *testing.T) {
	for _, output := range []string{strings.Repeat("x", 8000), strings.Repeat("x", 8001), strings.Repeat("中文🌸", 9000)} {
		p := newTerminalReadWaitTestProcess(0)
		p.appendOutput([]byte(output))
		p.status = terminalProcessStatusSuccess
		p.mu.Lock()
		full := p.snapshotLocked(terminalProcessTailCapBytes)
		preview := p.snapshotLocked(activityPayloadStringLimit)
		p.mu.Unlock()
		if len(preview.Output) > activityPayloadStringLimit || !utf8.ValidString(preview.Output) || preview.LastSeq != full.LastSeq || preview.LatestSeq != full.LatestSeq || preview.HasMore || !strings.HasSuffix(full.Output, preview.Output) {
			t.Fatalf("invalid preview: %+v", preview)
		}
		if preview.Truncated != (len(preview.Output) < len(full.Output)) {
			t.Fatal("preview truncation is inaccurate")
		}
		activity := terminalProcessActivity(preview)
		if err := activity.Validate(); err != nil {
			t.Fatal(err)
		}
		if full.Output != output {
			t.Fatal("preview changed retained output")
		}
	}
}

func TestTerminalActivityBoundsCommandWithoutChangingExecution(t *testing.T) {
	snapshot := terminalProcessSnapshot{Command: strings.Repeat("中", 9000), Status: terminalProcessStatusSuccess}
	activity := terminalProcessActivity(snapshot)
	if err := activity.Validate(); err != nil {
		t.Fatal(err)
	}
	if len([]rune(snapshot.Command)) != 9000 {
		t.Fatal("presentation changed execution command")
	}
}
