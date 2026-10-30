package ai

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"

	flruntime "github.com/floegence/floret/v7/runtime"
	contextmodel "github.com/floegence/redeven/internal/ai/context/model"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
)

func TestOpaqueAttachmentUploadToModelToolExecutionAndRestart(t *testing.T) {
	var source bytes.Buffer
	writer := zip.NewWriter(&source)
	for _, entry := range []struct{ name, body string }{
		{"[Content_Types].xml", `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`},
		{"_rels/.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`},
		{"xl/workbook.xml", `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Positions" sheetId="1" r:id="rId1"/></sheets></workbook>`},
		{"xl/_rels/workbook.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`},
		{"xl/worksheets/sheet1.xml", `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>POSITION_MARKER</t></is></c></row></sheetData></worksheet>`},
	} {
		file, err := writer.Create(entry.name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(file, entry.body); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	var locator atomic.Value
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		flusher := w.(http.Flusher)
		w.Header().Set("Content-Type", "text/event-stream")
		tools, _ := body["tools"].([]any)
		if len(tools) == 0 {
			writeAskUserIntegrationTextResponse(w, flusher, "title", "Spreadsheet")
			return
		}
		input, _ := json.Marshal(body["input"])
		if !bytes.Contains(input, []byte(locator.Load().(string))) || !bytes.Contains(input, []byte("attachment.materialize")) {
			t.Error("provider request omitted the attachment locator or processing instructions")
		}
		if bytes.Contains(input, []byte("input_file")) || bytes.Contains(input, []byte("base64,")) {
			t.Error("opaque bytes were sent as native file input")
		}
		if calls.Add(1)%2 == 1 {
			args, _ := json.Marshal(map[string]any{"locator": locator.Load().(string)})
			item := map[string]any{"type": "function_call", "id": fmt.Sprintf("materialize-%d", calls.Load()), "call_id": fmt.Sprintf("materialize-%d", calls.Load()), "name": "attachment_materialize", "arguments": string(args)}
			writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.added", "output_index": 0, "item": item})
			writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.done", "output_index": 0, "item": item})
			writeAskUserIntegrationCompletedResponse(w, flusher, fmt.Sprintf("materialize-response-%d", calls.Load()))
			return
		}
		items, _ := body["input"].([]any)
		var workPath string
		for _, raw := range items {
			item, _ := raw.(map[string]any)
			if item["type"] != "function_call_output" || item["call_id"] != fmt.Sprintf("materialize-%d", calls.Load()-1) {
				continue
			}
			output, _ := item["output"].(string)
			var result map[string]any
			if json.Unmarshal([]byte(output), &result) == nil {
				data, _ := result["data"].(map[string]any)
				if path, ok := data["file_path"].(string); ok {
					workPath = path
				}
			}
		}
		if workPath == "" {
			t.Error("provider did not receive a materialized file result")
		} else if copied, err := os.ReadFile(workPath); err != nil || !bytes.Equal(copied, source.Bytes()) {
			t.Errorf("working spreadsheet differs from original: %v", err)
		} else {
			workbook, err := zip.NewReader(bytes.NewReader(copied), int64(len(copied)))
			if err != nil {
				t.Error(err)
				return
			}
			sheet, err := workbook.Open("xl/worksheets/sheet1.xml")
			if err != nil {
				t.Error(err)
				return
			}
			content, err := io.ReadAll(sheet)
			_ = sheet.Close()
			if err != nil || !bytes.Contains(content, []byte("POSITION_MARKER")) {
				t.Errorf("spreadsheet cell cannot be extracted: %v", err)
			}
		}
		writeAskUserIntegrationTextResponse(w, flusher, fmt.Sprintf("done-%d", calls.Load()), "Spreadsheet is available for processing.")
	}))
	defer server.Close()
	state := t.TempDir()
	svc := openRealtimeTestService(t, state, server.URL)
	defer func() { _ = svc.Close() }()
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Spreadsheet", "", string(FlowerPermissionFullAccess), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner, err := NewUploadOwner(meta.EndpointID, meta.UserPublicID, meta.ChannelID)
	if err != nil {
		t.Fatal(err)
	}
	scope, err := svc.CreateUploadStagingScope(t.Context(), owner, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	const name = "positions.xlsx"
	upload, err := svc.SaveUpload(t.Context(), SaveUploadRequest{Owner: owner, StagingScopeID: scope.StagingScopeID, StagingCapability: scope.Capability, Reader: bytes.NewReader(source.Bytes()), DisplayName: name, DeclaredMediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", UploadRequestID: "spreadsheet", ExpectedContentSHA256: fmt.Sprintf("%x", sha256.Sum256(source.Bytes())), ExpectedSizeBytes: int64(source.Len()), DisplayNameSHA256: fmt.Sprintf("%x", sha256.Sum256([]byte(name)))})
	if err != nil {
		t.Fatal(err)
	}
	locator.Store(upload.LogicalLocator)
	sent, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ClientRequestID: "spreadsheet-turn", ThreadID: thread.ThreadID, StagingScopeID: scope.StagingScopeID, StagingCapability: scope.Capability, Input: RunInput{Text: "Inspect this spreadsheet.", Attachments: []RunAttachmentIn{{AttachmentID: upload.AttachmentID}}}})
	if err != nil {
		t.Fatal(err)
	}
	waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool { return view.RunStatus == "success" || view.RunStatus == "failed" })
	if calls.Load() != 2 {
		t.Fatalf("first turn made %d provider calls, want 2", calls.Load())
	}
	if _, err := svc.OpenCanonicalLiveAttachmentForTurn(t.Context(), owner, thread.ThreadID, sent.TurnID, upload.AttachmentID); err != nil {
		t.Fatal(err)
	}
	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}
	svc = openRealtimeTestService(t, state, server.URL)
	if _, err := runTypedTurnForTest(t, t.Context(), svc, meta, "read-after-restart", RunStartRequest{ThreadID: thread.ThreadID, Input: RunInput{Text: "Inspect the same spreadsheet again."}}); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 4 {
		t.Fatalf("restart made %d provider calls, want 4", calls.Load())
	}
}

