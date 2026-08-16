package agent

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"testing"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/terminal"
)

type shutdownAdmissionSession struct{}

func (shutdownAdmissionSession) RPC() flowersec.RPCPeer { return nil }
func (shutdownAdmissionSession) UnreliableMessages() (flowersec.UnreliableMessageChannel, error) {
	return nil, io.EOF
}
func (shutdownAdmissionSession) OpenStream(context.Context, string, flowersec.StreamMetadata) (flowersec.ByteStream, error) {
	return nil, io.EOF
}
func (shutdownAdmissionSession) AcceptStream(context.Context) (flowersec.IncomingStream, error) {
	return flowersec.IncomingStream{}, io.EOF
}
func (shutdownAdmissionSession) Rekey(context.Context) error                          { return nil }
func (shutdownAdmissionSession) ProbeLiveness(context.Context) (time.Duration, error) { return 0, nil }
func (shutdownAdmissionSession) WaitTermination(context.Context) (flowersec.SessionTermination, error) {
	return flowersec.SessionTermination{}, nil
}
func (shutdownAdmissionSession) Close() error { return nil }

type recordingNotificationPeer struct {
	notifications chan uint32
}

func (peer *recordingNotificationPeer) Call(context.Context, uint32, any, any) error {
	return nil
}

func (peer *recordingNotificationPeer) Notify(_ context.Context, typeID uint32, _ any) error {
	peer.notifications <- typeID
	return nil
}

func (*recordingNotificationPeer) OnNotify(uint32, func(context.Context, json.RawMessage)) func() {
	return func() {}
}

type acceptedNotificationSession struct {
	peer    flowersec.RPCPeer
	started chan struct{}
	release chan struct{}
}

func (sess *acceptedNotificationSession) RPC() flowersec.RPCPeer { return sess.peer }
func (*acceptedNotificationSession) UnreliableMessages() (flowersec.UnreliableMessageChannel, error) {
	return nil, io.EOF
}
func (*acceptedNotificationSession) OpenStream(context.Context, string, flowersec.StreamMetadata) (flowersec.ByteStream, error) {
	return nil, io.EOF
}
func (*acceptedNotificationSession) AcceptStream(context.Context) (flowersec.IncomingStream, error) {
	return flowersec.IncomingStream{}, io.EOF
}
func (*acceptedNotificationSession) Rekey(context.Context) error { return nil }
func (*acceptedNotificationSession) ProbeLiveness(context.Context) (time.Duration, error) {
	return 0, nil
}
func (sess *acceptedNotificationSession) WaitTermination(ctx context.Context) (flowersec.SessionTermination, error) {
	close(sess.started)
	select {
	case <-sess.release:
		return flowersec.SessionTermination{}, nil
	case <-ctx.Done():
		return flowersec.SessionTermination{}, ctx.Err()
	}
}
func (*acceptedNotificationSession) Close() error { return nil }

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

func TestServeRedevenAgentSessionRequiresPreConnectPlan(t *testing.T) {
	a := &Agent{}
	err := a.serveRedevenAgentSession(
		context.Background(),
		shutdownAdmissionSession{},
		&session.Meta{ChannelID: "ch-remote", FloeApp: FloeAppRedevenAgent},
		nil,
	)
	if err == nil || err.Error() != "missing pre-connect remote session plan" {
		t.Fatalf("serveRedevenAgentSession() error = %v, want missing pre-connect plan rejection", err)
	}
}

func TestServeLocalDirectAcceptorSessionAttachesAndDetachesTerminalNotificationSink(t *testing.T) {
	manager := terminal.NewManager("/bin/sh", t.TempDir(), slog.New(slog.NewTextHandler(io.Discard, nil)))
	t.Cleanup(manager.Cleanup)
	peer := &recordingNotificationPeer{notifications: make(chan uint32, 4)}
	sess := &acceptedNotificationSession{
		peer:    peer,
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
	a := &Agent{
		log:                    slog.New(slog.NewTextHandler(io.Discard, nil)),
		term:                   manager,
		sessions:               make(map[string]*activeSession),
		pluginSessions:         newAuthenticatedPluginSessionRegistry(),
		pluginSessionLifecycle: &recordingPluginSessionLifecycle{},
	}
	meta := &session.Meta{
		ChannelID:   "ch-acceptor-notifications",
		CanRead:     true,
		CanWrite:    true,
		CanExecute:  true,
		FloeApp:     FloeAppRedevenAgent,
		SessionKind: "envapp_rpc",
	}

	done := make(chan error, 1)
	go func() {
		done <- a.ServeLocalDirectSession(context.Background(), sess, meta, LocalDirectSessionOptions{})
	}()
	select {
	case <-sess.started:
	case <-time.After(time.Second):
		t.Fatal("accepted session did not begin waiting for termination")
	}

	if _, err := manager.CreateSession("accepted-notification", ""); err != nil {
		t.Fatalf("CreateSession() error = %v", err)
	}
	select {
	case typeID := <-peer.notifications:
		if typeID != terminal.TypeID_TERMINAL_SESSIONS_CHANGED {
			t.Fatalf("notification type ID = %d, want %d", typeID, terminal.TypeID_TERMINAL_SESSIONS_CHANGED)
		}
	case <-time.After(time.Second):
		t.Fatal("accepted session RPC peer did not receive terminal notification")
	}

	close(sess.release)
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("ServeLocalDirectSession() error = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("accepted session did not stop")
	}

	if _, err := manager.CreateSession("after-detach", ""); err != nil {
		t.Fatalf("CreateSession(after detach) error = %v", err)
	}
	select {
	case typeID := <-peer.notifications:
		t.Fatalf("detached RPC peer received notification type ID %d", typeID)
	case <-time.After(100 * time.Millisecond):
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
