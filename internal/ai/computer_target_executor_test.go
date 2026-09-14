package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func newPlaywrightProtocolFixture(t *testing.T) *PlaywrightTargetExecutor {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("JSONL shell fixture requires POSIX")
	}
	helper := filepath.Join(t.TempDir(), "helper.sh")
	content := `printf '{"type":"ready","protocol_version":1}\n'
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
  target=$(printf '%s' "$line" | sed -n 's/.*"target_id":"\([^"]*\)".*/\1/p')
  case "$line" in
    *computer.wait*) IFS= read -r ignored; exit 0 ;;
    *computer.double_click*) id=wrong ;;
  esac
  printf '{"id":"%s","target_id":"%s","result":{"summary":"fixture"}}\n' "$id" "$target"
done
`
	if err := os.WriteFile(helper, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	executor := NewPlaywrightTargetExecutor("sh", helper, t.TempDir())
	t.Cleanup(func() { _ = executor.Close() })
	return executor
}

func TestPlaywrightTargetExecutorInterruptedSessionIsReaped(t *testing.T) {
	for _, cause := range []string{"cancel", "timeout"} {
		t.Run(cause, func(t *testing.T) {
			executor := newPlaywrightProtocolFixture(t)
			call := TargetToolCall{TargetID: "fixture", ToolName: "computer.screenshot"}
			if _, err := executor.ExecuteTargetTool(t.Context(), call); err != nil {
				t.Fatal(err)
			}
			client := executor.clients["fixture"]
			ctx := t.Context()
			if cause == "cancel" {
				var cancel context.CancelFunc
				ctx, cancel = context.WithTimeout(ctx, 100*time.Millisecond)
				defer cancel()
			} else {
				executor.Timeout = 100 * time.Millisecond
			}
			call.ToolName = "computer.wait"
			if _, err := executor.ExecuteTargetTool(ctx, call); !errors.Is(err, context.DeadlineExceeded) {
				t.Fatalf("interruption error = %v", err)
			}
			if executor.clients["fixture"] != nil || client.cmd.ProcessState == nil {
				t.Fatal("interrupted session was retained or its helper was not reaped")
			}
			executor.Timeout = time.Second
			call.ToolName = "computer.screenshot"
			if _, err := executor.ExecuteTargetTool(t.Context(), call); err != nil {
				t.Fatalf("fresh observation after interruption: %v", err)
			}
		})
	}
}

func TestPlaywrightTargetExecutorRejectsMismatchedResponse(t *testing.T) {
	executor := newPlaywrightProtocolFixture(t)
	_, err := executor.ExecuteTargetTool(t.Context(), TargetToolCall{TargetID: "fixture", ToolName: "computer.double_click"})
	if err == nil || !strings.Contains(err.Error(), "provenance") {
		t.Fatalf("mismatched helper response accepted: %v", err)
	}
	if len(executor.clients) != 0 {
		t.Fatal("protocol failure retained the damaged session")
	}
}

func TestPlaywrightTargetExecutorCloseReapsAndPreventsRestart(t *testing.T) {
	executor := newPlaywrightProtocolFixture(t)
	call := TargetToolCall{TargetID: "fixture", ToolName: "computer.screenshot"}
	if _, err := executor.ExecuteTargetTool(t.Context(), call); err != nil {
		t.Fatal(err)
	}
	client := executor.clients["fixture"]
	if err := executor.Close(); err != nil {
		t.Fatal(err)
	}
	if client.cmd.ProcessState == nil {
		t.Fatal("Close did not reap the helper")
	}
	if _, err := executor.ExecuteTargetTool(t.Context(), call); err == nil {
		t.Fatal("closed executor restarted a helper")
	}
}