func TestOpaqueUploadsPreserveStrictTextAndNativeRoutes(t *testing.T) {
	inspector := newUploadInspector()
	_, _ = inspector.Write([]byte{0xff, 0})
	if _, _, _, err := classifyUpload(inspector, threadstore.UploadSourceLongText); err == nil {
		t.Fatal("invalid pasted text accepted")
	}
	for _, body := range []string{"<html><script>active()</script></html>", "<?xml version=\"1.0\"?><svg/>", "ordinary text"} {
		inspector := newUploadInspector()
		_, _ = inspector.Write([]byte(body))
		media, points, lines, err := classifyUpload(inspector, threadstore.UploadSourceFile)
		if err != nil || media != "text/plain; charset=utf-8" || points == nil || lines == nil {
			t.Fatalf("safe text type=%q error=%v", media, err)
		}
	}
	adapter := newFloretProviderAdapter(nil, "openai", "model", ProviderControls{}, TurnBudgets{}, "", withFloretAttachmentResolver(nil, true, true), withFloretAttachmentToolRead(true))
	for _, media := range []string{"image/png", "application/pdf", "text/plain; charset=utf-8"} {
		if attachmentUsesManifest(adapter, flruntime.MessageAttachment{MIMEType: media}) {
			t.Errorf("native route changed for %s", media)
		}
	}
	for _, provider := range []*floretProviderAdapter{nil, {supportsFileInput: true}} {
		if !attachmentUsesManifest(provider, flruntime.MessageAttachment{MIMEType: "application/octet-stream"}) {
			t.Fatal("attachment manifest blocked without tool support")
		}
	}
	capability := attachmentCapabilitiesForModel("no-tools", config.AIProvider{Type: "openai"}, contextmodel.ModelCapability{SupportsFileInput: true})
	if got := attachmentRouteForTest(t, capability, "application/octet-stream"); got != "attachment_manifest" {
		t.Fatal(got)
	}
}

func TestUploadAcceptsOpaqueFilesForToolProcessing(t *testing.T) {
	for _, tc := range []struct {
		name string
		body []byte
	}{
		{"xlsx container", []byte{'P', 'K', 3, 4, 0, 0, 0, 0}},
		{"xls compound document", []byte{0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1}},
		{"unknown binary", []byte{0, 0xff, 0x80, 1}},
		{"non UTF8 text", append([]byte("plain text "), 0xff)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			inspector := newUploadInspector()
			if _, err := inspector.Write(tc.body); err != nil {
				t.Fatal(err)
			}
			mediaType, points, lines, err := classifyUpload(inspector, threadstore.UploadSourceFile)
			if err != nil || mediaType != "application/octet-stream" || points != nil || lines != nil {
				t.Fatalf("opaque attachment: type=%q points=%v lines=%v error=%v", mediaType, points, lines, err)
			}
		})
	}
}

func TestToolCapableModelsAcceptOpaqueAttachments(t *testing.T) {
	for _, providerType := range []string{"moonshot", "openai_compatible", "anthropic", "openai"} {
		t.Run(providerType, func(t *testing.T) {
			capability := attachmentCapabilitiesForModel("provider/model", config.AIProvider{Type: providerType}, contextmodel.ModelCapability{ModelName: "model", SupportsTools: true})
			if got := attachmentRouteForTest(t, capability, "application/octet-stream"); got != "tool_read" {
				t.Fatalf("binary route=%q", got)
			}
			adapter := newFloretProviderAdapter(nil, providerType, "model", ProviderControls{}, TurnBudgets{}, "", withFloretAttachmentToolRead(true))
			for _, mediaType := range []string{"application/octet-stream", "application/pdf", "image/png"} {
				if !attachmentUsesManifest(adapter, flruntime.MessageAttachment{MIMEType: mediaType}) {
					t.Errorf("no tool route for %s", mediaType)
				}
			}
		})
	}
}
