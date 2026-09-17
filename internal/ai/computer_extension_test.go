package ai

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/floegence/redeven/internal/browserbridge"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func extensionFixture(t *testing.T, owners ...*ComputerUseRuntime) (*computerExtensionHub, *computerExtensionClient, net.Conn) {
	t.Helper()
	directory, err := os.MkdirTemp("", "flower-extension-test-")
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("unix", filepath.Join(directory, "bridge"))
	if err != nil {
		t.Fatal(err)
	}
	hub := &computerExtensionHub{listener: listener, directory: directory, profiles: make(map[string]*computerExtensionClient)}
	if len(owners) > 0 {
		hub.owner = owners[0]
	}
	hub.wait.Add(1)
	go hub.accept()
	t.Cleanup(hub.close)
	peer, err := net.Dial("unix", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = peer.Close() })
	for _, message := range []map[string]any{
		{"type": "native_host", "protocol_version": 2, "extension_id": browserbridge.ExtensionID},
		{"type": "hello", "protocol_version": 2, "profile_id": "12345678-1234-1234-1234-123456789abc", "profile_name": "Work"},
	} {
		if err := browserbridge.WriteMessage(peer, message, 1<<20); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := browserbridge.ReadMessage(peer, 1<<20); err != nil {
		t.Fatal(err)
	}
	// The ready response is written under the same lock that publishes the client.
	hub.mu.Lock()
	defer hub.mu.Unlock()
	for _, client := range hub.profiles {
		return hub, client, peer
	}
	t.Fatal("profile not admitted")
	return nil, nil, nil
}
func TestExtensionConnectionScopesRepliesAndRemovesDisconnectedProfile(t *testing.T) {
	hub, client, peer := extensionFixture(t)
	done := make(chan error, 1)
	go func() {
		raw, err := browserbridge.ReadMessage(peer, 1<<20)
		if err != nil {
			done <- err
			return
		}
		var request struct {
			ID      string `json:"id"`
			Command string `json:"command"`
		}
		if json.Unmarshal(raw, &request) != nil || request.Command != "inventory" {
			done <- errors.New("wrong command")
			return
		}
		done <- browserbridge.WriteMessage(peer, map[string]any{"id": request.ID, "result": []any{}}, 1<<20)
	}()
	if _, err := client.call(t.Context(), "inventory", nil); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	_ = peer.Close()
	select {
	case <-client.done:
	case <-time.After(time.Second):
		t.Fatal("disconnect not observed")
	}
	// Read-loop retirement removes the only profile owner without polling.
	hub.mu.Lock()
	count := len(hub.profiles)
	hub.mu.Unlock()
	if count != 0 {
		t.Fatalf("profiles retained: %d", count)
	}
}
func TestExtensionLostEffectIsTerminalAndNeverReplayed(t *testing.T) {
	_, client, peer := extensionFixture(t)
	done := make(chan struct{})
	go func() { _, _ = browserbridge.ReadMessage(peer, 1<<20); _ = peer.Close(); close(done) }()
	executor := &extensionTargetExecutor{client: client, tabID: "7"}
	_, err := executor.ExecuteTargetTool(t.Context(), TargetToolCall{TargetID: "chrome-task", ToolName: "computer.click", Arguments: json.RawMessage(`{"x":1,"y":2}`)})
	if !errors.Is(err, errComputerEffectUnknown) {
		t.Fatalf("effect result: %v", err)
	}
	<-done
}
func TestExtensionCancellationPreservesOtherTabCommands(t *testing.T) {
	_, client, peer := extensionFixture(t)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	entered := make(chan struct{})
	peerResult := make(chan error, 1)
	go func() {
		raw, err := browserbridge.ReadMessage(peer, 1<<20)
		if err != nil {
			peerResult <- err
			return
		}
		var first struct {
			ID string `json:"id"`
		}
		if err = json.Unmarshal(raw, &first); err != nil {
			peerResult <- err
			return
		}
		close(entered)
		raw, err = browserbridge.ReadMessage(peer, 1<<20)
		if err != nil {
			peerResult <- err
			return
		}
		var cancellation struct {
			Type string `json:"type"`
			ID   string `json:"id"`
		}
		if json.Unmarshal(raw, &cancellation) != nil || cancellation.Type != "cancel" || cancellation.ID != first.ID {
			peerResult <- errors.New("cancellation was not scoped to the first request")
			return
		}
		if err = browserbridge.WriteMessage(peer, map[string]any{"id": first.ID, "error": "cancelled"}, 1<<20); err != nil {
			peerResult <- err
			return
		}
		raw, err = browserbridge.ReadMessage(peer, 1<<20)
		if err != nil {
			peerResult <- err
			return
		}
		var next struct {
			ID string `json:"id"`
		}
		if err = json.Unmarshal(raw, &next); err != nil {
			peerResult <- err
			return
		}
		peerResult <- browserbridge.WriteMessage(peer, map[string]any{"id": next.ID, "result": map[string]any{"tab": "8"}}, 1<<20)
	}()
	done := make(chan error, 1)
	go func() { _, err := client.call(ctx, "execute", map[string]any{"tab_id": "7"}); done <- err }()
	<-entered
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation: %v", err)
	}
	result, err := client.call(t.Context(), "execute", map[string]any{"tab_id": "8"})
	if err != nil || string(result) != `{"tab":"8"}` {
		t.Fatalf("other tab: %s, %v", result, err)
	}
	if err := <-peerResult; err != nil {
		t.Fatal(err)
	}
	select {
	case <-client.done:
		t.Fatal("profile disconnected")
	default:
	}
}

