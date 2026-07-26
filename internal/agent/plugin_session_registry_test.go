package agent

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/session"
)

type recordingPluginSessionLifecycle struct {
	onBind     func()
	recorded   int
	maintained int
}

func (l *recordingPluginSessionLifecycle) BindPluginSessionGeneration(context.Context, *session.Meta, string, string) error {
	if l.onBind != nil {
		l.onBind()
	}
	return nil
}

func (l *recordingPluginSessionLifecycle) RecordPluginSessionTerminalIntent(context.Context, *session.Meta, string, string) error {
	l.recorded++
	return nil
}

func (l *recordingPluginSessionLifecycle) MaintainTerminalPluginSession(context.Context, *session.Meta, string, string) error {
	l.maintained++
	return nil
}

func TestAuthenticatedPluginSessionRegistryCredentialAndGenerationIsolation(t *testing.T) {
	t.Parallel()

	registry := newAuthenticatedPluginSessionRegistry()
	first, err := registry.register(session.Meta{ChannelID: "ch-local", UserPublicID: "user-1"}, "credential-one")
	if err != nil {
		t.Fatalf("register first generation: %v", err)
	}
	if _, _, _, ok := registry.acquireCredential("wrong"); ok {
		t.Fatal("wrong credential acquired a plugin session")
	}
	channelID, meta, release, ok := registry.acquireCredential("credential-one")
	if !ok || channelID != "ch-local" || meta == nil || meta.UserPublicID != "user-1" {
		t.Fatalf("first credential acquisition = channel %q meta %+v ok %v", channelID, meta, ok)
	}
	release()

	if _, err := registry.register(session.Meta{ChannelID: "ch-local", UserPublicID: "user-2"}, "credential-two"); err == nil {
		t.Fatal("active channel replacement unexpectedly succeeded")
	}
	_, _, stillActiveRelease, ok := registry.acquireCredential("credential-one")
	if !ok {
		t.Fatal("failed replacement changed the active generation")
	}
	stillActiveRelease()
	if !registry.retire(first) || !registry.terminalize(first) || !registry.discardTerminal(first) {
		t.Fatal("first generation did not retire and finalize")
	}
	second, err := registry.register(session.Meta{ChannelID: "ch-local", UserPublicID: "user-2"}, "credential-two")
	if err != nil {
		t.Fatalf("register next generation: %v", err)
	}
	if second <= first {
		t.Fatalf("replacement generation = %d, want greater than %d", second, first)
	}
	if _, _, _, ok := registry.acquireCredential("credential-one"); ok {
		t.Fatal("retired generation credential remained active")
	}
	channelID, meta, release, ok = registry.acquireCredential("credential-two")
	if !ok || channelID != "ch-local" || meta == nil || meta.UserPublicID != "user-2" {
		t.Fatalf("replacement credential acquisition = channel %q meta %+v ok %v", channelID, meta, ok)
	}
	release()
}

func TestAuthenticatedPluginSessionRegistryRetireDrainsAdmissionExactlyOnce(t *testing.T) {
	t.Parallel()

	registry := newAuthenticatedPluginSessionRegistry()
	generation, err := registry.register(session.Meta{ChannelID: "ch-remote"}, "")
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	_, release, ok := registry.acquireChannel("ch-remote")
	if !ok {
		t.Fatal("active generation was not admitted")
	}
	if !registry.retire(generation) {
		t.Fatal("retire failed")
	}
	if _, _, ok := registry.acquireChannel("ch-remote"); ok {
		t.Fatal("retired generation accepted new admission")
	}

	waitCtx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err := registry.waitDrained(waitCtx, generation); err == nil {
		t.Fatal("generation drained while admission was still held")
	}

	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			release()
		}()
	}
	wg.Wait()
	if err := registry.waitDrained(context.Background(), generation); err != nil {
		t.Fatalf("wait drained: %v", err)
	}
	if !registry.terminalize(generation) {
		t.Fatal("drained generation did not terminalize")
	}
}

