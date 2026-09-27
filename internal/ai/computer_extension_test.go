package ai

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/browserbridge"
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
	registration := &computerExtensionRegistration{installationID: "fixture", listener: listener, directory: directory}
	hub := &computerExtensionHub{registrations: map[string]*computerExtensionRegistration{"fixture": registration}, profiles: make(map[string]*computerExtensionClient)}
	if len(owners) > 0 {
		hub.owner = owners[0]
	}
	hub.wait.Add(1)
	go hub.accept(registration)
	t.Cleanup(hub.close)
	peer, err := net.Dial("unix", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = peer.Close() })
	for _, message := range []map[string]any{
		{"type": "native_host", "protocol_version": browserbridge.ProtocolVersion, "extension_id": browserbridge.ExtensionID},
		{"type": "hello", "protocol_version": browserbridge.ProtocolVersion, "profile_id": "12345678-1234-1234-1234-123456789abc", "profile_name": "Work"},
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
	var calls atomic.Int32
	host, _ := browserHostFixture(t, func(w http.ResponseWriter, r *http.Request) {
		var request struct{ ID, Method string }
		_ = json.NewDecoder(r.Body).Decode(&request)
		if request.Method == "source.cancel" {
			_ = json.NewEncoder(w).Encode(map[string]any{"id": request.ID, "result": true})
			return
		}
		calls.Add(1)
		conn, _, err := w.(http.Hijacker).Hijack()
		if err == nil {
			_ = conn.Close()
		}
	})
	executor := &extensionTargetExecutor{sourceHost: host, targetID: "chrome-task"}
	_, err := executor.ExecuteTargetTool(t.Context(), TargetToolCall{TargetID: "chrome-task", ToolName: "computer.click", Arguments: json.RawMessage(`{"x":1,"y":2}`)})
	if !errors.Is(err, errComputerEffectUnknown) || calls.Load() != 1 {
		t.Fatalf("effect result: %v, calls: %d", err, calls.Load())
	}

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

func TestExtensionAutonomousConversationsCreateIndependentBackgroundTabs(t *testing.T) {
	host, _, store, _ := computerBindingFixture(t)
	hub, _, peer := extensionFixture(t, host)
	host.extension = hub
	sourceHost, _ := browserHostFixture(t, func(w http.ResponseWriter, r *http.Request) {
		var request struct{ ID, Method string }
		_ = json.NewDecoder(r.Body).Decode(&request)
		_ = json.NewEncoder(w).Encode(map[string]any{"id": request.ID, "result": map[string]any{"result": map[string]any{"selected": true}, "safety": map[string]any{"level": "routine", "safe_to_capture": false, "safe_to_send_to_model": false}}})
	})
	directory, err := os.MkdirTemp("/tmp", "extension-source-test-")
	if err != nil {
		t.Fatal(err)
	}
	sourceHost.directory = directory
	listener, err := net.Listen("unix", filepath.Join(directory, "host.sock"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				_, err := http.ReadRequest(bufio.NewReader(conn))
				if err != nil {
					return
				}
				_, _ = io.WriteString(conn, "HTTP/1.1 200 Connection Established\r\n\r\n")
				_, _ = io.Copy(io.Discard, conn)
			}()
		}
	}()
	host.browserHost = sourceHost
	done := make(chan struct{})
	created := 0
	go func() {
		defer close(done)
		for {
			raw, err := browserbridge.ReadMessage(peer, 1<<20)
			if err != nil {
				return
			}
			var request struct {
				ID      string `json:"id"`
				Command string `json:"command"`
			}
			if json.Unmarshal(raw, &request) != nil {
				return
			}
			result := map[string]any{}
			if request.Command == "new_tab" {
				created++
				result = map[string]any{"tab_id": fmt.Sprint(created), "title": "Task", "binding": fmt.Sprintf("12345678-1234-1234-1234-%012d", created)}
			}
			if err := browserbridge.WriteMessage(peer, map[string]any{"id": request.ID, "result": result}, 1<<20); err != nil {
				return
			}
		}
	}()
	results := make(chan TargetDescriptor, 2)
	failures := make(chan error, 2)
	for _, thread := range []string{"thread-first", "thread-second"} {
		go func() {
			planned, err := host.ResolveTargetForThread(t.Context(), thread, "current")
			if err == nil {
				planned, err = host.selectComputerTarget(computerPermissionContext(t, "full_access"), TargetToolCall{ThreadID: thread, RunID: thread, TurnID: "turn", ToolName: "computer.select_target"}, planned)
			}
			results <- planned
			failures <- err
		}()
	}
	first, second := <-results, <-results
	for range 2 {
		if err := <-failures; err != nil {
			t.Fatal(err)
		}
	}
	if first.ID == second.ID || first.Kind != "browser.connected" || second.Kind != "browser.connected" {
		t.Fatalf("personal browser pages are not isolated: %+v %+v", first, second)
	}
	a, _ := store.GetComputerTarget(t.Context(), "thread-first")
	b, _ := store.GetComputerTarget(t.Context(), "thread-second")
	if a == b || a == "" || b == "" {
		t.Fatalf("conversation bindings crossed: %q %q", a, b)
	}
	_ = peer.Close()
	<-done
	if created != 2 {
		t.Fatalf("created %d task tabs", created)
	}
}

