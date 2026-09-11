package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestPlaywrightTargetExecutorFixture(t *testing.T) {
	if os.Getenv("REDEVEN_PLAYWRIGHT_QUALIFICATION") != "1" {
		t.Skip("Playwright fixture qualification disabled")
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(`<button id="success" onclick="document.body.dataset.success='true'">Success</button>`))
	}))
	defer server.Close()
	helper := filepath.Join("..", "envapp", "ui_src", "scripts", "redevenComputerHost.mjs")
	executor := NewPlaywrightTargetExecutor("node", helper, t.TempDir())
	defer executor.Close()
	navigate, err := json.Marshal(map[string]any{"url": server.URL})
	if err != nil {
		t.Fatal(err)
	}
	result, err := executor.ExecuteTargetTool(context.Background(), TargetToolCall{ToolCallID: "navigate", TargetID: "fixture", ToolName: "browser.navigate", Arguments: navigate})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Attachments) != 1 || result.Attachments[0].MIMEType != "image/png" {
		t.Fatalf("missing screenshot attachment: %#v", result.Attachments)
	}
	if _, err := executor.ResolveTargetToolAttachment(context.Background(), result.Attachments[0].ResourceRef); err != nil {
		t.Fatal(err)
	}
	click, err := json.Marshal(map[string]any{"x": 20, "y": 20})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := executor.ExecuteTargetTool(context.Background(), TargetToolCall{ToolCallID: "click", TargetID: "fixture", ToolName: "computer.click", Arguments: click}); err != nil {
		t.Fatal(err)
	}
}
