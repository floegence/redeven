package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
)

// This qualification executes the authored examples through QuickJS, Runtime,
// the shared browser host and installed Chromium, with no model-authored result.
func TestComputerScriptExamplesQualification(t *testing.T) {
	if os.Getenv("REDEVEN_COMPUTER_RELIABILITY_E2E") != "1" {
		t.Skip("explicit real-browser qualification required")
	}
	var exports atomic.Int32
	content := bytes.Repeat([]byte("Orchid,40,820\n"), 100000)
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/export":
			exports.Add(1)
			w.Header().Set("Content-Type", "text/csv")
			w.Header().Set("Content-Disposition", "attachment; filename=domains.csv")
			_, _ = w.Write(content)
		case "/report":
			page, _ := strconv.Atoi(r.URL.Query().Get("page"))
			w.Header().Set("Content-Type", "text/html")
			_, _ = fmt.Fprintf(w, `<title>Batch report</title><div role="region" aria-label="Score">%d</div>`, page*7)
		default:
			w.Header().Set("Content-Type", "text/html")
			_, _ = io.WriteString(w, `<title>Examples</title><a href="/export">Export domains</a>`)
		}
	}))
	defer site.Close()
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	helper, err := filepath.Abs("../envapp/ui_src/scripts/redevenComputerHost.mjs")
	if err != nil {
		t.Fatal(err)
	}
	registry := NewTargetRegistry()
	target := TargetDescriptor{ID: "browser-main", Kind: "browser.managed", Capabilities: []string{"observe", "interaction"}}
	if err := registry.Register(target); err != nil {
		t.Fatal(err)
	}
	host := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{target.ID: NewPlaywrightTargetExecutor(node, helper, t.TempDir())}, t.TempDir())
	configureBrowserFixture(t, host)
	defer host.Close()
	target, err = host.PrepareTarget(t.Context(), target)
	if err != nil || !target.Ready {
		t.Fatalf("browser readiness: %+v %v", target, err)
	}
	owner := &run{stateDir: t.TempDir(), threadID: "examples"}
	call := TargetToolCall{ThreadID: "examples", TurnID: "turn", RunID: "run", TargetID: target.ID, ToolCallID: "examples", ToolName: "computer.exec", fullAccess: true, downloadWriter: owner.saveComputerDownload, revalidate: func(ctx context.Context) error { return ctx.Err() }}
	execute := func(code string) TargetToolResult {
		t.Helper()
		result, err := executeTestScript(t.Context(), host, call, code)
		if err != nil {
			t.Fatalf("example: %+v %v", result, err)
		}
		return result
	}
	quoted, _ := json.Marshal(site.URL)
	execute("await browser.navigate(" + string(quoted) + " + '/');")
	// A document root is not a rendered element. Rejecting its text read
	// must produce an accurate capability rejection and leave the page usable.
	for i := 0; i < 3; i++ {
		result, failure := executeTestScript(t.Context(), host, call, "const root=(await ui.snapshot({emit:false})).nodes.find(n=>n.role==='document'); await ui.ref(root.ref).text();")
		payload, _ := result.Result.(map[string]any)
		if failure == nil || payload["script_error"] != "TARGET_CAPABILITY_UNAVAILABLE" {
			t.Fatalf("read failure lost contract or target: error=%v payload=%+v", failure, payload)
		}
		execute("await ui.snapshot({emit:false});")
	}
	help, _ := computerScriptHelp("downloads", true)
	_, example, ok := strings.Cut(help, "Capture the cursor BEFORE one export action:\n")
	if !ok {
		t.Fatal("download example missing")
	}
	example, _, ok = strings.Cut(example, "\nUse the returned path")
	if !ok {
		t.Fatal("download example boundary missing")
	}
	execute(example)
	space, err := prepareTaskFiles(owner.stateDir, owner.threadID)
	if err != nil {
		t.Fatal(err)
	}
	files, err := os.ReadDir(space.Scratch)
	if err != nil || len(files) != 1 {
		t.Fatalf("saved files: %v %v", files, err)
	}
	actual, err := os.ReadFile(filepath.Join(space.Scratch, files[0].Name()))
	if err != nil || !bytes.Equal(actual, content) || exports.Load() != 1 {
		t.Fatalf("large download changed or replayed: size=%d exports=%d err=%v", len(actual), exports.Load(), err)
	}
	execute(`const downloads=(await browser.downloadCursor()).downloads; ui.assert(downloads.length===1); log({downloads:downloads.length});`)
	document, err := os.ReadFile("../../okf/ai/computer-use-scripts.md")
	if err != nil {
		t.Fatal(err)
	}
	_, example, ok = strings.Cut(string(document), "<!-- qualified-browser-batch -->\n```javascript\n")
	if !ok {
		t.Fatal("batch example missing")
	}
	example, _, ok = strings.Cut(example, "\n```")
	if !ok {
		t.Fatal("batch example end missing")
	}
	result := execute(strings.ReplaceAll(example, "https://example.test", site.URL))
	if len(result.Attachments) != 1 {
		t.Fatal("example did not return a real screenshot")
	}
	execute(`ui.assert(batchScores.length===3 && batchScores[0]===7 && batchScores[1]===14 && batchScores[2]===21); ui.assert(batchTotal===42);`)
}
