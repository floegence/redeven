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

func TestComputerAnimationProviderEvidenceQualification(t *testing.T) {
	if os.Getenv("REDEVEN_COMPUTER_RELIABILITY_E2E") != "1" {
		t.Skip("explicit real-browser qualification required")
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	helper, _ := filepath.Abs("../envapp/ui_src/scripts/redevenComputerHost.mjs")
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
	fixture := filepath.Join(t.TempDir(), "animation.html")
	if err := os.WriteFile(fixture, []byte(`<title>Animation evidence</title><svg role="img" aria-label="Flower animation"></svg><button onclick="document.querySelector('output').textContent='Animation paused';document.querySelector('output').setAttribute('aria-label','Animation paused')">Pause animation</button><output role="status" aria-label="Animation running">Animation running</output>`), 0600); err != nil {
		t.Fatal(err)
	}
	url, _ := json.Marshal("file://" + fixture)
	call := TargetToolCall{ThreadID: "animation", TurnID: "turn", RunID: "run", TargetID: target.ID, ToolCallID: "animation", ToolName: "computer.exec", fullAccess: true, revalidate: func(ctx context.Context) error { return ctx.Err() }}
	result, err := executeTestScript(t.Context(), host, call, "await browser.navigate("+string(url)+"); await ui.getByRole('button',{name:'Pause animation',exact:true}).click(); await ui.observe({full:true});")
	if err != nil {
		t.Fatalf("animation: %+v %v", result, err)
	}
	published, err := floretToolResultFromFlower(nil, ToolResult{ToolID: "animation", ToolName: "computer.exec", Status: toolResultStatusSuccess, Data: result.Result})
	if err != nil {
		t.Fatal(err)
	}
	_, notice, err := prepareModelImage(t.Context(), ContentPart{Type: "image", MimeType: "image/png", FileURI: testModelImageURI(t)})
	if err != nil {
		t.Fatal(err)
	}
	input, _ := json.Marshal([]any{map[string]any{"type": "function_call_output", "call_id": "animation", "output": []any{map[string]any{"type": "input_text", "text": published.Text + "\n" + notice}}}})
	parser, _ := filepath.Abs("../envapp/ui_src/scripts/computerFileAcceptance.mjs")
	command := exec.Command(node, "--input-type=module", "-e", `const {fileAnimationFacts}=await import(process.argv[1]); let raw='';for await(const chunk of process.stdin)raw+=chunk;const facts=fileAnimationFacts(JSON.parse(raw));if(!facts.some(f=>f.animation_state==='paused'&&f.action_executed&&f.image_observed))throw Error('Missing animation evidence: '+raw);`, parser)
	command.Stdin = bytes.NewReader(input)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("provider evidence parser: %v\n%s", err, output)
	}
}

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
		case "/large":
			w.Header().Set("Content-Type", "text/html")
			_, _ = io.WriteString(w, "<title>Large source</title>"+strings.Repeat("<p>"+strings.Repeat("Source text ", 45)+"</p>", 180))
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
	// The guest keeps structured identities; only the automatic model surface
	// uses tree text. Verify the final published Floret result, not just a helper.
	observed := execute("const tree=await ui.snapshot(); ui.assert(Array.isArray(tree.nodes)); globalThis.exportRef=tree.nodes.find(n=>n.role==='link'&&n.name==='Export domains').ref;")
	payload := observed.Result.(map[string]any)
	textObservation := payload["observation"].(map[string]any)
	if textObservation["encoding"] != "tree_text" || textObservation["nodes"] != nil || !strings.Contains(textObservation["tree"].(string), "Export domains") {
		t.Fatalf("real-browser model observation: %+v", textObservation)
	}
	published, publishErr := floretToolResultFromFlower(nil, ToolResult{ToolID: "qualified-observation", ToolName: "computer.exec", Status: toolResultStatusSuccess, Data: payload})
	if publishErr != nil || !strings.Contains(published.Text, "tree_text") {
		t.Fatalf("final provider boundary: %v", publishErr)
	}
	hidden := execute("const snapshot=await ui.snapshot({emit:false,limit:1}); log(snapshot.nodes.length);")
	hiddenPayload := hidden.Result.(map[string]any)
	reads := toAnySlice(hiddenPayload["read_outcomes"])
	read := reads[0].(map[string]any)
	if read["source_truncated"] != true || read["returned_count"] != 1 || hiddenPayload["observation"] != nil {
		t.Fatalf("real source completeness lost: %#v", hiddenPayload)
	}
	if textObservation["read_options_scope"] != "method_inventory" {
		t.Fatal("method inventory scope missing")
	}
	execute("const detail=await ui.ref(exportRef).node(); ui.assert(detail.role==='link'); await ui.snapshot({full:true});")
	// Execute the core reference's authored examples against an observed HTML
	// element, so the documented object return cannot drift into a scalar.
	guide, _ := computerScriptHelp("core", true)
	examples := 0
	for _, line := range strings.Split(guide, "\n") {
		_, example, found := strings.Cut(line, "Example: ")
		if !found {
			continue
		}
		example, _, _ = strings.Cut(example, " Details:")
		result := execute(strings.ReplaceAll(example, "'observed-ref'", "exportRef"))
		payload := result.Result.(map[string]any)
		if examples == 0 {
			if payload["observation"] == nil || len(toAnySlice(payload["logs"])) != 0 {
				t.Fatalf("core observation example failed: %#v", payload)
			}
		} else {
			logs := toAnySlice(payload["logs"])
			if len(logs) != 1 {
				t.Fatalf("structured log missing: %#v", payload)
			}
			values := toAnySlice(logs[0])
			if len(values) != 1 {
				t.Fatalf("text example changed shape: %#v", values)
			}
			value, ok := values[0].(map[string]any)
			if !ok || value["text"] != "Export domains" || value["truncated"] != false {
				t.Fatalf("text example lost source facts: %#v", value)
			}
		}
		examples++
	}
	if examples != 2 {
		t.Fatalf("core examples changed without qualification: %d", examples)
	}
	execute(`const fields=await ui.ref(exportRef).source(); ui.assert(Array.isArray(fields.fields)); const condition=await ui.ref(exportRef).waitFor({state:'visible',timeout_ms:0}); ui.assert(condition.state==='visible');`)

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
	// Task-specific composition belongs in the qualification fixture, not core
	// help. Keep the same exact download/no-replay acceptance after help moved
	// to a method reference.
	execute(`const cursor=await browser.downloadCursor(); await ui.getByRole('link',{name:'Export domains',exact:true}).click(); const receipt=await cursor.wait({timeout_ms:5000}); log(await browser.saveDownload(receipt.download.id));`)

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
	_, example, ok := strings.Cut(string(document), "<!-- qualified-browser-batch -->\n```javascript\n")
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

	// The default example publishes bounded source content even when raw node
	// logging would exceed its separate budget. Source loss stays independent.
	execute("await browser.navigate(" + string(quoted) + " + '/large');")
	execute(`const tree=await ui.snapshot({limit:1000,emit:false}); ui.assert(JSON.stringify(tree.nodes).length>65536);`)
	_, example, _ = strings.Cut(guide, "Example: ")
	example, _, _ = strings.Cut(example, "\n")
	large := execute(example)
	published, publishErr = floretToolResultFromFlower(nil, ToolResult{ToolID: "large-example", ToolName: "computer.exec", Status: toolResultStatusSuccess, Data: large.Result})
	if publishErr != nil {
		t.Fatal(publishErr)
	}
	var model map[string]any
	if err := json.Unmarshal([]byte(published.Text), &model); err != nil {
		t.Fatal(err)
	}
	data := model["data"].(map[string]any)
	read = data["read_outcomes"].([]any)[0].(map[string]any)
	if model["truncated"] != false || data["truncated"] != false || read["source_truncated"] != true || read["truncated"] != true || !strings.Contains(published.Text, "Source text") || len(toAnySlice(data["logs"])) != 0 {
		t.Fatalf("large example lost output or conflated truncation: %#v", model)
	}
}