func TestExtensionObservationFailurePreservesOnlyConfirmedProgress(t *testing.T) {
	for _, executed := range []any{false, true, "unconfirmed"} {
		t.Run(fmt.Sprint(executed), func(t *testing.T) {
			host, _ := browserHostFixture(t, func(w http.ResponseWriter, r *http.Request) {
				var request struct{ ID string }
				_ = json.NewDecoder(r.Body).Decode(&request)
				_ = json.NewEncoder(w).Encode(map[string]any{"id": request.ID, "result": map[string]any{"error": "TARGET_OBSERVATION_UNAVAILABLE", "result": map[string]any{"action_executed": executed, "observation_stage": "safety_scan", "observation": "private"}, "screenshot": map[string]any{"mime": "image/png", "data": "private"}}})
			})
			executor := &extensionTargetExecutor{sourceHost: host, targetID: "chrome-task"}
			result, err := executor.ExecuteTargetTool(t.Context(), TargetToolCall{TargetID: "chrome-task", ToolName: "computer.click"})
			if _, ok := executed.(bool); !ok {
				if !errors.Is(err, errComputerEffectUnknown) {
					t.Fatalf("malformed progress weakened effect barrier: %v", err)
				}
				return
			}
			var failure *targetToolPolicyError
			if !errors.As(err, &failure) || failure.code != "target_observation_unavailable" {
				t.Fatalf("read failure misclassified: %v", err)
			}
			payload := result.Result.(map[string]any)
			if len(payload) != 2 || payload["action_executed"] != executed || len(result.Attachments) != 0 || len(result.frameBytes) != 0 {
				t.Fatalf("unsafe failure payload: %+v", result)
			}
		})
	}
}

func TestExtensionRejectsOldObservationProtocol(t *testing.T) {
	for _, old := range []string{"native_host", "hello"} {
		t.Run(old, func(t *testing.T) {
			hub, _, _ := extensionFixture(t)
			peer, err := net.Dial("unix", hub.registrations["fixture"].listener.Addr().String())
			if err != nil {
				t.Fatal(err)
			}
			defer peer.Close()
			if err := peer.SetDeadline(time.Now().Add(time.Second)); err != nil {
				t.Fatal(err)
			}
			messages := []map[string]any{
				{"type": "native_host", "protocol_version": browserbridge.ProtocolVersion, "extension_id": browserbridge.ExtensionID},
				{"type": "hello", "protocol_version": browserbridge.ProtocolVersion, "profile_id": "12345678-1234-1234-1234-123456789abc", "profile_name": "Old"},
			}
			for _, message := range messages {
				if message["type"] == old {
					message["protocol_version"] = 5
				}
				if err := browserbridge.WriteMessage(peer, message, 1<<20); err != nil {
					t.Fatal(err)
				}
				if message["type"] == old {
					break
				}
			}
			raw, err := browserbridge.ReadMessage(peer, 1<<20)
			if old == "hello" {
				var failure struct {
					Type string `json:"type"`
					Code string `json:"code"`
				}
				if err != nil || json.Unmarshal(raw, &failure) != nil || failure.Type != "connection_error" || failure.Code != "extension_update_required" {
					t.Fatalf("old extension did not receive actionable rejection: %s %v", raw, err)
				}
			} else if !errors.Is(err, io.EOF) {
				t.Fatalf("old native host was not rejected immediately: %v", err)
			}
			hub.mu.Lock()
			defer hub.mu.Unlock()
			if old == "hello" && (hub.registrations["fixture"].diagnostic == nil || hub.registrations["fixture"].diagnostic.Reason != "extension_update_required") {
				t.Fatal("guide lost the handshake failure")
			}
			if len(hub.profiles) != 1 {
				t.Fatal("old peer changed connected profile inventory")
			}
		})
	}
}
