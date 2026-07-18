package ai

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestFloretSupplementalContextFormatsProcessSnapshot(t *testing.T) {
	t.Parallel()

	projection, err := floretSupplementalContextForInput(RunInput{
		Text: "what is this process",
		ContextAction: &ContextActionEnvelope{
			SchemaVersion: ContextActionSchemaVersion,
			ActionID:      "assistant.ask.flower",
			Provider:      "flower",
			Target:        ContextActionTarget{TargetID: "current", Locality: "auto"},
			Source:        ContextActionSource{Surface: "monitoring", SurfaceID: "runtime-monitor"},
			Context: []ContextActionContextItem{{
				Kind:         "process_snapshot",
				PID:          12264,
				Name:         "Codex (Service)",
				Username:     "tangjianyin",
				CPUPercent:   0.24,
				MemoryBytes:  575668224,
				Platform:     "darwin",
				CapturedAtMs: 1783677600000,
			}},
			Presentation: ContextActionPresentation{Label: "Ask Flower", Priority: 100},
		},
	})
	if err != nil {
		t.Fatalf("floretSupplementalContextForInput: %v", err)
	}
	if len(projection.Items) != 1 {
		t.Fatalf("items=%#v, want one process context item", projection.Items)
	}
	item := projection.Items[0]
	if item.Kind != "process_snapshot" || item.Text != "" {
		t.Fatalf("process item=%#v, want metadata-only process snapshot", item)
	}
	for key, want := range map[string]string{
		"pid":            "12264",
		"name":           "Codex (Service)",
		"username":       "tangjianyin",
		"cpu_percent":    "0.24",
		"memory_bytes":   "575668224",
		"platform":       "darwin",
		"captured_at":    "2026-07-10T10:00:00Z",
		"source_surface": "monitoring",
	} {
		if got := item.Metadata[key]; got != want {
			t.Fatalf("metadata[%q]=%q, want %q in %#v", key, got, want, item.Metadata)
		}
	}
	if projection.ContextHash == "" || projection.RenderedChars <= 0 || projection.Truncated {
		t.Fatalf("projection=%#v, want hash/rendered chars without truncation", projection)
	}
	event := floretContextActionInjectedEventPayload((&ContextActionEnvelope{
		SchemaVersion: ContextActionSchemaVersion,
		ActionID:      "assistant.ask.flower",
		Provider:      "flower",
		Target:        ContextActionTarget{TargetID: "current", Locality: "auto"},
		Source:        ContextActionSource{Surface: "monitoring"},
		Context: []ContextActionContextItem{{
			Kind:         "process_snapshot",
			PID:          12264,
			Name:         "Codex (Service)",
			Username:     "tangjianyin",
			CPUPercent:   0.24,
			MemoryBytes:  575668224,
			Platform:     "darwin",
			CapturedAtMs: 1783677600000,
		}},
		Presentation: ContextActionPresentation{Label: "Ask Flower", Priority: 100},
	}), projection)
	if event == nil || event["context_hash"] == "" || event["supplemental_items"] != 1 {
		t.Fatalf("event=%#v, want aggregate injection metadata", event)
	}
	eventJSON, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("json.Marshal(event): %v", err)
	}
	for _, forbidden := range []string{"12264", "Codex", "tangjianyin", "575668224", "/workspace", "/_redeven_proxy/api/ai/uploads"} {
		if strings.Contains(string(eventJSON), forbidden) {
			t.Fatalf("injected event leaked raw context value %q: %s", forbidden, eventJSON)
		}
	}
}

func TestFloretSupplementalContextKeepsFileContextOnly(t *testing.T) {
	t.Parallel()

	projection, err := floretSupplementalContextForInput(RunInput{
		Text: "review this",
		Attachments: []RunAttachmentIn{{
			Name:     "secret.txt",
			MimeType: "text/plain",
			URL:      "/_redeven_proxy/api/ai/uploads/upl_secret",
		}},
		ContextAction: &ContextActionEnvelope{
			SchemaVersion:       ContextActionSchemaVersion,
			ActionID:            "assistant.ask.flower",
			Provider:            "flower",
			Target:              ContextActionTarget{TargetID: "current", Locality: "auto"},
			Source:              ContextActionSource{Surface: "file_preview"},
			Context:             []ContextActionContextItem{{Kind: "file_path", Path: "/workspace/secret.txt", RootLabel: "Workspace"}},
			Presentation:        ContextActionPresentation{Label: "Ask Flower", Priority: 100},
			SuggestedWorkingDir: "/workspace",
		},
	})
	if err != nil {
		t.Fatalf("floretSupplementalContextForInput: %v", err)
	}
	if len(projection.Items) != 1 {
		t.Fatalf("items=%#v, want file path context only", projection.Items)
	}
	for _, item := range projection.Items {
		if item.Text != "" {
			t.Fatalf("metadata-only item carried text: %#v", item)
		}
		if strings.Contains(item.Metadata["name"], "upl_secret") || strings.Contains(item.Metadata["path"], "package main") {
			t.Fatalf("metadata leaked forbidden content: %#v", item.Metadata)
		}
	}
}

func TestFloretSupplementalContextTruncatesLargeTerminalSelection(t *testing.T) {
	t.Parallel()

	projection, err := floretSupplementalContextForInput(RunInput{
		ContextAction: &ContextActionEnvelope{
			SchemaVersion: ContextActionSchemaVersion,
			ActionID:      "assistant.ask.flower",
			Provider:      "flower",
			Target:        ContextActionTarget{TargetID: "current", Locality: "auto"},
			Source:        ContextActionSource{Surface: "terminal"},
			Context:       []ContextActionContextItem{{Kind: "terminal_selection", WorkingDir: "/workspace", SelectionChars: floretTerminalSelectionInlineChars + 1}},
			Presentation:  ContextActionPresentation{Label: "Ask Flower", Priority: 100},
		},
	})
	if err != nil {
		t.Fatalf("floretSupplementalContextForInput: %v", err)
	}
	if len(projection.Items) != 1 {
		t.Fatalf("items=%#v, want one terminal item", projection.Items)
	}
	item := projection.Items[0]
	if !item.Truncated || item.Text != "" || item.Metadata["selection_truncated"] != "true" || item.Metadata["selection_chars"] == "" {
		t.Fatalf("terminal item=%#v, want metadata-only truncated selection", item)
	}
}