func TestExtensionConcurrentRepliesUseInvocationIdentity(t *testing.T) {
	_, client, peer := extensionFixture(t)
	peerResult := make(chan error, 1)
	go func() {
		type request struct {
			ID        string            `json:"id"`
			Arguments map[string]string `json:"arguments"`
		}
		requests := make([]request, 2)
		for i := range requests {
			raw, err := browserbridge.ReadMessage(peer, 1<<20)
			if err != nil {
				peerResult <- err
				return
			}
			if err = json.Unmarshal(raw, &requests[i]); err != nil {
				peerResult <- err
				return
			}
		}
		for i := len(requests) - 1; i >= 0; i-- {
			if err := browserbridge.WriteMessage(peer, map[string]any{"id": requests[i].ID, "result": requests[i].Arguments}, 1<<20); err != nil {
				peerResult <- err
				return
			}
		}
		peerResult <- nil
	}()
	results := make(chan error, 2)
	for _, tab := range []string{"7", "8"} {
		go func() {
			result, err := client.call(t.Context(), "execute", map[string]string{"tab_id": tab})
			var value map[string]string
			if err == nil && (json.Unmarshal(result, &value) != nil || value["tab_id"] != tab) {
				err = errors.New("crossed tab replies")
			}
			results <- err
		}()
	}
	for range 2 {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	if err := <-peerResult; err != nil {
		t.Fatal(err)
	}
}

func TestExtensionRetirementRemovesOnlyItsOwnTargets(t *testing.T) {
	registry := NewTargetRegistry()
	retired := &computerExtensionClient{}
	current := &computerExtensionClient{}
	for _, id := range []string{"old", "sibling"} {
		if err := registry.Register(TargetDescriptor{ID: id, Kind: "browser.connected"}); err != nil {
			t.Fatal(err)
		}
	}
	runtime := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{
		"old":     &extensionTargetExecutor{client: retired, tabID: "1"},
		"sibling": &extensionTargetExecutor{client: current, tabID: "1"},
	}, t.TempDir())
	runtime.controlForTarget("old")
	runtime.retireExtensionTargets(retired, "")
	if _, err := runtime.ResolveTarget(t.Context(), "old"); !errors.Is(err, errTargetNotRegistered) {
		t.Fatalf("old target remains: %v", err)
	}
	if _, err := runtime.ResolveTarget(t.Context(), "sibling"); err != nil {
		t.Fatal(err)
	}
	if runtime.controls["old"] != nil || runtime.executors["old"] != nil {
		t.Fatal("retired resources retained")
	}
	// A delayed retirement from an old connection must not remove a replacement.
	runtime.executors["old"] = &extensionTargetExecutor{client: current, tabID: "1"}
	if err := registry.Register(TargetDescriptor{ID: "old", Kind: "browser.connected"}); err != nil {
		t.Fatal(err)
	}
	runtime.retireExtensionTargets(retired, "")
	if _, err := runtime.ResolveTarget(t.Context(), "old"); err != nil {
		t.Fatal("old client retired new binding")
	}
}

func TestExtensionUnavailableEventRetiresExactTabBeforeNextReply(t *testing.T) {
	registry := NewTargetRegistry()
	runtime := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{}, t.TempDir())
	_, client, peer := extensionFixture(t, runtime)
	for _, id := range []string{"7", "8"} {
		if err := registry.Register(TargetDescriptor{ID: id, Kind: "browser.connected"}); err != nil {
			t.Fatal(err)
		}
		runtime.mu.Lock()
		runtime.executors[id] = &extensionTargetExecutor{client: client, tabID: id}
		runtime.mu.Unlock()
	}
	result := make(chan error, 1)
	go func() {
		raw, err := browserbridge.ReadMessage(peer, 1<<20)
		var request struct {
			ID string `json:"id"`
		}
		if err == nil {
			err = json.Unmarshal(raw, &request)
		}
		if err == nil {
			err = browserbridge.WriteMessage(peer, map[string]any{"type": "target_unavailable", "tab_id": "7"}, 1<<20)
		}
		if err == nil {
			err = browserbridge.WriteMessage(peer, map[string]any{"id": request.ID, "result": []any{}}, 1<<20)
		}
		result <- err
	}()
	if _, err := client.call(t.Context(), "inventory", nil); err != nil {
		t.Fatal(err)
	}
	if err := <-result; err != nil {
		t.Fatal(err)
	}
	if _, err := runtime.ResolveTarget(t.Context(), "7"); !errors.Is(err, errTargetNotRegistered) {
		t.Fatalf("closed tab remains: %v", err)
	}
	if _, err := runtime.ResolveTarget(t.Context(), "8"); err != nil {
		t.Fatal("closing a tab retired its sibling")
	}
}
