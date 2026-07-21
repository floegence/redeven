package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"testing"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

func TestResolveFlowerCanonicalReferenceTargetAuthorityUsesOnlyServerState(t *testing.T) {
	t.Parallel()

	t.Run("local runtime uses endpoint identity", func(t *testing.T) {
		authority, err := resolveFlowerCanonicalReferenceTargetAuthority(
			"env_local",
			ToolTargetPolicy{Mode: ToolTargetModeLocalRuntime},
			&threadstore.FlowerThreadRouting{PrimaryTargetID: "client-irrelevant"},
		)
		if err != nil {
			t.Fatal(err)
		}
		if authority.TargetID != "env_local" || authority.TargetLocality != contextActionLocalityCurrent || authority.SourceEnvPublicID != "env_local" {
			t.Fatalf("authority=%#v", authority)
		}
	})

	t.Run("explicit policy prefers default target", func(t *testing.T) {
		authority, err := resolveFlowerCanonicalReferenceTargetAuthority(
			"env_explicit",
			ToolTargetPolicy{
				Mode:             ToolTargetModeExplicitTarget,
				DefaultTargetID:  "target_policy",
				AllowedTargetIDs: []string{"target_policy", "target_routing"},
			},
			&threadstore.FlowerThreadRouting{PrimaryTargetID: "target_routing"},
		)
		if err != nil {
			t.Fatal(err)
		}
		if authority.TargetID != "target_policy" || authority.TargetLocality != contextActionLocalityRemote || authority.SourceEnvPublicID != "env_explicit" {
			t.Fatalf("authority=%#v", authority)
		}
	})

	t.Run("explicit policy uses current routing when default is absent", func(t *testing.T) {
		authority, err := resolveFlowerCanonicalReferenceTargetAuthority(
			"env_routed",
			ToolTargetPolicy{Mode: ToolTargetModeExplicitTarget, AllowedTargetIDs: []string{"target_routing"}},
			&threadstore.FlowerThreadRouting{PrimaryTargetID: "target_routing"},
		)
		if err != nil {
			t.Fatal(err)
		}
		if authority.TargetID != "target_routing" {
			t.Fatalf("authority=%#v", authority)
		}
	})

	for _, testCase := range []struct {
		name    string
		policy  ToolTargetPolicy
		routing *threadstore.FlowerThreadRouting
	}{
		{name: "missing explicit target", policy: ToolTargetPolicy{Mode: ToolTargetModeExplicitTarget}},
		{name: "routing target outside policy", policy: ToolTargetPolicy{Mode: ToolTargetModeExplicitTarget, AllowedTargetIDs: []string{"target_allowed"}}, routing: &threadstore.FlowerThreadRouting{PrimaryTargetID: "target_denied"}},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			if _, err := resolveFlowerCanonicalReferenceTargetAuthority("env_invalid", testCase.policy, testCase.routing); !errors.Is(err, ErrInvalidContextAction) {
				t.Fatalf("error=%v, want invalid context action", err)
			}
		})
	}
}

func TestAuthorizeFlowerContextActionTargetRejectsTargetAndHintForgedTogether(t *testing.T) {
	t.Parallel()

	authority := flowerCanonicalReferenceTargetAuthority{
		TargetID:          "target_authoritative",
		TargetLocality:    contextActionLocalityRemote,
		SourceEnvPublicID: "env_authoritative",
	}
	action := &ContextActionEnvelope{
		Target: ContextActionTarget{TargetID: "target_forged", Locality: contextActionLocalityAuto},
		ExecutionContext: &ContextActionExecutionHint{
			CurrentTargetID:   "target_forged",
			SourceEnvPublicID: "env_authoritative",
		},
	}
	if err := authorizeFlowerContextActionTarget(action, authority); !errors.Is(err, ErrInvalidContextAction) {
		t.Fatalf("error=%v, want invalid context action", err)
	}
}

