package ai

import (
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestConversationPreferencesResolveOnlyNewThreadsAndSurviveRestart(t *testing.T) {
	home := t.TempDir()
	var err error
	home, err = filepath.EvalSymlinks(home)
	if err != nil {
		t.Fatal(err)
	}
	directory := filepath.Join(home, "chosen")
	if err := os.Mkdir(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	const modelA = "deepseek/deepseek-v4-flash"
	const modelB = "deepseek/deepseek-v4-pro"
	meta := &session.Meta{NamespacePublicID: "ns", EndpointID: "env", UserPublicID: "alice", CanRead: true, CanWrite: true, CanExecute: true}
	open := func() *Service {
		t.Helper()
		svc, err := NewService(Options{StateDir: home, AgentHomeDir: home, Shell: "/bin/sh", Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), Config: &config.AIConfig{CurrentModelID: modelB, Providers: []config.AIProvider{{ID: "deepseek", Type: "deepseek", Models: []config.AIProviderModel{{ModelName: "deepseek-v4-flash"}, {ModelName: "deepseek-v4-pro"}}}}}})
		if err != nil {
			t.Fatal(err)
		}
		return svc
	}
	svc := open()
	defer func() { _ = svc.Close() }()
	revision := int64(0)
	a := modelA
	preferences, err := svc.PatchConversationPreferences(t.Context(), meta, ConversationPreferencePatch{ExpectedRevision: &revision, ModelID: &a, WorkingDir: &directory, Reasoning: &ConversationReasoningPreference{ModelID: modelA, Selection: config.AIReasoningSelection{Level: config.AIReasoningLevelOff}}})
	if err != nil {
		t.Fatal(err)
	}
	create := func(req CreateThreadRequest) threadstore.ThreadSettings {
		t.Helper()
		settings, err := svc.buildThreadCreateSettings(t.Context(), meta, req)
		if err != nil {
			t.Fatal(err)
		}
		return settings
	}
	remembered := create(CreateThreadRequest{})
	if remembered.ModelID != modelA || remembered.WorkingDir != directory || remembered.ReasoningSelectionJSON != `{"level":"off"}` {
		t.Fatalf("new defaults=%+v", remembered)
	}
	explicit := create(CreateThreadRequest{ModelID: modelB, WorkingDir: home, ReasoningSelection: config.AIReasoningSelection{Level: config.AIReasoningLevelDefault}})
	if explicit.ModelID != modelB || explicit.WorkingDir != home || explicit.ReasoningSelectionJSON == remembered.ReasoningSelectionJSON {
		t.Fatalf("explicit defaults=%+v", explicit)
	}
	// Reading/creating with B is not a selection event and cannot update A's preference.
	afterRead, err := svc.GetConversationPreferences(t.Context(), meta)
	if err != nil || afterRead.ModelID != modelA || afterRead.Revision != preferences.Revision {
		t.Fatalf("read polluted defaults=%+v err=%v", afterRead, err)
	}
	revision = preferences.Revision
	preferences, err = svc.PatchConversationPreferences(t.Context(), meta, ConversationPreferencePatch{ExpectedRevision: &revision, Reasoning: &ConversationReasoningPreference{ModelID: modelB, Selection: config.AIReasoningSelection{Level: config.AIReasoningLevelOff}}})
	if err != nil || preferences.ModelID != modelA || len(preferences.ReasoningByModel) != 2 {
		t.Fatalf("reasoning-only=%+v err=%v", preferences, err)
	}
	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}
	svc = open()
	remembered = create(CreateThreadRequest{})
	if remembered.ModelID != modelA || remembered.WorkingDir != directory || remembered.ReasoningSelectionJSON != `{"level":"off"}` {
		t.Fatalf("restart defaults=%+v", remembered)
	}
	bob := *meta
	bob.UserPublicID = "bob"
	isolated, err := svc.buildThreadCreateSettings(t.Context(), &bob, CreateThreadRequest{})
	if err != nil || isolated.ModelID != modelB || isolated.WorkingDir != home {
		t.Fatalf("user isolation=%+v err=%v", isolated, err)
	}
	// Rejected writes do not change any field, including a mixed valid/invalid patch.
	current, err := svc.GetConversationPreferences(t.Context(), meta)
	if err != nil {
		t.Fatal(err)
	}
	revision = current.Revision
	invalidModel := "removed/model"
	if _, err := svc.PatchConversationPreferences(t.Context(), meta, ConversationPreferencePatch{ExpectedRevision: &revision, ModelID: &invalidModel, WorkingDir: &home}); err == nil {
		t.Fatal("accepted unavailable model")
	}
	if _, err := svc.PatchConversationPreferences(t.Context(), meta, ConversationPreferencePatch{ExpectedRevision: &revision, Reasoning: &ConversationReasoningPreference{ModelID: modelA, Selection: config.AIReasoningSelection{Level: "unknown"}}}); err == nil {
		t.Fatal("accepted invalid reasoning")
	}
	readOnly := *meta
	readOnly.CanWrite = false
	if _, err := svc.PatchConversationPreferences(t.Context(), &readOnly, ConversationPreferencePatch{ExpectedRevision: &revision, ModelID: &a}); err == nil {
		t.Fatal("accepted read-only write")
	}
	unchanged, err := svc.GetConversationPreferences(t.Context(), meta)
	if err != nil || unchanged.Revision != revision || unchanged.WorkingDir != directory {
		t.Fatalf("rejected write changed preference: %+v %v", unchanged, err)
	}
	// A formerly valid but now unavailable model remains intentional, never fallback.
	stored, err := svc.snapshotThreadStore().PatchConversationPreferences(t.Context(), conversationPreferenceScope(meta), threadstore.ConversationPreferencePatch{ExpectedRevision: revision, ModelID: &invalidModel})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.buildThreadCreateSettings(t.Context(), meta, CreateThreadRequest{}); err == nil {
		t.Fatal("unavailable remembered model silently fell back")
	}
	if settings := create(CreateThreadRequest{ModelID: modelA}); settings.ModelID != modelA {
		t.Fatal("explicit model did not override unavailable memory")
	}
	revision = stored.Revision
	if _, err := svc.PatchConversationPreferences(t.Context(), meta, ConversationPreferencePatch{ExpectedRevision: &revision, ModelID: &a}); err != nil {
		t.Fatal(err)
	}
	// Capability-invalid remembered reasoning must not be discarded at admission.
	current, err = svc.GetConversationPreferences(t.Context(), meta)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.snapshotThreadStore().PatchConversationPreferences(t.Context(), conversationPreferenceScope(meta), threadstore.ConversationPreferencePatch{ExpectedRevision: current.Revision, Reasoning: &threadstore.ModelReasoningPreference{ModelID: modelA, SelectionJSON: `{"level":"high","budget_tokens":4096}`}}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.buildThreadCreateSettings(t.Context(), meta, CreateThreadRequest{}); err == nil {
		t.Fatal("capability-invalid remembered reasoning silently fell back")
	}
	if _, err := svc.buildThreadCreateSettings(t.Context(), meta, CreateThreadRequest{ReasoningSelection: config.AIReasoningSelection{Level: config.AIReasoningLevelOff}}); err != nil {
		t.Fatalf("explicit reasoning did not override unavailable memory: %v", err)
	}
	current, err = svc.GetConversationPreferences(t.Context(), meta)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.PatchConversationPreferences(t.Context(), meta, ConversationPreferencePatch{ExpectedRevision: &current.Revision, Reasoning: &ConversationReasoningPreference{ModelID: modelA, Selection: config.AIReasoningSelection{Level: config.AIReasoningLevelOff}}}); err != nil {
		t.Fatal(err)
	}
	// Invalid remembered paths remain remembered; creation fails instead of using Home.
	if err := os.Remove(directory); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.buildThreadCreateSettings(t.Context(), meta, CreateThreadRequest{}); err == nil {
		t.Fatal("missing remembered directory silently fell back")
	}
	afterFailure, err := svc.GetConversationPreferences(t.Context(), meta)
	if err != nil || afterFailure.WorkingDir != directory {
		t.Fatalf("invalid intent discarded: %+v %v", afterFailure, err)
	}
	stale := int64(0)
	if _, err := svc.PatchConversationPreferences(t.Context(), meta, ConversationPreferencePatch{ExpectedRevision: &stale, ModelID: &a}); !errors.Is(err, threadstore.ErrConversationPreferenceConflict) {
		t.Fatalf("stale=%v", err)
	}
	denied := *meta
	denied.CanWrite = false
	if _, err := svc.PatchConversationPreferences(t.Context(), &denied, ConversationPreferencePatch{ExpectedRevision: &revision, ModelID: &a}); !errors.Is(err, errRWXPermissionDenied) {
		t.Fatalf("permission=%v", err)
	}
}
