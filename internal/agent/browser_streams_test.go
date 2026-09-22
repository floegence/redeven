package agent

import (
	"context"
	"encoding/json"
	"net"
	"testing"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/session"
)

type browserStreamRegistryFixture map[string]flowersec.StreamHandler

func (registry browserStreamRegistryFixture) HandleStream(kind string, handler flowersec.StreamHandler) error {
	registry[kind] = handler
	return nil
}

func TestBrowserStreamRegistrationUsesAuthenticatedEnvironmentSession(t *testing.T) {
	runtime := ai.NewComputerUseRuntime(ai.NewTargetRegistry(), nil, t.TempDir())
	t.Cleanup(func() { _ = runtime.Close() })
	agent := &Agent{browserRuntime: runtime}
	for _, space := range []string{"env-ui", "unrelated-codespace"} {
		registry := browserStreamRegistryFixture{}
		meta := &session.Meta{FloeApp: FloeAppRedevenAgent, CodeSpaceID: space, ChannelID: "channel", UserPublicID: "user", EndpointID: "environment", CanRead: true}
		cleanup, err := agent.registerBrowserStreams(registry, meta)
		if err != nil {
			t.Fatal(err)
		}
		defer cleanup()
		if space != "env-ui" {
			if len(registry) != 0 {
				t.Fatal("unrelated code session acquired browser stream handlers")
			}
			continue
		}
		if len(registry) != 4 {
			t.Fatalf("browser lanes: %v", registry)
		}
		for _, kind := range []string{ai.BrowserDOMStream, ai.BrowserInputStream, ai.BrowserMediaStream, ai.BrowserUploadStream} {
			handler := registry[kind]
			if handler == nil {
				t.Fatalf("missing %s", kind)
			}
			server, client := net.Pipe()
			done := make(chan error, 1)
			go func() {
				done <- handler(context.Background(), flowersec.IncomingStream{Kind: kind, Stream: &terminalTestByteStream{Conn: server}})
			}()
			var response struct {
				OK    bool   `json:"ok"`
				Error string `json:"error"`
			}
			if err := json.NewDecoder(client).Decode(&response); err != nil {
				t.Fatal(err)
			}
			if response.OK || response.Error != "browser_view_unavailable" {
				t.Fatalf("read-only channel acquired %s: %+v", kind, response)
			}
			_ = server.Close()
			_ = client.Close()
			if err := <-done; err != nil {
				t.Fatal(err)
			}
		}
	}
}