func TestAuthenticatedPluginSessionRegistryStopAdmissionRetiresAll(t *testing.T) {
	t.Parallel()

	registry := newAuthenticatedPluginSessionRegistry()
	if _, err := registry.register(session.Meta{ChannelID: "ch-one"}, "one"); err != nil {
		t.Fatalf("register one: %v", err)
	}
	if _, err := registry.register(session.Meta{ChannelID: "ch-two"}, "two"); err != nil {
		t.Fatalf("register two: %v", err)
	}
	if got := len(registry.stopAdmission()); got != 2 {
		t.Fatalf("retired generations = %d, want 2", got)
	}
	if _, _, ok := registry.acquireChannel("ch-one"); ok {
		t.Fatal("channel admission succeeded after stop")
	}
	if _, err := registry.register(session.Meta{ChannelID: "ch-three"}, "three"); err == nil {
		t.Fatal("registration succeeded after stop")
	}
}

func TestAuthenticatedPluginSessionRegistryRetiresExactAccessSession(t *testing.T) {
	t.Parallel()

	registry := newAuthenticatedPluginSessionRegistry()
	first, err := registry.registerCredentialHashBound(
		session.Meta{ChannelID: "ch-one"}, [32]byte{1}, true, "access-one", nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	second, err := registry.registerCredentialHashBound(
		session.Meta{ChannelID: "ch-two"}, [32]byte{2}, true, "access-two", nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	_, release, ok := registry.acquireChannel("ch-one")
	if !ok {
		t.Fatal("failed to acquire first generation")
	}
	closes := registry.retireAccessSession("access-one")
	if len(closes) != 1 || closes[0].generation != first || closes[0].channelID != "ch-one" {
		t.Fatalf("retired access session = %#v", closes)
	}
	if _, _, ok := registry.acquireChannel("ch-one"); ok {
		t.Fatal("retired access session still accepted admission")
	}
	_, releaseSibling, ok := registry.acquireChannel("ch-two")
	if !ok {
		t.Fatal("sibling access session was retired")
	}
	releaseSibling()
	waitCtx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	if err := registry.waitDrained(waitCtx, first); err == nil {
		t.Fatal("retired generation drained before its lease was released")
	}
	release()
	if _, ok := registry.beginClose(first); !ok {
		t.Fatal("retired generation did not begin close")
	}
	if !registry.terminalize(first) || !registry.discardTerminal(first) {
		t.Fatal("retired generation did not finalize")
	}
	if generation, ok := registry.activeGeneration("ch-two"); !ok || generation != second {
		t.Fatalf("sibling generation = (%d, %v), want (%d, true)", generation, ok, second)
	}
}

func TestMarkSessionConnectedFinalizesDurableGenerationWhenSessionIsReplacedDuringBind(t *testing.T) {
	original := &activeSession{meta: session.Meta{ChannelID: "ch-race", UserPublicID: "user-original"}}
	replacement := &activeSession{meta: session.Meta{ChannelID: "ch-race", UserPublicID: "user-replacement"}}
	lifecycle := &recordingPluginSessionLifecycle{}
	a := &Agent{
		sessions:               map[string]*activeSession{"ch-race": original},
		pluginSessions:         newAuthenticatedPluginSessionRegistry(),
		pluginSessionLifecycle: lifecycle,
	}
	lifecycle.onBind = func() {
		a.mu.Lock()
		a.sessions["ch-race"] = replacement
		a.mu.Unlock()
	}

	err := a.markSessionConnected("ch-race", 1_700_000_000_000)
	if err == nil || err.Error() != "session was replaced during activation" {
		t.Fatalf("markSessionConnected() error = %v, want replacement error", err)
	}
	if !a.waitForPluginSessionCloses(time.Second) {
		t.Fatal("replacement cleanup did not finish")
	}
	if lifecycle.recorded != 1 || lifecycle.maintained != 1 {
		t.Fatalf("durable cleanup calls = record %d maintain %d, want 1 each", lifecycle.recorded, lifecycle.maintained)
	}
	a.pluginSessions.mu.Lock()
	remaining := len(a.pluginSessions.byGeneration)
	a.pluginSessions.mu.Unlock()
	if remaining != 0 {
		t.Fatalf("replacement cleanup left %d in-memory generations", remaining)
	}
	a.mu.Lock()
	current := a.sessions["ch-race"]
	a.mu.Unlock()
	if current != replacement {
		t.Fatal("replacement cleanup removed the new active session")
	}
}
