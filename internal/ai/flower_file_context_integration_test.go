package ai

import (
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
)

func TestFileContextSendPreservesRuntimeAuthorityThroughReplayRestartAndFork(t *testing.T) {
	for _, endpoint := range []string{"env_local", "env_remote"} {
		t.Run(endpoint, func(t *testing.T) {
			server := newRealtimeTestServer(t, 0)
			stateDir := t.TempDir()
			svc := openRealtimeTestService(t, stateDir, server.URL)
			t.Cleanup(func() { _ = svc.Close() })
			meta := testSendTurnMeta()
			meta.EndpointID = endpoint
			thread, err := svc.CreateThread(t.Context(), meta, "Runtime file references", "", "", "")
			if err != nil {
				t.Fatal(err)
			}
			authority, err := resolveFlowerCanonicalReferenceTargetAuthority(endpoint, ToolTargetPolicy{})
			if err != nil {
				t.Fatal(err)
			}
			var sends []SendUserTurnRequest
			var saved []flruntime.UserInput
			var references []flruntime.MessageReference
			for index, resource := range []struct {
				path      string
				directory bool
			}{
				{path: "/workspace/changsha.jpg"},
				{path: "/workspace/main.go"},
				{path: "/workspace/src", directory: true},
			} {
				action := &ContextActionEnvelope{
					SchemaVersion: ContextActionSchemaVersion, ActionID: contextActionAskFlowerID, Provider: contextActionFlowerProvider,
					Target:           ContextActionTarget{TargetID: "current", Locality: contextActionLocalityAuto},
					Source:           ContextActionSource{Surface: contextActionSurfaceFile},
					ExecutionContext: &ContextActionExecutionHint{CurrentTargetID: endpoint, SourceEnvPublicID: endpoint, SessionSource: contextActionSessionLocal, RuntimeHint: contextActionRuntimeHintAuto},
					Context:          []ContextActionContextItem{{Kind: contextActionKindFilePath, Path: resource.path, IsDirectory: resource.directory}},
					Presentation:     ContextActionPresentation{Label: "Ask Flower", Priority: 100},
				}
				requestID := fmt.Sprintf("resource-%d", index)
				send := SendUserTurnRequest{ClientRequestID: requestID, ThreadID: thread.ThreadID, Input: RunInput{Text: "Inspect this resource", ContextAction: action}}
				if index == 0 {
					// A Cloud display identity must not be admitted as resource authority.
					action.ExecutionContext.SourceEnvPublicID = "env_cloud"
					if _, err := svc.SendUserTurn(t.Context(), meta, send); !errors.Is(err, ErrInvalidContextAction) {
						t.Fatalf("Cloud identity error=%v, want invalid context action", err)
					}
					if _, found, err := svc.threadRuntime.(flruntime.ThreadSendReader).LookupSend(t.Context(), flruntime.LookupSendInput{ThreadID: identity.ThreadID(thread.ThreadID), RequestKey: flruntime.RequestKey(requestID)}); err != nil || found {
						t.Fatalf("rejected input found=%t error=%v, want no admission", found, err)
					}
					action.ExecutionContext.SourceEnvPublicID = endpoint
				}
				view, err := runTypedTurnForTest(t, t.Context(), svc, meta, requestID, RunStartRequest{ThreadID: thread.ThreadID, Input: send.Input})
				if err != nil {
					t.Fatal(err)
				}
				input, found, err := svc.threadRuntime.(flruntime.ThreadSendReader).LookupSend(t.Context(), flruntime.LookupSendInput{ThreadID: identity.ThreadID(thread.ThreadID), RequestKey: flruntime.RequestKey(requestID)})
				if err != nil || !found || len(input.References) != 1 || len(input.Attachments) != 0 {
					t.Fatalf("canonical input=%#v found=%t error=%v", input, found, err)
				}
				ref := input.References[0]
				wantKind := flruntime.MessageReferenceFile
				if resource.directory {
					wantKind = flruntime.MessageReferenceDirectory
				}
				locator, err := decodeFlowerCanonicalReferenceLocator(ref.ResourceRef)
				if err != nil || ref.Kind != wantKind || locator.Path != resource.path || locator.Directory != resource.directory || !flowerCanonicalReferenceLocatorMatchesAuthority(locator, authority) {
					t.Fatalf("reference=%#v locator=%#v error=%v", ref, locator, err)
				}
				if currentRef, found := exactFlowerCanonicalReference(view.Items, view.TurnID.String(), ref.ReferenceID); !found || currentRef != ref {
					t.Fatalf("current reference=%#v found=%t, want admitted reference", currentRef, found)
				}
				public, err := publicFloretMessageReferences(input.References)
				if err != nil {
					t.Fatal(err)
				}
				raw, err := json.Marshal(public)
				if err != nil || strings.Contains(string(raw), resource.path) || strings.Contains(string(raw), "resource_ref") || strings.Contains(string(raw), flowerCanonicalReferenceResourcePrefix) {
					t.Fatalf("public reference=%s error=%v, want no locator or path", raw, err)
				}
				if replay, err := svc.SendUserTurn(t.Context(), meta, send); err != nil || replay.TurnID != view.TurnID.String() {
					t.Fatalf("replay=%#v error=%v, want same admitted turn", replay, err)
				}
				sends = append(sends, send)
				saved = append(saved, input)
				references = append(references, ref)
			}
			if err := svc.Close(); err != nil {
				t.Fatal(err)
			}
			svc = openRealtimeTestService(t, stateDir, server.URL)
			for index, send := range sends {
				input, found, err := svc.threadRuntime.(flruntime.ThreadSendReader).LookupSend(t.Context(), flruntime.LookupSendInput{ThreadID: identity.ThreadID(thread.ThreadID), RequestKey: flruntime.RequestKey(send.ClientRequestID)})
				if err != nil || !found || !reflect.DeepEqual(input, saved[index]) {
					t.Fatalf("restart canonical input changed: found=%t error=%v", found, err)
				}
				if _, err := svc.SendUserTurn(t.Context(), meta, send); err != nil {
					t.Fatalf("restart replay: %v", err)
				}
			}
			fork, err := svc.ForkThreadWithOptions(t.Context(), meta, thread.ThreadID, ForkThreadRequest{ClientRequestID: "fork-file-references", Title: "Reference fork"})
			if err != nil {
				t.Fatal(err)
			}
			view, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(fork.ThreadID))
			if err != nil {
				t.Fatal(err)
			}
			var forkReferences []flruntime.MessageReference
			for _, item := range view.Items {
				if item.Kind == flruntime.ThreadItemUser {
					forkReferences = append(forkReferences, item.References...)
				}
			}
			if !reflect.DeepEqual(forkReferences, references) {
				t.Fatalf("fork references=%#v, want preserved canonical resources", forkReferences)
			}
		})
	}
}
