package containerengine

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestVolumeDiskUsageSeparatesUnknownFromEmpty(t *testing.T) {
	for _, engine := range []Engine{EngineDocker, EnginePodman} {
		t.Run(string(engine), func(t *testing.T) {
			client := &CLIClient{Runner: CommandRunnerFunc(func(_ context.Context, name string, args ...string) ([]byte, error) {
				if name != string(engine) || !strings.HasPrefix(strings.Join(args, " "), "system df --verbose") {
					t.Fatalf("unexpected command: %s %v", name, args)
				}
				if engine == EngineDocker {
					return []byte(`[{"Name":"empty","Size":"0B"},{"Name":"data","Size":"1.25GB"},{"Name":"remote","Size":"N/A"}]`), nil
				}
				if len(args) != 3 {
					t.Fatalf("Podman cannot combine verbose and format: %v", args)
				}
				return []byte("Images space usage:\n\nContainers space usage:\n\nLocal Volumes space usage:\n\nVOLUME NAME  LINKS SIZE\nempty 0 0B\ndata 2 1.25GB\nremote 0 -1B\n"), nil
			})}
			items, err := client.VolumeDiskUsage(context.Background(), engine)
			if err != nil || len(items) != 3 {
				t.Fatalf("usage = %#v, %v", items, err)
			}
			if items[0].SizeBytes == nil || *items[0].SizeBytes != 0 || items[1].SizeBytes == nil || *items[1].SizeBytes != 1250000000 || items[2].SizeBytes != nil {
				t.Fatalf("sizes = %#v", items)
			}
			raw, _ := json.Marshal(items)
			if !strings.Contains(string(raw), `"size_bytes":0`) || strings.Contains(string(raw), `"name":"remote","size_bytes"`) {
				t.Fatalf("wire sizes = %s", raw)
			}
		})
	}
}

func TestVolumeDiskUsageRejectsMalformedOrAmbiguousOutput(t *testing.T) {
	for _, tc := range []struct {
		engine Engine
		raw    string
	}{
		{EngineDocker, `{"unexpected":true}`},
		{EngineDocker, `[{"Name":"data","Size":"1GB"},{"Name":"data","Size":"2GB"}]`},
		{EnginePodman, "Local Volumes space usage:\nVOLUME NAME LINKS SIZE\ndata 0 1GB extra"},
		{EnginePodman, "Type Total Active Size\nLocal Volumes 1 1 5GB"},
	} {
		client := &CLIClient{Runner: CommandRunnerFunc(func(context.Context, string, ...string) ([]byte, error) { return []byte(tc.raw), nil })}
		if _, err := client.VolumeDiskUsage(context.Background(), tc.engine); err == nil {
			t.Fatalf("accepted %s", tc.raw)
		}
	}
}

func TestVolumeSizeParsing(t *testing.T) {
	for _, value := range []string{"", "N/A", "-1B", "NaNGB", "InfGB", "garbage", "999999999999EB"} {
		if parseVolumeSize(value) != nil {
			t.Fatalf("accepted unavailable size %q", value)
		}
	}
	for value, want := range map[string]int64{"0B": 0, "2.5kB": 2500, "2MiB": 2097152, "1TB": 1000000000000} {
		got := parseVolumeSize(value)
		if got == nil || *got != want {
			t.Fatalf("size %q = %v", value, got)
		}
	}
}

func TestVolumeDiskUsageBindsTargetAndPropagatesCancellation(t *testing.T) {
	for _, engine := range []Engine{EngineDocker, EnginePodman} {
		ctx := context.WithValue(context.Background(), endpointContextKey{}, boundEngineEndpoint{engine: engine, name: "production", useConnection: true})
		ctx, cancel := context.WithCancel(ctx)
		client := &CLIClient{Runner: CommandRunnerFunc(func(runCtx context.Context, name string, args ...string) ([]byte, error) {
			flag := "--context"
			if engine == EnginePodman {
				flag = "--connection"
			}
			if len(args) < 3 || args[0] != flag || args[1] != "production" {
				t.Fatalf("unbound command: %s %v", name, args)
			}
			deadline, ok := runCtx.Deadline()
			if !ok || time.Until(deadline) > time.Minute {
				t.Fatal("missing bounded deadline")
			}
			cancel()
			return nil, runCtx.Err()
		})}
		if _, err := client.VolumeDiskUsage(ctx, engine); !errors.Is(err, context.Canceled) {
			t.Fatalf("cancellation = %v", err)
		}
		cancel()
	}
}
