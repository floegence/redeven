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
	"strconv"
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

func TestExtensionExistingSourceStillValidatesExplicitFlowerSelection(t *testing.T) {
	tab := ComputerBrowserTab{ID: "7", NativeTargetID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", URL: "https://example.test/current", Title: "Current"}
	host, _ := browserHostFixture(t, func(w http.ResponseWriter, request *http.Request) {
		var command struct{ ID, Method string }
		_ = json.NewDecoder(request.Body).Decode(&command)
		var result any = true
		if command.Method == "source.inventory" {
			result = []ComputerBrowserTab{tab}
		} else if command.Method != "source.ready" {
			t.Error("existing source was recreated", command.Method)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": command.ID, "result": result})
	})
	runtime := NewComputerUseRuntime(NewTargetRegistry(), nil, t.TempDir())
	hub, client, peer := extensionFixture(t)
	runtime.extension, runtime.browserHost = hub, host
	runtime.executors = make(map[string]TargetToolExecutor)
	id := extensionNativeTargetID(client, tab.NativeTargetID)
	binding := "11111111-1111-1111-1111-111111111111"
	executor := &extensionTargetExecutor{client: client, tabID: tab.ID, nativeTargetID: tab.NativeTargetID, targetID: id, sourceHost: host, pipe: &extensionSourcePipe{ctx: t.Context(), binding: binding}}
	runtime.executors[id] = executor
	if err := runtime.registry.Register(TargetDescriptor{ID: id, Kind: "browser.connected", State: "ready", Ready: true}); err != nil {
		t.Fatal(err)
	}
	var validations atomic.Int32
	go func() {
		for {
			raw, err := browserbridge.ReadMessage(peer, 1<<20)
			if err != nil {
				return
			}
			var command struct {
				ID, Command string
				Arguments   map[string]string
			}
			_ = json.Unmarshal(raw, &command)
			response := map[string]any{"id": command.ID}
			switch command.Command {
			case "inventory":
				response["result"] = []ComputerBrowserTab{tab}
			case "bind":
				validations.Add(1)
				if command.Arguments["tab_url"] != tab.URL || command.Arguments["tab_title"] != tab.Title {
					response["error"] = "refresh tab selection"
				} else {
					response["result"] = map[string]string{"tab_id": tab.ID, "native_target_id": tab.NativeTargetID, "title": tab.Title, "binding": binding}
				}
			default:
				response["error"] = "unexpected command"
			}
			if browserbridge.WriteMessage(peer, response, 1<<20) != nil {
				return
			}
		}
	}()
	connection := ComputerBrowserConnection{ExtensionProfileID: client.profile.ID, TabID: tab.ID, TabURL: tab.URL, TabTitle: "Earlier title"}
	if _, err := runtime.ConnectBrowser(t.Context(), connection); err == nil {
		t.Fatal("an existing source bypassed explicit Flower selection validation")
	}
	connection.TabTitle = tab.Title
	if target, err := runtime.ConnectBrowser(t.Context(), connection); err != nil || target.ID != id || runtime.executors[id] != executor || validations.Load() != 2 {
		t.Fatal("a current explicit selection did not reuse the single validated owner", target, err, validations.Load())
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
		pipe := &extensionSourcePipe{binding: "12345678-1234-1234-1234-123456789012"}
		pipe.once.Do(func() {})
		runtime.executors[id] = &extensionTargetExecutor{client: client, tabID: id, pipe: pipe}
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
			err = browserbridge.WriteMessage(peer, map[string]any{"type": "target_unavailable", "tab_id": "7", "binding": "12345678-1234-1234-1234-123456789012", "reason": "debugger_detached"}, 1<<20)
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
				ID        string `json:"id"`
				Command   string `json:"command"`
				Arguments struct {
					TabID string `json:"tab_id"`
				} `json:"arguments"`
			}
			if json.Unmarshal(raw, &request) != nil {
				return
			}
			result := map[string]any{}
			if request.Command == "new_tab" {
				created++
				result = map[string]any{"tab_id": fmt.Sprint(created), "title": "Task", "native_target_id": fmt.Sprintf("%032d", created)}
			}
			if request.Command == "bind" {
				tab, _ := strconv.Atoi(request.Arguments.TabID)
				result = map[string]any{"tab_id": request.Arguments.TabID, "title": "Task", "native_target_id": fmt.Sprintf("%032d", tab), "binding": fmt.Sprintf("12345678-1234-1234-1234-%012d", tab)}
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

func TestExtensionLateBindingRetirementPreservesReconnectedSource(t *testing.T) {
	registry := NewTargetRegistry()
	client := &computerExtensionClient{}
	pipe := &extensionSourcePipe{binding: "current"}
	current := &extensionTargetExecutor{client: client, tabID: "7", pipe: pipe}
	runtime := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{"stable": current}, t.TempDir())
	if err := registry.Register(TargetDescriptor{ID: "stable", Kind: "browser.connected"}); err != nil {
		t.Fatal(err)
	}
	runtime.retireExtensionBinding(client, "7", "old")
	if runtime.executors["stable"] != current {
		t.Fatal("late binding retirement removed the current source")
	}
}

func TestExtensionCloseWaitsForNativeBindingRetirement(t *testing.T) {
	_, client, peer := extensionFixture(t)
	local, remote := net.Pipe()
	defer remote.Close()
	ctx, cancel := context.WithCancel(t.Context())
	pipe := &extensionSourcePipe{client: client, conn: local, ctx: ctx, cancel: cancel, tab: "7", binding: "12345678-1234-1234-1234-123456789012"}
	executor := &extensionTargetExecutor{client: client, pipe: pipe}
	finished := make(chan error, 1)
	go func() { finished <- executor.Close() }()
	raw, err := browserbridge.ReadMessage(peer, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	var request struct{ ID, Command string }
	if err := json.Unmarshal(raw, &request); err != nil {
		t.Fatal(err)
	}
	if request.Command != "unbind" {
		t.Fatal("source did not retire its native binding")
	}
	select {
	case <-finished:
		t.Fatal("source close returned before its native binding retired")
	default:
	}
	if err := browserbridge.WriteMessage(peer, map[string]any{"id": request.ID, "result": map[string]any{}}, 1<<20); err != nil {
		t.Fatal(err)
	}
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
}
