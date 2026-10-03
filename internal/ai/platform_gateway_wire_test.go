package ai

import (
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

// This opt-in test talks to a separately built Edge over HTTP, never a local module replacement.
func TestPlatformGatewayExternalEdgeWireContract(t *testing.T) {
	path := os.Getenv("REDEVEN_AI_WIRE_FIXTURE")
	if path == "" {
		t.Skip("REDEVEN_AI_WIRE_FIXTURE is required")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		GatewayURL string `json:"gateway_url"`
		GrantToken string `json:"grant_token"`
		ModelAlias string `json:"model_alias"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	state := t.TempDir()
	svc, err := NewService(Options{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: state, AgentHomeDir: state, Shell: "/bin/sh",
		RunMaxWallTime: 20 * time.Second, RunIdleTimeout: 10 * time.Second,
		ResolveProviderAPIKey: func(string) (string, bool, error) {
			t.Error("platform requested a Provider key")
			return "", false, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	meta := &session.Meta{EndpointID: "env-a", ChannelID: "wire-test", UserPublicID: "user-a", NamespacePublicID: "ns-a", CanRead: true, CanWrite: true, CanExecute: true, PlatformAIGrant: fixture.GrantToken, PlatformAIGatewayURL: fixture.GatewayURL, PlatformAIEntitlementVersion: 1}
	models, err := svc.ListModelsForSession(t.Context(), meta)
	modelID := "platform/" + config.AIModelLocalName(fixture.ModelAlias)
	if err != nil || len(models.Models) != 1 || models.Models[0].ID != modelID || models.Runtime.PlatformError != "" {
		t.Fatalf("published alias did not reach the runtime catalog: %+v %v", models, err)
	}
	thread, err := svc.CreateThread(t.Context(), meta, "Cross-process qualification", modelID, "", "")
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"wire-first", "wire-continuation"} {
		_, err := runTypedTurnForTest(t, t.Context(), svc, meta, id, RunStartRequest{ThreadID: thread.ThreadID, Model: modelID, Input: RunInput{Text: "Respond with the fixture result."}, Options: RunOptions{MaxOutputTokens: 64}})
		if err != nil {
			t.Fatal(err)
		}
		waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool { return view.RunStatus == "success" })
		detail, err := svc.GetFlowerThreadDetail(t.Context(), meta, thread.ThreadID)
		if err != nil {
			t.Fatal(err)
		}
		raw, err := json.Marshal(detail)
		if err != nil || !strings.Contains(string(raw), "Cross-process result persisted.") {
			t.Fatalf("real Edge did not produce persisted output: %v; view=%s", err, raw)
		}
		for _, private := range []string{fixture.GrantToken, "private-provider-response", "deployment-a"} {
			if strings.Contains(string(raw), private) {
				t.Fatal("internal credential or provider state leaked into thread details")
			}
		}
	}
	if err := os.WriteFile(path+".done", []byte("passed"), 0600); err != nil {
		t.Fatal(err)
	}
}
