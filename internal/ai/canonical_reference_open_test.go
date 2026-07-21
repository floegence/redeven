package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

func TestResolveFlowerCanonicalReferenceOpenTargetUsesExactFloretIdentity(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := newWorkingDirTestService(t, t.TempDir())
	meta := timelineTestMeta("env_reference_open")
	thread, err := svc.CreateThread(ctx, meta, "reference open", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	filePath := filepath.Join(svc.agentHomeDir, "src", "main.ts")
	directoryPath := filepath.Dir(filePath)
	if err := os.MkdirAll(directoryPath, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filePath, []byte("export const answer = 42\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	fileLocator := canonicalReferenceLocatorForTest(t, meta.EndpointID, filePath, false)
	directoryLocator := canonicalReferenceLocatorForTest(t, meta.EndpointID, directoryPath, true)
	host := newTestFloretHostFromService(t, svc, thread.ThreadID, "done")
	if _, err := host.RunTurn(ctx, flruntime.RunTurnRequest{
		ThreadID: flruntime.ThreadID(thread.ThreadID),
		TurnID:   "turn_reference_open",
		RunID:    "run_reference_open",
		Input: flruntime.TurnInput{References: []flruntime.MessageReference{
			{ReferenceID: "context:0", Kind: flruntime.MessageReferenceFile, Label: "main.ts", ResourceRef: fileLocator},
			{ReferenceID: "context:1", Kind: flruntime.MessageReferenceDirectory, Label: "src", ResourceRef: directoryLocator},
			{ReferenceID: "context:2", Kind: flruntime.MessageReferenceText, Label: "quote", Text: "visible"},
		}},
		SupplementalContext: []flruntime.TurnSupplementalContextItem{
			{Kind: contextActionKindFilePath, Title: "Linked file path", Metadata: map[string]string{"path": filePath}, Sensitive: true},
			{Kind: contextActionKindFilePath, Title: "Linked directory path", Metadata: map[string]string{"path": directoryPath}, Sensitive: true},
			{Kind: contextActionKindText, Title: "quote", Text: "visible"},
		},
	}); err != nil {
		t.Fatalf("RunTurn: %v", err)
	}

	fileTarget, err := svc.ResolveFlowerCanonicalReferenceOpenTarget(ctx, meta, FlowerCanonicalReferenceOpenRequest{
		ThreadID: thread.ThreadID, TurnID: "turn_reference_open", ReferenceID: "context:0",
	})
	if err != nil {
		t.Fatalf("resolve file: %v", err)
	}
	if fileTarget.Kind != "file" || fileTarget.Path != filePath || fileTarget.Label != "main.ts" {
		t.Fatalf("file target=%#v", fileTarget)
	}

	directoryTarget, err := svc.ResolveFlowerCanonicalReferenceOpenTarget(ctx, meta, FlowerCanonicalReferenceOpenRequest{
		ThreadID: thread.ThreadID, TurnID: "turn_reference_open", ReferenceID: "context:1",
	})
	if err != nil {
		t.Fatalf("resolve directory: %v", err)
	}
	if directoryTarget.Kind != "directory" || directoryTarget.Path != directoryPath || directoryTarget.Label != "src" {
		t.Fatalf("directory target=%#v", directoryTarget)
	}

	_, err = svc.ResolveFlowerCanonicalReferenceOpenTarget(ctx, meta, FlowerCanonicalReferenceOpenRequest{
		ThreadID: thread.ThreadID, TurnID: "turn_reference_open", ReferenceID: "context:2",
	})
	if !errors.Is(err, ErrFlowerCanonicalReferenceType) {
		t.Fatalf("text reference error=%v, want type error", err)
	}
	_, err = svc.ResolveFlowerCanonicalReferenceOpenTarget(ctx, meta, FlowerCanonicalReferenceOpenRequest{
		ThreadID: thread.ThreadID, TurnID: "turn_other", ReferenceID: "context:0",
	})
	if !errors.Is(err, ErrFlowerCanonicalReferenceNotFound) {
		t.Fatalf("wrong turn error=%v, want not found", err)
	}
	_, err = svc.ResolveFlowerCanonicalReferenceOpenTarget(ctx, meta, FlowerCanonicalReferenceOpenRequest{
		ThreadID: thread.ThreadID, TurnID: "turn_reference_open", ReferenceID: "context:missing",
	})
	if !errors.Is(err, ErrFlowerCanonicalReferenceNotFound) {
		t.Fatalf("wrong reference error=%v, want not found", err)
	}
}

func TestResolveFlowerCanonicalReferenceOpenTargetReauthorizesCurrentSessionAndScope(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := newWorkingDirTestService(t, t.TempDir())
	meta := timelineTestMeta("env_reference_authority")
	thread, err := svc.CreateThread(ctx, meta, "reference authority", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	allowedPath := filepath.Join(svc.agentHomeDir, "allowed.txt")
	if err := os.WriteFile(allowedPath, []byte("allowed"), 0o600); err != nil {
		t.Fatal(err)
	}
	outsideDir := t.TempDir()
	outsidePath := filepath.Join(outsideDir, "outside.txt")
	if err := os.WriteFile(outsidePath, []byte("outside"), 0o600); err != nil {
		t.Fatal(err)
	}
	linkPath := filepath.Join(svc.agentHomeDir, "escaped.txt")
	if err := os.Symlink(outsidePath, linkPath); err != nil {
		if runtime.GOOS == "windows" {
			t.Skipf("symlink unavailable: %v", err)
		}
		t.Fatal(err)
	}

	host := newTestFloretHostFromService(t, svc, thread.ThreadID, "done")
	if _, err := host.RunTurn(ctx, flruntime.RunTurnRequest{
		ThreadID: flruntime.ThreadID(thread.ThreadID), TurnID: "turn_reference_authority", RunID: "run_reference_authority",
		Input: flruntime.TurnInput{References: []flruntime.MessageReference{
			{ReferenceID: "context:0", Kind: flruntime.MessageReferenceFile, Label: "allowed.txt", ResourceRef: canonicalReferenceLocatorForTest(t, "env_other", allowedPath, false)},
			{ReferenceID: "context:1", Kind: flruntime.MessageReferenceFile, Label: "escaped.txt", ResourceRef: canonicalReferenceLocatorForTest(t, meta.EndpointID, linkPath, false)},
			{ReferenceID: "context:2", Kind: flruntime.MessageReferenceDirectory, Label: "wrong-kind", ResourceRef: canonicalReferenceLocatorForTest(t, meta.EndpointID, allowedPath, true)},
		}},
		SupplementalContext: []flruntime.TurnSupplementalContextItem{
			{Kind: contextActionKindFilePath, Title: "Linked file path", Metadata: map[string]string{"path": allowedPath}, Sensitive: true},
			{Kind: contextActionKindFilePath, Title: "Linked file path", Metadata: map[string]string{"path": linkPath}, Sensitive: true},
			{Kind: contextActionKindFilePath, Title: "Linked directory path", Metadata: map[string]string{"path": allowedPath}, Sensitive: true},
		},
	}); err != nil {
		t.Fatalf("RunTurn: %v", err)
	}

	testCases := []struct {
		name        string
		request     FlowerCanonicalReferenceOpenRequest
		requestMeta *session.Meta
		want        error
	}{
		{name: "missing read permission", request: FlowerCanonicalReferenceOpenRequest{ThreadID: thread.ThreadID, TurnID: "turn_reference_authority", ReferenceID: "context:0"}, requestMeta: &session.Meta{EndpointID: meta.EndpointID}, want: ErrFlowerCanonicalReferenceDenied},
		{name: "other endpoint cannot address thread", request: FlowerCanonicalReferenceOpenRequest{ThreadID: thread.ThreadID, TurnID: "turn_reference_authority", ReferenceID: "context:0"}, requestMeta: timelineTestMeta("env_other"), want: ErrFlowerCanonicalReferenceNotFound},
		{name: "locator source mismatch", request: FlowerCanonicalReferenceOpenRequest{ThreadID: thread.ThreadID, TurnID: "turn_reference_authority", ReferenceID: "context:0"}, requestMeta: meta, want: ErrFlowerCanonicalReferenceDenied},
		{name: "symlink escapes scope", request: FlowerCanonicalReferenceOpenRequest{ThreadID: thread.ThreadID, TurnID: "turn_reference_authority", ReferenceID: "context:1"}, requestMeta: meta, want: ErrFlowerCanonicalReferenceDenied},
		{name: "locator kind mismatch", request: FlowerCanonicalReferenceOpenRequest{ThreadID: thread.ThreadID, TurnID: "turn_reference_authority", ReferenceID: "context:2"}, requestMeta: meta, want: ErrFlowerCanonicalReferenceType},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := svc.ResolveFlowerCanonicalReferenceOpenTarget(ctx, testCase.requestMeta, testCase.request)
			if !errors.Is(err, testCase.want) {
				t.Fatalf("error=%v, want %v", err, testCase.want)
			}
			for _, secret := range []string{allowedPath, outsidePath, linkPath, "redeven-context:v1:"} {
				if err != nil && strings.Contains(err.Error(), secret) {
					t.Fatalf("error leaked %q: %v", secret, err)
				}
			}
		})
	}
}

func TestResolveFlowerCanonicalReferenceOpenTargetRequiresExactCurrentTargetIdentity(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := newWorkingDirTestService(t, t.TempDir())
	meta := timelineTestMeta("env_reference_target")
	thread, err := svc.CreateThread(ctx, meta, "reference target", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(svc.agentHomeDir, "target.txt")
	if err := os.WriteFile(path, []byte("target"), 0o600); err != nil {
		t.Fatal(err)
	}

	exactTargetID := "runtime-target-opaque"
	svc.mu.Lock()
	svc.toolTargetPolicy = ToolTargetPolicy{Mode: ToolTargetModeExplicitTarget, DefaultTargetID: exactTargetID, AllowedTargetIDs: []string{exactTargetID}}
	svc.mu.Unlock()
	exactLocator := encodeCanonicalReferenceLocatorForTest(t, flowerCanonicalReferenceLocator{
		Version:           1,
		TargetID:          exactTargetID,
		TargetLocality:    contextActionLocalityRemote,
		CurrentTargetID:   exactTargetID,
		SourceEnvPublicID: meta.EndpointID,
		Path:              path,
	})
	forgedLocator := encodeCanonicalReferenceLocatorForTest(t, flowerCanonicalReferenceLocator{
		Version:           1,
		TargetID:          "runtime-target-forged",
		TargetLocality:    contextActionLocalityAuto,
		CurrentTargetID:   exactTargetID,
		SourceEnvPublicID: meta.EndpointID,
		Path:              path,
	})

	host := newTestFloretHostFromService(t, svc, thread.ThreadID, "done")
	if _, err := host.RunTurn(ctx, flruntime.RunTurnRequest{
		ThreadID: flruntime.ThreadID(thread.ThreadID), TurnID: "turn_reference_target", RunID: "run_reference_target",
		Input: flruntime.TurnInput{References: []flruntime.MessageReference{
			{ReferenceID: "context:0", Kind: flruntime.MessageReferenceFile, Label: "target.txt", ResourceRef: exactLocator},
			{ReferenceID: "context:1", Kind: flruntime.MessageReferenceFile, Label: "target.txt", ResourceRef: forgedLocator},
		}},
		SupplementalContext: []flruntime.TurnSupplementalContextItem{
			{Kind: contextActionKindFilePath, Title: "Exact linked file", Metadata: map[string]string{"path": path}, Sensitive: true},
			{Kind: contextActionKindFilePath, Title: "Forged linked file", Metadata: map[string]string{"path": path}, Sensitive: true},
		},
	}); err != nil {
		t.Fatalf("RunTurn: %v", err)
	}

	target, err := svc.ResolveFlowerCanonicalReferenceOpenTarget(ctx, meta, FlowerCanonicalReferenceOpenRequest{
		ThreadID: thread.ThreadID, TurnID: "turn_reference_target", ReferenceID: "context:0",
	})
	if err != nil || target.Path != path {
		t.Fatalf("resolve exact current target = %#v, %v", target, err)
	}
	_, err = svc.ResolveFlowerCanonicalReferenceOpenTarget(ctx, meta, FlowerCanonicalReferenceOpenRequest{
		ThreadID: thread.ThreadID, TurnID: "turn_reference_target", ReferenceID: "context:1",
	})
	if !errors.Is(err, ErrFlowerCanonicalReferenceDenied) {
		t.Fatalf("forged target error=%v, want denied", err)
	}
}

func TestResolveFlowerCanonicalReferenceOpenTargetRejectsReferenceAfterCurrentTargetChanges(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := newWorkingDirTestService(t, t.TempDir())
	meta := timelineTestMeta("env_reference_reauth")
	thread, err := svc.CreateThread(ctx, meta, "reference reauthorization", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(svc.agentHomeDir, "reauth.txt")
	if err := os.WriteFile(path, []byte("reauth"), 0o600); err != nil {
		t.Fatal(err)
	}

	svc.mu.Lock()
	svc.toolTargetPolicy = ToolTargetPolicy{Mode: ToolTargetModeExplicitTarget, AllowedTargetIDs: []string{"target_before", "target_after"}}
	svc.toolTargetPolicyForRun = func(_ *session.Meta, _ threadstore.ThreadSettings, routing *threadstore.FlowerThreadRouting) ToolTargetPolicy {
		policy := ToolTargetPolicy{Mode: ToolTargetModeExplicitTarget, AllowedTargetIDs: []string{"target_before", "target_after"}}
		if routing != nil {
			policy.DefaultTargetID = routing.PrimaryTargetID
		}
		return policy
	}
	svc.mu.Unlock()
	if err := svc.UpsertFlowerThreadRouting(ctx, threadstore.FlowerThreadRouting{
		EndpointID: meta.EndpointID, ThreadID: thread.ThreadID, PrimaryTargetID: "target_before",
	}); err != nil {
		t.Fatal(err)
	}

	resourceRef := encodeCanonicalReferenceLocatorForTest(t, flowerCanonicalReferenceLocator{
		Version:           1,
		TargetID:          "target_before",
		TargetLocality:    contextActionLocalityRemote,
		CurrentTargetID:   "target_before",
		SourceEnvPublicID: meta.EndpointID,
		Path:              path,
	})
	host := newTestFloretHostFromService(t, svc, thread.ThreadID, "done")
	if _, err := host.RunTurn(ctx, flruntime.RunTurnRequest{
		ThreadID: flruntime.ThreadID(thread.ThreadID), TurnID: "turn_reference_reauth", RunID: "run_reference_reauth",
		Input: flruntime.TurnInput{References: []flruntime.MessageReference{{
			ReferenceID: "context:0", Kind: flruntime.MessageReferenceFile, Label: "reauth.txt", ResourceRef: resourceRef,
		}}},
		SupplementalContext: []flruntime.TurnSupplementalContextItem{{
			Kind: contextActionKindFilePath, Title: "Linked file path", Metadata: map[string]string{"path": path}, Sensitive: true,
		}},
	}); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.ResolveFlowerCanonicalReferenceOpenTarget(ctx, meta, FlowerCanonicalReferenceOpenRequest{
		ThreadID: thread.ThreadID, TurnID: "turn_reference_reauth", ReferenceID: "context:0",
	}); err != nil {
		t.Fatalf("resolve before target change: %v", err)
	}
	if err := svc.UpsertFlowerThreadRouting(ctx, threadstore.FlowerThreadRouting{
		EndpointID: meta.EndpointID, ThreadID: thread.ThreadID, PrimaryTargetID: "target_after",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ResolveFlowerCanonicalReferenceOpenTarget(ctx, meta, FlowerCanonicalReferenceOpenRequest{
		ThreadID: thread.ThreadID, TurnID: "turn_reference_reauth", ReferenceID: "context:0",
	}); !errors.Is(err, ErrFlowerCanonicalReferenceDenied) {
		t.Fatalf("error after target change=%v, want denied", err)
	}
}

func TestResolveFlowerCanonicalReferenceOpenTargetFindsReferenceBeforeTailPage(t *testing.T) {
	ctx := context.Background()
	svc := newWorkingDirTestService(t, t.TempDir())
	meta := timelineTestMeta("env_reference_pagination")
	thread, err := svc.CreateThread(ctx, meta, "reference pagination", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(svc.agentHomeDir, "oldest.txt")
	if err := os.WriteFile(path, []byte("oldest"), 0o600); err != nil {
		t.Fatal(err)
	}

	host := newTestFloretHostFromService(t, svc, thread.ThreadID, "done")
	if _, err := host.RunTurn(ctx, flruntime.RunTurnRequest{
		ThreadID: flruntime.ThreadID(thread.ThreadID), TurnID: "turn_001", RunID: "run_001",
		Input: flruntime.TurnInput{References: []flruntime.MessageReference{{
			ReferenceID: "context:0", Kind: flruntime.MessageReferenceFile, Label: "oldest.txt",
			ResourceRef: canonicalReferenceLocatorForTest(t, meta.EndpointID, path, false),
		}}},
		SupplementalContext: []flruntime.TurnSupplementalContextItem{{
			Kind: contextActionKindFilePath, Title: "Linked file path", Metadata: map[string]string{"path": path}, Sensitive: true,
		}},
	}); err != nil {
		t.Fatalf("RunTurn 1: %v", err)
	}
	for index := 2; index <= 201; index++ {
		if _, err := host.RunTurn(ctx, flruntime.RunTurnRequest{
			ThreadID: flruntime.ThreadID(thread.ThreadID),
			TurnID:   flruntime.TurnID(fmt.Sprintf("turn_%03d", index)),
			RunID:    flruntime.RunID(fmt.Sprintf("run_%03d", index)),
			Input:    flruntime.TurnInput{Text: fmt.Sprintf("message %d", index)},
		}); err != nil {
			t.Fatalf("RunTurn %d: %v", index, err)
		}
	}

	readHost, err := svc.openFloretThreadReadHost(ctx, thread.ThreadID)
	if err != nil {
		t.Fatalf("open read host: %v", err)
	}
	tail, err := readHost.ListThreadTurns(ctx, flruntime.ListThreadTurnsRequest{
		ThreadID: flruntime.ThreadID(thread.ThreadID), Tail: 200,
	})
	if err != nil {
		t.Fatalf("list tail: %v", err)
	}
	if len(tail.Turns) != 200 || !tail.HasMore || tail.BeforeCursor == nil || strings.TrimSpace(tail.BeforeCursor.EntryID) == "" {
		t.Fatalf("tail page=%#v, want 200 turns and an advancing before cursor", tail)
	}
	older, err := readHost.ListThreadTurns(ctx, flruntime.ListThreadTurnsRequest{
		ThreadID: flruntime.ThreadID(thread.ThreadID), BeforeCursor: tail.BeforeCursor, Limit: 200,
	})
	if err != nil {
		t.Fatalf("list older: %v", err)
	}
	if len(older.Turns) != 1 || older.HasMore || older.Turns[0].TurnID != "turn_001" {
		t.Fatalf("older page=%#v, want the earliest turn", older)
	}
	if older.ThroughOrdinal >= tail.ThroughOrdinal || older.ThroughOrdinal >= tail.Turns[0].Ordinal {
		t.Fatalf("page boundaries older=%d tail=%d tail_oldest_turn=%d", older.ThroughOrdinal, tail.ThroughOrdinal, tail.Turns[0].Ordinal)
	}

	target, err := svc.ResolveFlowerCanonicalReferenceOpenTarget(ctx, meta, FlowerCanonicalReferenceOpenRequest{
		ThreadID: thread.ThreadID, TurnID: "turn_001", ReferenceID: "context:0",
	})
	if err != nil {
		t.Fatalf("resolve earliest reference: %v", err)
	}
	if target.Kind != string(flruntime.MessageReferenceFile) || target.Path != path || target.Label != "oldest.txt" {
		t.Fatalf("target=%#v", target)
	}
}

func TestResolveFlowerCanonicalReferenceOpenTargetRejectsDeletedOrReplacedResource(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := newWorkingDirTestService(t, t.TempDir())
	meta := timelineTestMeta("env_reference_stale")
	thread, err := svc.CreateThread(ctx, meta, "reference stale", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(svc.agentHomeDir, "stale.txt")
	if err := os.WriteFile(path, []byte("stale"), 0o600); err != nil {
		t.Fatal(err)
	}
	host := newTestFloretHostFromService(t, svc, thread.ThreadID, "done")
	if _, err := host.RunTurn(ctx, flruntime.RunTurnRequest{
		ThreadID: flruntime.ThreadID(thread.ThreadID), TurnID: "turn_reference_stale", RunID: "run_reference_stale",
		Input: flruntime.TurnInput{References: []flruntime.MessageReference{{
			ReferenceID: "context:0", Kind: flruntime.MessageReferenceFile, Label: "stale.txt", ResourceRef: canonicalReferenceLocatorForTest(t, meta.EndpointID, path, false),
		}}},
		SupplementalContext: []flruntime.TurnSupplementalContextItem{{
			Kind: contextActionKindFilePath, Title: "Linked file path", Metadata: map[string]string{"path": path}, Sensitive: true,
		}},
	}); err != nil {
		t.Fatalf("RunTurn: %v", err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	_, err = svc.ResolveFlowerCanonicalReferenceOpenTarget(ctx, meta, FlowerCanonicalReferenceOpenRequest{
		ThreadID: thread.ThreadID, TurnID: "turn_reference_stale", ReferenceID: "context:0",
	})
	if !errors.Is(err, ErrFlowerCanonicalReferenceNotFound) {
		t.Fatalf("deleted resource error=%v, want not found", err)
	}
	if err := os.Mkdir(path, 0o700); err != nil {
		t.Fatal(err)
	}
	_, err = svc.ResolveFlowerCanonicalReferenceOpenTarget(ctx, meta, FlowerCanonicalReferenceOpenRequest{
		ThreadID: thread.ThreadID, TurnID: "turn_reference_stale", ReferenceID: "context:0",
	})
	if !errors.Is(err, ErrFlowerCanonicalReferenceType) {
		t.Fatalf("replaced resource error=%v, want type error", err)
	}
}

func canonicalReferenceLocatorForTest(t *testing.T, endpointID string, path string, directory bool) string {
	t.Helper()
	locator, err := floretContextResourceRef(&ContextActionEnvelope{
		Target:           ContextActionTarget{TargetID: endpointID, Locality: contextActionLocalityCurrent},
		ExecutionContext: &ContextActionExecutionHint{CurrentTargetID: endpointID, SourceEnvPublicID: endpointID},
	}, ContextActionContextItem{Path: path, IsDirectory: directory})
	if err != nil {
		t.Fatal(err)
	}
	return locator
}

func encodeCanonicalReferenceLocatorForTest(t *testing.T, locator flowerCanonicalReferenceLocator) string {
	t.Helper()
	raw, err := json.Marshal(locator)
	if err != nil {
		t.Fatal(err)
	}
	return flowerCanonicalReferenceResourcePrefix + base64.RawURLEncoding.EncodeToString(raw)
}
