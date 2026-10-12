package ai

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v7/config"
	"github.com/floegence/floret/v7/florettest"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	flstorage "github.com/floegence/floret/v7/storage"
	fltools "github.com/floegence/floret/v7/tools"
	"github.com/floegence/redeven/internal/config"
)

func TestThreadImageModelGuardPreservesCompactedToolMedia(t *testing.T) {
	attachment, _, _, err := imageSnapshot(imageReadFixture(t, "png"), "history.png")
	if err != nil {
		t.Fatal(err)
	}
	answer := func(text string) florettest.Step {
		return florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventDelta, Text: text}, {Type: flprovider.EventDone, Reason: "stop"}}}
	}
	call := florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventToolCalls, ToolCalls: []flprovider.ToolCall{{ID: "image", Name: "image.read", Args: `{}`}}}, {Type: flprovider.EventDone, Reason: "tool_calls"}}}
	gateway := florettest.NewScriptedGateway(flprovider.Identity{Provider: "test", Model: "image", StateCompatibilityKey: "image:v1"}, flprovider.Capabilities{Reasoning: flprovider.ReasoningUnsupported}, call, answer("The image has a red square."), answer("ACK"), answer("ACK"), answer("ACK"), answer("The image showed a red square. Three filler turns were acknowledged."))
	imageTool := fltools.Define[map[string]any](fltools.Definition{Name: "image.read", ReadOnly: true, InputSchema: fltools.StrictObject(nil, nil), Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}}, nil, nil, func(context.Context, fltools.Invocation[map[string]any]) (fltools.Result, error) {
		return fltools.Result{Text: "Read history.png", Attachments: []fltools.ArtifactRef{{ID: attachment.ResourceRef, Kind: "image", SafeLabel: attachment.Name, MIME: attachment.MIMEType, SizeBytes: attachment.SizeBytes, SHA256: attachment.SHA256}}, Activity: &fltools.ActivityPresentation{Label: "Read image", TargetRefs: []fltools.ActivityTargetRef{{Kind: "tool_image", ResourceRef: attachment.ResourceRef, Label: attachment.Name}}}}, nil
	})
	agent, err := flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "image", Name: "Image"}, SystemPrompt: "Inspect the image.", Context: flconfig.ContextPolicy{ContextWindowTokens: 256000, CompactedContextTargetTokens: 2000, RecentTailTokens: 100, RecentUserTokens: 100, ReservedSummaryTokens: 1000}}, gateway, flruntime.WithAgentTools(imageTool), flruntime.WithAgentEffectAuthorization(flruntime.EffectAuthorizationGateFunc(func(ctx context.Context, request flruntime.EffectAuthorizationRequest, effect flruntime.AuthorizedEffect) (flruntime.EffectDispatchResult, error) {
		return effect(ctx, flruntime.EffectAuthorizationProof{EffectAttemptID: request.EffectAttemptID, RequestFingerprint: request.RequestFingerprint, ThreadID: request.ThreadID, TurnID: request.TurnID, RunID: request.RunID, ToolCallID: request.ToolCallID, PolicyRevision: "test", AuditReference: "test", AuditHash: "test", AuthorizedAt: time.Now().UTC()})
	})))
	if err != nil {
		t.Fatal(err)
	}
	host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: flstorage.SQLite(filepath.Join(t.TempDir(), "threads.sqlite"))})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := host.Shutdown(context.Background()); err != nil {
			t.Error(err)
		}
	}()
	threads, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) { return agent, nil }))
	if err != nil {
		t.Fatal(err)
	}
	created, err := threads.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "create"})
	if err != nil {
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
	svc := &Service{threadRuntime: threads, floretEffects: newFloretEffectAdapter()}
	cfg := &config.AIConfig{Providers: []config.AIProvider{{ID: "test", Type: "openai", Models: []config.AIProviderModel{{ModelName: "text", InputModalities: []string{"text"}}}}}}
	if err := svc.validateThreadImageModel(t.Context(), created.ThreadID.String(), "test/text", cfg); !errors.Is(err, ErrThreadImageModelUnsupported) {
		t.Fatalf("compacted tool image allowed a text model: %v", err)
	}
	inventory, err := host.MediaInventory(t.Context())
	if err != nil || !inventory.Idle || len(inventory.References) != 1 || inventory.References[0].Attachment.ResourceRef != attachment.ResourceRef {
		t.Fatalf("compacted canonical media retention=%#v %v", inventory, err)
	}
}
