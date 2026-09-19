package containerengine

import (
	"context"
	"errors"
	"strings"
	"testing"
	"testing/synctest"
	"time"
)

func TestRuntimeDetectionDoesNotWaitForServiceManagement(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		runner := &runtimeDiscoveryRunner{
			outputs: map[string]string{
				"docker context ls --format {{json .}}": `{"Name":"desktop-linux","Current":true}`,
			},
			errors: map[string]error{
				"docker --context desktop-linux version --format {{json .}}": ErrDaemonStopped,
				"podman system connection list --format json":                ErrCLIUnavailable,
			},
		}
		client := &CLIClient{Runner: CommandRunnerFunc(func(ctx context.Context, name string, args ...string) ([]byte, error) {
			if name == "docker" && strings.Join(args, " ") == "desktop status --format json" {
				// Docker Desktop's management CLI waits even after version has
				// already established that the selected daemon is stopped.
				<-ctx.Done()
				return nil, ctx.Err()
			}
			return runner.Run(ctx, name, args...)
		})}
		adapter, err := NewAdapter(client)
		if err != nil {
			t.Fatal(err)
		}
		started := time.Now()
		response, err := adapter.ActiveRuntimes(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if elapsed := time.Since(started); elapsed != 0 {
			t.Fatalf("stopped runtime detection waited %s for service management", elapsed)
		}
		if len(response.Engines) != 2 || response.Engines[0].State != RuntimeStateStopped || response.Engines[1].State != RuntimeStateNotInstalled {
			t.Fatalf("runtime states = %+v", response.Engines)
		}
		if response.Engines[0].EndpointID != "" || response.Engines[0].Capabilities != nil {
			t.Fatalf("stopped runtime exposes resource access: %+v", response.Engines[0])
		}
	})
}

func TestRuntimeDetectionBoundsEachEngineIndependently(t *testing.T) {
	for _, bothBlocked := range []bool{false, true} {
		name := "one unresponsive engine"
		if bothBlocked {
			name = "both engines unresponsive"
		}
		t.Run(name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				ready := &runtimeDiscoveryRunner{outputs: map[string]string{
					"podman system connection list --format json": `[]`,
					"podman version --format {{json .}}":          `{"Server":{"Version":"5.4.0"}}`,
					"podman info --format json":                   `{"host":{"security":{"rootless":true}}}`,
				}}
				client := &CLIClient{Runner: CommandRunnerFunc(func(ctx context.Context, name string, args ...string) ([]byte, error) {
					if name == "docker" || bothBlocked {
						<-ctx.Done()
						return nil, ctx.Err()
					}
					return ready.Run(ctx, name, args...)
				})}
				adapter, err := NewAdapter(client)
				if err != nil {
					t.Fatal(err)
				}
				started := time.Now()
				response, err := adapter.ActiveRuntimes(context.Background())
				if err != nil {
					t.Fatal(err)
				}
				if elapsed := time.Since(started); elapsed > 2*time.Second {
					t.Fatalf("runtime detection took %s, want at most 2s", elapsed)
				}
				if len(response.Engines) != 2 || response.Engines[0].State != RuntimeStateUnreachable {
					t.Fatalf("runtime states = %+v", response.Engines)
				}
				podman := response.Engines[1]
				if bothBlocked {
					if podman.State != RuntimeStateUnreachable {
						t.Fatalf("unresponsive Podman = %+v", podman)
					}
				} else if podman.State != RuntimeStateReady || !podman.EndpointID.Valid() || podman.Rootless == nil || !*podman.Rootless {
					t.Fatalf("responsive Podman = %+v", podman)
				}
			})
		})
	}
}

func TestRuntimeDetectionSharesOneBudgetAcrossProbeCommands(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		runner := &runtimeDiscoveryRunner{outputs: map[string]string{
			"docker context ls --format {{json .}}":                `{"Name":"default","Current":true}`,
			"docker --context default version --format {{json .}}": `{"Server":{"Version":"29.0.0"}}`,
		}, errors: map[string]error{"podman system connection list --format json": ErrCLIUnavailable}}
		client := &CLIClient{Runner: CommandRunnerFunc(func(ctx context.Context, name string, args ...string) ([]byte, error) {
			if name == "docker" {
				select {
				case <-ctx.Done():
					return nil, ctx.Err()
				case <-time.After(750 * time.Millisecond):
				}
			}
			return runner.Run(ctx, name, args...)
		})}
		adapter, err := NewAdapter(client)
		if err != nil {
			t.Fatal(err)
		}
		started := time.Now()
		response, err := adapter.ActiveRuntimes(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if elapsed := time.Since(started); elapsed > 2*time.Second {
			t.Fatalf("sequential probe commands exceeded the discovery budget: %s", elapsed)
		}
		if response.Engines[0].State != RuntimeStateUnreachable {
			t.Fatalf("incomplete runtime observation = %+v", response.Engines[0])
		}
	})
}

func TestRuntimeDetectionPreservesRequestCancellation(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		client := &CLIClient{Runner: CommandRunnerFunc(func(ctx context.Context, _ string, _ ...string) ([]byte, error) {
			<-ctx.Done()
			return nil, ctx.Err()
		})}
		adapter, err := NewAdapter(client)
		if err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithCancel(context.Background())
		time.AfterFunc(100*time.Millisecond, cancel)
		defer cancel()
		response, err := adapter.ActiveRuntimes(ctx)
		if !errors.Is(err, context.Canceled) || len(response.Engines) != 0 {
			t.Fatalf("canceled discovery = %+v, %v", response, err)
		}
	})
}
