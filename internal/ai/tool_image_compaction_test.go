package ai

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v7/config"
	"github.com/floegence/floret/v7/florettest"
	flidentity "github.com/floegence/floret/v7/identity"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	flstorage "github.com/floegence/floret/v7/storage"
	fltools "github.com/floegence/floret/v7/tools"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestThreadImageModelGuardPreservesCompactedToolMedia(t *testing.T) {
	attachment, _, imageBody, err := imageSnapshot(imageReadFixture(t, "png"), "history.png")
	if err != nil {
		t.Fatal(err)
	}
	answer := func(text string) florettest.Step {
		return florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventDelta, Text: text}, {Type: flprovider.EventDone, Reason: "stop"}}}
	}
	call := florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventToolCalls, ToolCalls: []flprovider.ToolCall{{ID: "image", Name: "image.read", Args: `{}`}}}, {Type: flprovider.EventDone, Reason: "tool_calls"}}}
	gateway := florettest.NewScriptedGateway(flprovider.Identity{Provider: "test", Model: "image", StateCompatibilityKey: "image:v1"}, flprovider.Capabilities{Reasoning: flprovider.ReasoningUnsupported}, call, answer("The image has a red square."), answer("ACK"), answer("ACK"), answer("ACK"), answer("The image showed a red square. Three filler turns were acknowledged."), answer("ACK"), answer("ACK"), answer("The retained image showed a red square."))
	imageTool := fltools.Define[map[string]any](fltools.Definition{Name: "image.read", ReadOnly: true, InputSchema: fltools.StrictObject(nil, nil), Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}}, nil, nil, func(context.Context, fltools.Invocation[map[string]any]) (fltools.Result, error) {
		return fltools.Result{Text: "Read history.png", Attachments: []fltools.ArtifactRef{{ID: attachment.ResourceRef, Kind: "image", SafeLabel: attachment.Name, MIME: attachment.MIMEType, SizeBytes: attachment.SizeBytes, SHA256: attachment.SHA256}}, Activity: &fltools.ActivityPresentation{Label: "Read image", TargetRefs: []fltools.ActivityTargetRef{{Kind: "tool_image", ResourceRef: attachment.ResourceRef, Label: attachment.Name}}}}, nil
	})
	agent, err := flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "image", Name: "Image"}, SystemPrompt: "Inspect the image.", Context: flconfig.ContextPolicy{ContextWindowTokens: 256000, CompactedContextTargetTokens: 2000, RecentTailTokens: 100, RecentUserTokens: 100, ReservedSummaryTokens: 1000}}, gateway, flruntime.WithAgentTools(imageTool), flruntime.WithAgentEffectAuthorization(flruntime.EffectAuthorizationGateFunc(func(ctx context.Context, request flruntime.EffectAuthorizationRequest, effect flruntime.AuthorizedEffect) (flruntime.EffectDispatchResult, error) {
		return effect(ctx, flruntime.EffectAuthorizationProof{EffectAttemptID: request.EffectAttemptID, RequestFingerprint: request.RequestFingerprint, ThreadID: request.ThreadID, TurnID: request.TurnID, RunID: request.RunID, ToolCallID: request.ToolCallID, PolicyRevision: "test", AuditReference: "test", AuditHash: "test", AuthorizedAt: time.Now().UTC()})
	})))
	if err != nil {
		t.Fatal(err)
	}
	database := filepath.Join(t.TempDir(), "threads.sqlite")
	open := func() (*flruntime.Host, flruntime.ThreadService) {
		host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: flstorage.SQLite(database)})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = host.Shutdown(context.Background()) })
		threads, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) { return agent, nil }))
		if err != nil {
			t.Fatal(err)
		}
		return host, threads
	}
	host, threads := open()
	// This fixture owns a separate public Floret Host. Keep product background
	// workers deferred so swapping that Host at restart has no concurrent readers.
	svc, err := NewService(Options{DeferExecution: true, StateDir: t.TempDir(), AgentHomeDir: t.TempDir(), Shell: "/bin/sh", Config: &config.AIConfig{CurrentModelID: "openai/vision", Providers: []config.AIProvider{{ID: "openai", Type: "openai", Models: []config.AIProviderModel{{ModelName: "vision", InputModalities: []string{"text", "image"}}}}}}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	svc.threadRuntime = threads
	meta := testSendTurnMeta()
	product, err := svc.CreateThread(t.Context(), meta, "Image history", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	created, err := threads.View(t.Context(), flidentity.ThreadID(product.ThreadID))
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.toolMedia.put(t.Context(), attachment, imageBody); err != nil {
		t.Fatal(err)
	}
	await := func(admitted flruntime.ThreadView) flruntime.ThreadView {
		t.Helper()
		deadline := time.Now().Add(10 * time.Second)
		for time.Now().Before(deadline) {
			view, err := threads.View(t.Context(), created.ThreadID)
			if err != nil {
				t.Fatal(err)
			}
			if view.TurnID == admitted.TurnID && view.Activity == flruntime.ThreadActivityIdle && view.LastOutcome != nil {
				if *view.LastOutcome != flruntime.TurnOutcomeCompleted {
					t.Fatalf("execution failed: %#v", view.Failure)
				}
				return view
			}
			time.Sleep(10 * time.Millisecond)
		}
		t.Fatal("execution timed out")
		return flruntime.ThreadView{}
	}
	var before flruntime.ThreadView
	for index := 0; index < 4; index++ {
		text := "Read history.png"
		if index > 0 {
			text = strings.Repeat("historical context filler ", 500)
		}
		admission, err := threads.Send(t.Context(), flruntime.SendInput{ThreadID: created.ThreadID, RequestKey: flruntime.RequestKey(fmt.Sprintf("seed-%d", index)), Input: flruntime.UserInput{Text: text}})
		if err != nil {
			t.Fatal(err)
		}
		before = await(admission)
	}
	admitted, err := threads.(flruntime.ThreadContextCompactor).CompactContext(t.Context(), flruntime.CompactContextInput{ThreadID: created.ThreadID, RequestKey: "compact"})
	if err != nil {
		t.Fatal(err)
	}
	after := await(admitted)
	contextView, err := threads.(flruntime.ThreadContextReader).Context(t.Context(), created.ThreadID)
	if err != nil || len(contextView.Compactions) != 1 || contextView.Compactions[0].Status != "compacted" {
		t.Fatalf("compaction=%#v %v", contextView.Compactions, err)
	}
	if len(after.Items) != len(before.Items) {
		t.Fatal("compaction changed complete canonical history")
	}
	requests := gateway.Requests()
	if len(requests) != 6 {
		t.Fatalf("unexpected provider request count: %d", len(requests))
	}
	summary := requests[len(requests)-1]
	descriptor := flruntime.MessageAttachment{ResourceRef: attachment.ResourceRef, Name: attachment.Name, MIMEType: attachment.MIMEType, SizeBytes: attachment.SizeBytes}
	locator, err := descriptor.Locator()
	if err != nil {
		t.Fatal(err)
	}
	imageCount := 0
	for _, message := range summary.Messages {
		for _, image := range message.Attachments {
			imageCount++
			if message.Role != flprovider.RoleUser || image.ResourceRef != attachment.ResourceRef || !strings.Contains(message.Text, locator) || strings.Contains(message.Text, attachment.ResourceRef) {
				t.Fatalf("summary lost native historical image or safe source label: %+v", message)
			}
		}
	}
	if imageCount != 1 || len(summary.Tools) != 0 || summary.PreviousState != nil {
		t.Fatalf("summary image count=%d tools=%d continuation=%v", imageCount, len(summary.Tools), summary.PreviousState)
	}
	retained, _, err := findCanonicalThreadAttachment(after, "", func(a flruntime.MessageAttachment) bool {
		candidate, err := a.Locator()
		return err == nil && candidate == locator
	})
	if err != nil || retained.ResourceRef != attachment.ResourceRef {
		t.Fatalf("compaction lost original image discovery: %+v %v", retained, err)
	}

	cfg := &config.AIConfig{Providers: []config.AIProvider{{ID: "test", Type: "openai", Models: []config.AIProviderModel{{ModelName: "text", InputModalities: []string{"text"}}}}}}
	if err := svc.validateThreadImageModel(t.Context(), created.ThreadID.String(), "test/text", cfg); !errors.Is(err, ErrThreadImageModelUnsupported) {
		t.Fatalf("compacted tool image allowed a text model: %v", err)
	}
	inventory, err := host.MediaInventory(t.Context())
	if err != nil || !inventory.Idle || len(inventory.References) != 1 || inventory.References[0].Attachment.ResourceRef != attachment.ResourceRef {
		t.Fatalf("compacted canonical media retention=%#v %v", inventory, err)
	}
	checkOriginal := func(threadID string) {
		t.Helper()
		materials, e := svc.GetTaskMaterials(t.Context(), meta, threadID, "")
		if e != nil || len(materials.Items) != 1 || materials.Items[0].Kind != "media" || materials.Items[0].Locator != locator {
			t.Fatalf("historical media listing: %+v %v", materials, e)
		}
		work := &run{id: "materialize-image", threadID: threadID, endpointID: meta.EndpointID, userPublicID: meta.UserPublicID, channelID: meta.ChannelID, stateDir: svc.stateDir}
		work.expectFloretRuntimeEventIdentity(work.id, threadID, "materialize-turn", true)
		work.host.readImageAttachment = func(ctx context.Context, audience *session.Meta, source string) (canonicalImageSnapshot, error) {
			return svc.readCanonicalThreadImage(ctx, audience, threadID, source, "")
		}
		copy, e := work.toolAttachmentMaterialize(t.Context(), meta, locator)
		if e != nil {
			t.Fatal(e)
		}
		if body, e := os.ReadFile(copy["file_path"].(string)); e != nil || !bytes.Equal(body, imageBody) {
			t.Fatal("materialized image differs", e)
		}
		if e := svc.CleanTaskFiles(t.Context(), meta, threadID); e != nil {
			t.Fatal(e)
		}
		snapshot, err := svc.readCanonicalThreadImage(t.Context(), meta, threadID, locator, "")
		if err != nil || !bytes.Equal(snapshot.Body, imageBody) || snapshot.SHA256 != attachment.SHA256 {
			t.Fatalf("historical original changed: %v", err)
		}
	}
	checkOriginal(created.ThreadID.String())
	if err := host.Shutdown(t.Context()); err != nil {
		t.Fatal(err)
	}
	host, threads = open()
	svc.threadRuntime = threads
	checkOriginal(created.ThreadID.String())
	fork, err := svc.ForkThread(t.Context(), meta, created.ThreadID.String(), "Image fork")
	if err != nil {
		t.Fatal(err)
	}
	checkOriginal(fork.ThreadID)
	created.ThreadID = flidentity.ThreadID(fork.ThreadID)
	for index := 0; index < 2; index++ {
		admission, err := threads.Send(t.Context(), flruntime.SendInput{ThreadID: created.ThreadID, RequestKey: flruntime.RequestKey(fmt.Sprintf("fork-filler-%d", index)), Input: flruntime.UserInput{Text: strings.Repeat("additional historical image context ", 800)}})
		if err != nil {
			t.Fatal(err)
		}
		await(admission)
	}
	admitted, err = threads.(flruntime.ThreadContextCompactor).CompactContext(t.Context(), flruntime.CompactContextInput{ThreadID: created.ThreadID, RequestKey: "compact-again"})
	if err != nil {
		t.Fatal(err)
	}
	await(admitted)
	contextView, err = threads.(flruntime.ThreadContextReader).Context(t.Context(), created.ThreadID)
	if err != nil || len(contextView.Compactions) != 2 || contextView.Compactions[1].Status != "compacted" {
		t.Fatalf("repeated compaction=%+v %v", contextView.Compactions, err)
	}
	checkOriginal(fork.ThreadID)
	storagePath, err := svc.toolMedia.path(attachment.ResourceRef)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(storagePath); err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.ResolveToolImageForThread(t.Context(), meta, fork.ThreadID, locator); err == nil || strings.Contains(err.Error(), storagePath) {
		t.Fatalf("missing tool snapshot must fail without a storage path: %v", err)
	}
}
