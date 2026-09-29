package ai

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/browserbridge"
)

// This diagnostic calls the real resolver and holds only its external source

func TestExtensionAdmissionSerializesOneNativeOwnerAndCancelsOnlyWaiter(t *testing.T) {
	runtime := NewComputerUseRuntime(NewTargetRegistry(), nil, t.TempDir())
	_, client, _ := extensionFixture(t)
	release, err := runtime.lockExtensionAdmission(t.Context(), client, "7")
	if err != nil {
		t.Fatal(err)
	}
	waitContext, cancel := context.WithCancel(t.Context())
	waited := make(chan error, 1)
	go func() {
		unlock, err := runtime.lockExtensionAdmission(waitContext, client, "7")
		if unlock != nil {
			unlock()
			waited <- errors.New("second native owner admitted")
			return
		}
		waited <- err
	}()
	other, err := runtime.lockExtensionAdmission(t.Context(), client, "8")
	if err != nil {
		t.Fatal(err)
	}
	other()
	cancel()
	if err := <-waited; !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	runtime.mu.RLock()
	remaining := len(runtime.extensionAdmissions)
	runtime.mu.RUnlock()
	if remaining != 1 {
		t.Fatalf("cancellation changed the owner: %d", remaining)
	}
	release()
	replacement := &computerExtensionClient{profile: client.profile}
	unlock, err := runtime.lockExtensionAdmission(t.Context(), replacement, "7")
	if err != nil {
		t.Fatal(err)
	}
	unlock()
	runtime.mu.RLock()
	defer runtime.mu.RUnlock()
	if len(runtime.extensionAdmissions) != 0 {
		t.Fatal("admission entries were not retired")
	}
}

func TestExtensionAdmissionFailureDetachesOnlyNewBinding(t *testing.T) {
	for _, created := range []bool{false, true} {
		name := "reused"
		if created {
			name = "created"
		}
		t.Run(name, func(t *testing.T) {
			tab := ComputerBrowserTab{ID: "7", NativeTargetID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", URL: "https://fixture.test/", Title: "Fixture"}
			host, _ := browserHostFixture(t, func(w http.ResponseWriter, request *http.Request) {
				var command struct{ ID, Method string }
				_ = json.NewDecoder(request.Body).Decode(&command)
				var result any = true
				switch command.Method {
				case "source.inventory":
					result = []ComputerBrowserTab{tab}
				case "source.remove":
				default:
					t.Errorf("unexpected source operation: %s", command.Method)
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"id": command.ID, "result": result})
			})
			runtime := NewComputerUseRuntime(NewTargetRegistry(), nil, t.TempDir())
			hub, client, peer := extensionFixture(t)
			runtime.extension, runtime.browserHost = hub, host
			binding := "11111111-1111-1111-1111-111111111111"
			var detached atomic.Int32
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
					var result any = true
					switch command.Command {
					case "inventory":
						result = []ComputerBrowserTab{tab}
					case "bind":
						// The browser changed identity between inventory and binding.
						result = map[string]any{"tab_id": tab.ID, "native_target_id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "binding": binding, "created": created}
					case "unbind":
						if command.Arguments["tab_id"] != tab.ID || command.Arguments["binding"] != binding {
							t.Error("failed admission detached another generation")
						}
						detached.Add(1)
					default:
						t.Errorf("unexpected native command: %s", command.Command)
					}
					if browserbridge.WriteMessage(peer, map[string]any{"id": command.ID, "result": result}, 1<<20) != nil {
						return
					}
				}
			}()
			id := extensionNativeTargetID(client, tab.NativeTargetID)
			_, err := runtime.connectExtensionBrowser(t.Context(), ComputerBrowserConnection{ExtensionProfileID: client.profile.ID, TabID: tab.ID, nativeTargetID: tab.NativeTargetID}, id)
			if err == nil {
				t.Fatal("changed native identity was admitted")
			}
			want := int32(0)
			if created {
				want = 1
			}
			if detached.Load() != want {
				t.Fatalf("detach count: got %d, want %d", detached.Load(), want)
			}
			if len(runtime.executors) != 0 || len(runtime.extensionAdmissions) != 0 {
				t.Fatal("failed admission retained execution authority")
			}
		})
	}
}

func TestExtensionAdmissionCancellationPreservesExistingSource(t *testing.T) {
	tab := ComputerBrowserTab{ID: "7", NativeTargetID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", URL: "https://fixture.test/", Title: "Fixture"}
	checking := make(chan struct{})
	host, _ := browserHostFixture(t, func(w http.ResponseWriter, request *http.Request) {
		var command struct{ ID, Method string }
		_ = json.NewDecoder(request.Body).Decode(&command)
		switch command.Method {
		case "source.inventory":
			_ = json.NewEncoder(w).Encode(map[string]any{"id": command.ID, "result": []ComputerBrowserTab{tab}})
		case "source.ready":
			close(checking)
			<-request.Context().Done()
		default:
			t.Errorf("canceled caller changed its existing source: %s", command.Method)
		}
	})
	runtime := NewComputerUseRuntime(NewTargetRegistry(), nil, t.TempDir())
	hub, client, peer := extensionFixture(t)
	runtime.extension, runtime.browserHost = hub, host
	id := extensionNativeTargetID(client, tab.NativeTargetID)
	pipeContext, stopPipe := context.WithCancel(t.Context())
	defer stopPipe()
	previous := &extensionTargetExecutor{client: client, tabID: tab.ID, targetID: id, nativeTargetID: tab.NativeTargetID, sourceHost: host, pipe: &extensionSourcePipe{ctx: pipeContext, binding: "11111111-1111-1111-1111-111111111111"}}
	runtime.executors = map[string]TargetToolExecutor{id: previous}
	go func() {
		for {
			raw, err := browserbridge.ReadMessage(peer, 1<<20)
			if err != nil {
				return
			}
			var command struct{ ID, Command string }
			_ = json.Unmarshal(raw, &command)
			if command.Command != "inventory" {
				t.Errorf("canceled caller changed its existing native binding: %s", command.Command)
			}
			if browserbridge.WriteMessage(peer, map[string]any{"id": command.ID, "result": []ComputerBrowserTab{tab}}, 1<<20) != nil {
				return
			}
		}
	}()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, err := runtime.connectExtensionBrowser(ctx, ComputerBrowserConnection{ExtensionProfileID: client.profile.ID, TabID: tab.ID, nativeTargetID: tab.NativeTargetID}, id)
		done <- err
	}()
	select {
	case <-checking:
	case <-time.After(time.Second):
		t.Fatal("source readiness check did not start")
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancellation result: %v", err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("canceled source admission did not return")
	}
	if runtime.executors[id] != previous || previous.pipe.ctx.Err() != nil || len(runtime.extensionAdmissions) != 0 {
		t.Fatal("canceled caller retired another viewer's source")
	}
}