func TestPlaywrightTargetExecutorFixture(t *testing.T) {
	if os.Getenv("REDEVEN_PLAYWRIGHT_QUALIFICATION") != "1" {
		t.Skip("Playwright fixture qualification disabled")
	}
	events := make(chan string, 100)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/event" {
			events <- r.URL.Query().Get("value")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.Header().Set("Content-Type", "text/html")
		_, _ = fmt.Fprint(w, `<!doctype html><title>Action fixture</title>
<style>body{margin:0;height:2400px;background:#b6e1ca}button,input{position:absolute;height:50px;box-sizing:border-box}button{top:30px;width:140px}input{top:130px;left:20px;width:400px}</style>
<button style="left:20px" onclick="report('click')">Click</button>
<button style="left:200px" ondblclick="report('double')">Double click</button>
<input oninput="report('text:'+this.value)" onkeydown="if(event.key==='Enter')report('enter:'+this.value)">
<script>function report(value){fetch('/event?value='+encodeURIComponent(value))}addEventListener('scroll',()=>report('scroll'));report('load:'+location.pathname)</script>`)
	}))
	defer server.Close()
	helper := filepath.Join("..", "envapp", "ui_src", "scripts", "redevenComputerHost.mjs")
	executor := NewPlaywrightTargetExecutor("node", helper, t.TempDir())
	defer executor.Close()
	execute := func(tool string, args map[string]any) TargetToolResult {
		t.Helper()
		raw, err := json.Marshal(args)
		if err != nil {
			t.Fatal(err)
		}
		result, err := executor.ExecuteTargetTool(t.Context(), TargetToolCall{ToolCallID: tool, TargetID: "fixture", ToolName: tool, Arguments: raw})
		if err != nil {
			t.Fatalf("%s: %v", tool, err)
		}
		if len(result.Attachments) != 1 || result.Attachments[0].MIMEType != "image/png" {
			t.Fatalf("%s: missing screenshot", tool)
		}
		attachment := result.Attachments[0]
		body, err := executor.ResolveTargetToolAttachment(t.Context(), attachment.ResourceRef)
		if err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(body)
		if hex.EncodeToString(sum[:]) != attachment.SHA256 {
			t.Fatal("screenshot hash mismatch")
		}
		frame, err := png.DecodeConfig(bytes.NewReader(body))
		if err != nil || frame.Width != 1280 || frame.Height != 800 {
			t.Fatalf("invalid screenshot: %+v, %v", frame, err)
		}
		return result
	}
	awaitEvent := func(expected string) {
		t.Helper()
		timer := time.NewTimer(3 * time.Second)
		defer timer.Stop()
		for {
			select {
			case event := <-events:
				if event == expected {
					return
				}
			case <-timer.C:
				t.Fatalf("page did not observe %q", expected)
			}
		}
	}
	execute("browser.navigate", map[string]any{"url": server.URL})
	awaitEvent("load:/")
	execute("computer.screenshot", nil)
	execute("computer.click", map[string]any{"x": 80, "y": 55})
	awaitEvent("click")
	execute("computer.double_click", map[string]any{"x": 270, "y": 55})
	awaitEvent("double")
	execute("computer.click", map[string]any{"x": 80, "y": 155})
	execute("computer.type", map[string]any{"text": "Flower"})
	awaitEvent("text:Flower")
	execute("computer.key", map[string]any{"key": "Enter"})
	awaitEvent("enter:Flower")
	execute("computer.scroll", map[string]any{"delta_y": 600})
	awaitEvent("scroll")
	execute("computer.wait", map[string]any{"milliseconds": 10})
	execute("browser.reload", nil)
	awaitEvent("load:/")
	execute("browser.navigate", map[string]any{"url": server.URL + "/second"})
	awaitEvent("load:/second")
	back := execute("browser.back", nil)
	if back.Result.(map[string]any)["url"] != server.URL+"/" {
		t.Fatal("browser.back did not restore the previous page")
	}
	// Cancelling an action must release the real Chromium profile lock, allowing
	// the next observation to establish a fresh session without manual cleanup.
	ctx, cancel := context.WithTimeout(t.Context(), 100*time.Millisecond)
	defer cancel()
	_, err := executor.ExecuteTargetTool(ctx, TargetToolCall{TargetID: "fixture", ToolName: "computer.wait", Arguments: json.RawMessage(`{"milliseconds":30000}`)})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("cancel actual helper: %v", err)
	}
	execute("computer.screenshot", nil)
}

func TestTargetToolResultPayloadCarriesAttachmentFrame(t *testing.T) {
	ref := "computer://browser-main/" + strings.Repeat("a", 64)
	payload, ok := targetToolResultPayload(TargetToolResult{
		TargetID:    "browser-main",
		Attachments: []TargetToolAttachment{{ResourceRef: ref, MIMEType: "image/png"}},
	}, "browser-main").(map[string]any)
	if !ok || payload["after_frame"] != ref || payload["screenshot"] != ref {
		t.Fatalf("payload frame=%#v", payload)
	}
}