func TestFloretSupplementalContextFormatsProcessSnapshot(t *testing.T) {
	t.Parallel()

	projection, err := floretContextProjectionForInput(RunInput{
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
		t.Fatalf("floretContextProjectionForInput: %v", err)
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
}

func TestFloretSupplementalContextKeepsFileContextOnly(t *testing.T) {
	t.Parallel()

	projection, err := floretContextProjectionForInput(RunInput{
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
			ExecutionContext:    &ContextActionExecutionHint{CurrentTargetID: "env_demo", SourceEnvPublicID: "env_demo"},
			Context:             []ContextActionContextItem{{Kind: "file_path", Path: "/workspace/secret.txt", RootLabel: "Workspace"}},
			Presentation:        ContextActionPresentation{Label: "Ask Flower", Priority: 100},
			SuggestedWorkingDir: "/workspace",
		},
	})
	if err != nil {
		t.Fatalf("floretContextProjectionForInput: %v", err)
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

	projection, err := floretContextProjectionForInput(RunInput{
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
		t.Fatalf("floretContextProjectionForInput: %v", err)
	}
	if len(projection.Items) != 1 {
		t.Fatalf("items=%#v, want one terminal item", projection.Items)
	}
	item := projection.Items[0]
	if !item.Truncated || item.Text != "" || item.Metadata["selection_truncated"] != "true" || item.Metadata["selection_chars"] == "" {
		t.Fatalf("terminal item=%#v, want metadata-only truncated selection", item)
	}
}

func TestFloretContextProjectionBuildsCanonicalReferencesAndSupplementalContextTogether(t *testing.T) {
	t.Parallel()

	newAction := func(surface string, item ContextActionContextItem) *ContextActionEnvelope {
		return &ContextActionEnvelope{
			SchemaVersion: ContextActionSchemaVersion,
			ActionID:      "assistant.ask.flower",
			Provider:      "flower",
			Target:        ContextActionTarget{TargetID: "current", Locality: "auto"},
			Source:        ContextActionSource{Surface: surface},
			ExecutionContext: &ContextActionExecutionHint{
				CurrentTargetID:   "env_demo",
				SourceEnvPublicID: "env_demo",
				RuntimeHint:       "auto",
				SessionSource:     "provider_environment",
			},
			Context:      []ContextActionContextItem{item},
			Presentation: ContextActionPresentation{Label: "Ask Flower", Priority: 100},
		}
	}
	tests := []struct {
		name        string
		surface     string
		item        ContextActionContextItem
		wantKind    flruntime.MessageReferenceKind
		wantText    string
		wantLocator bool
	}{
		{name: "text", surface: "git_browser", item: ContextActionContextItem{Kind: "text_snapshot", Title: "Quoted text", Content: "selected lines"}, wantKind: flruntime.MessageReferenceText, wantText: "selected lines"},
		{name: "file", surface: "file_browser", item: ContextActionContextItem{Kind: "file_path", Path: "/workspace/src/main.ts"}, wantKind: flruntime.MessageReferenceFile, wantLocator: true},
		{name: "directory", surface: "file_browser", item: ContextActionContextItem{Kind: "file_path", Path: "/workspace/src", IsDirectory: true}, wantKind: flruntime.MessageReferenceDirectory, wantLocator: true},
		{name: "terminal", surface: "terminal", item: ContextActionContextItem{Kind: "terminal_selection", WorkingDir: "/workspace", Selection: "pnpm test\nPASS", SelectionChars: 14}, wantKind: flruntime.MessageReferenceTerminal, wantText: "pnpm test\nPASS"},
		{name: "process", surface: "monitoring", item: ContextActionContextItem{Kind: "process_snapshot", PID: 4242, Name: "vite", Username: "dev", Platform: "darwin", CapturedAtMs: 1783677600000}, wantKind: flruntime.MessageReferenceProcess, wantText: "vite"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			projection, err := floretContextProjectionForInput(RunInput{
				Text:          "review this reference",
				ContextAction: newAction(test.surface, test.item),
			})
			if err != nil {
				t.Fatalf("floretContextProjectionForInput: %v", err)
			}
			if len(projection.References) != 1 || len(projection.Items) != 1 {
				t.Fatalf("projection=%#v, want one durable reference and one supplemental item", projection)
			}
			ref := projection.References[0]
			if ref.Kind != test.wantKind || ref.ReferenceID != "context:"+strconv.Itoa(0) || strings.TrimSpace(ref.Label) == "" {
				t.Fatalf("reference=%#v, want canonical %q reference", ref, test.wantKind)
			}
			if projection.Items[0].Kind != strings.TrimSpace(projection.Items[0].Kind) {
				t.Fatalf("supplemental=%#v, want normalized kind", projection.Items[0])
			}
			if test.wantText != "" && !strings.Contains(ref.Text, test.wantText) {
				t.Fatalf("reference=%#v, want display text containing %q", ref, test.wantText)
			}
			if test.wantLocator && ref.ResourceRef == "" {
				t.Fatalf("reference=%#v, want self-contained host locator", ref)
			}
		})
	}
}

func TestFloretContextResourceRefRequiresEndpointBoundTargetIdentity(t *testing.T) {
	t.Parallel()

	base := &ContextActionEnvelope{
		Target: ContextActionTarget{TargetID: "runtime-target", Locality: contextActionLocalityAuto},
		ExecutionContext: &ContextActionExecutionHint{
			CurrentTargetID:   "runtime-target",
			SourceEnvPublicID: "env_demo",
		},
	}
	resourceRef, err := floretContextResourceRef(base, ContextActionContextItem{Path: "/workspace/main.go"})
	if err != nil {
		t.Fatalf("floretContextResourceRef: %v", err)
	}
	locator, err := decodeFlowerCanonicalReferenceLocator(resourceRef)
	if err != nil {
		t.Fatalf("decode locator: %v", err)
	}
	if locator.CurrentTargetID != "runtime-target" || locator.SourceEnvPublicID != "env_demo" || !flowerCanonicalReferenceLocatorBelongsToEndpoint(locator, "env_demo") {
		t.Fatalf("locator=%#v, want exact endpoint-bound current target", locator)
	}

	for _, mutate := range []func(*ContextActionEnvelope){
		func(action *ContextActionEnvelope) { action.ExecutionContext = nil },
		func(action *ContextActionEnvelope) { action.ExecutionContext.SourceEnvPublicID = "" },
		func(action *ContextActionEnvelope) { action.ExecutionContext.CurrentTargetID = "runtime-other" },
		func(action *ContextActionEnvelope) { action.Target.Locality = contextActionLocalityRemote },
	} {
		action := *base
		hint := *base.ExecutionContext
		action.ExecutionContext = &hint
		mutate(&action)
		if resourceRef, err := floretContextResourceRef(&action, ContextActionContextItem{Path: "/workspace/main.go"}); !errors.Is(err, ErrInvalidContextAction) || resourceRef != "" {
			t.Fatalf("floretContextResourceRef()=(%q, %v), want invalid empty locator", resourceRef, err)
		}
	}
}

func TestFloretTurnInputAdmitsReferencesWithoutPersistingContextAction(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{})
	input := RunInput{
		ContextAction: &ContextActionEnvelope{
			SchemaVersion: ContextActionSchemaVersion,
			ActionID:      "assistant.ask.flower",
			Provider:      "flower",
			Target:        ContextActionTarget{TargetID: "current", Locality: "auto"},
			Source:        ContextActionSource{Surface: "terminal"},
			Context:       []ContextActionContextItem{{Kind: "terminal_selection", WorkingDir: "/workspace", Selection: "go test ./...", SelectionChars: 13}},
			Presentation:  ContextActionPresentation{Label: "Ask Flower", Priority: 100},
		},
	}
	projection, err := floretContextProjectionForInput(input)
	if err != nil {
		t.Fatalf("floretContextProjectionForInput: %v", err)
	}
	turnInput, err := r.floretTurnInput(context.Background(), input, projection.References)
	if err != nil {
		t.Fatalf("floretTurnInput: %v", err)
	}
	if len(turnInput.References) != 1 || turnInput.References[0].Kind != flruntime.MessageReferenceTerminal {
		t.Fatalf("turn input references=%#v, want canonical terminal reference", turnInput.References)
	}
	encoded, err := json.Marshal(turnInput)
	if err != nil {
		t.Fatalf("json.Marshal(turnInput): %v", err)
	}
	if strings.Contains(string(encoded), "context_action") || strings.Contains(string(encoded), "assistant.ask.flower") {
		t.Fatalf("canonical turn input retained host ContextAction envelope: %s", encoded)
	}
}
