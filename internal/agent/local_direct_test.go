package agent

import (
	"context"
	"io"
	"testing"
	"time"

	"github.com/floegence/flowersec/flowersec-go/endpoint"
	fsstream "github.com/floegence/flowersec/flowersec-go/stream"
	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/session"
)

type shutdownAdmissionSession struct{}

func (shutdownAdmissionSession) Path() endpoint.Path        { return endpoint.Path("") }
func (shutdownAdmissionSession) EndpointInstanceID() string { return "test" }
func (shutdownAdmissionSession) AcceptStreamHello(int) (string, fsstream.Stream, error) {
	return "", nil, io.EOF
}
func (shutdownAdmissionSession) ServeStreams(context.Context, int, func(string, io.ReadWriteCloser), ...endpoint.ServeStreamsOption) error {
	return nil
}
func (shutdownAdmissionSession) OpenStream(context.Context, string) (fsstream.Stream, error) {
	return nil, io.EOF
}
func (shutdownAdmissionSession) Ping() error                                          { return nil }
func (shutdownAdmissionSession) Rekey() error                                         { return nil }
func (shutdownAdmissionSession) ProbeLiveness(context.Context) (time.Duration, error) { return 0, nil }
func (shutdownAdmissionSession) Close() error                                         { return nil }

func TestRegisterLocalDirectChannelStartsUnlockedWhenAccessAlreadyAuthorized(t *testing.T) {
	gate := accessgate.New(accessgate.Options{Password: "secret"})
	a := &Agent{accessGate: gate}

	meta := session.Meta{
		ChannelID:    "ch-local",
		EndpointID:   "env_local",
		FloeApp:      FloeAppRedevenAgent,
		CodeSpaceID:  "env-ui",
		SessionKind:  "envapp_rpc",
		UserPublicID: "user_local",
	}

	cleanup := a.registerLocalDirectChannel(meta, LocalDirectSessionOptions{AccessUnlocked: true})
	defer cleanup()

	if !gate.IsChannelUnlocked(meta.ChannelID) {
		t.Fatalf("channel %q should start unlocked", meta.ChannelID)
	}

	cleanup()
	if gate.IsChannelUnlocked(meta.ChannelID) {
		t.Fatalf("channel %q should be removed after cleanup", meta.ChannelID)
	}
}

func TestServeLocalDirectSessionRejectsAdmissionAfterShutdown(t *testing.T) {
	a := &Agent{
		sessions:       make(map[string]*activeSession),
		pluginSessions: newAuthenticatedPluginSessionRegistry(),
	}
	a.beginSessionShutdown()
	err := a.ServeLocalDirectSession(context.Background(), shutdownAdmissionSession{}, &session.Meta{
		ChannelID: "ch-local-shutdown",
	}, LocalDirectSessionOptions{})
	if err == nil || err.Error() != "session admission is closed" {
		t.Fatalf("ServeLocalDirectSession() error = %v, want shutdown admission rejection", err)
	}
	if !a.waitForSessions(50 * time.Millisecond) {
		t.Fatal("rejected local direct session changed the session wait group")
	}
}
