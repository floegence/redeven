package containers

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

const (
	containersEngineSmokeEnv     = "REDEVEN_CONTAINERS_ENGINE_SMOKE"
	containersEngineSmokeEngines = "REDEVEN_CONTAINERS_ENGINE_SMOKE_ENGINES"
	containersEngineSmokeImage   = "REDEVEN_CONTAINERS_ENGINE_SMOKE_IMAGE"
	defaultEngineSmokeImage      = "docker.io/library/busybox:1.36.1"
)

func TestCLIClientRealEngineSmoke(t *testing.T) {
	if os.Getenv(containersEngineSmokeEnv) != "1" {
		t.Skipf("set %s=1 to run real Docker/Podman container engine smoke", containersEngineSmokeEnv)
	}

	engines := smokeEnginesFromEnv()
	if len(engines) == 0 {
		t.Fatalf("%s did not select any valid engines", containersEngineSmokeEngines)
	}
	imageRef := strings.TrimSpace(os.Getenv(containersEngineSmokeImage))
	if imageRef == "" {
		imageRef = defaultEngineSmokeImage
	}

	client := NewCLIClient()
	client.Timeout = 2 * time.Minute
	ran := false
	for _, engine := range engines {
		if _, err := exec.LookPath(string(engine)); err != nil {
			t.Logf("skipping %s smoke: CLI not found", engine)
			continue
		}
		status, err := client.Status(context.Background(), engine)
		if err != nil || !status.Available {
			t.Logf("skipping %s smoke: engine unavailable status=%+v err=%v", engine, status, err)
			continue
		}
		ran = true
		t.Run(string(engine), func(t *testing.T) {
			runRealEngineSmoke(t, client, engine, imageRef)
		})
	}
	if !ran {
		t.Fatalf("%s=1 but no selected container engine was available", containersEngineSmokeEnv)
	}
}

func runRealEngineSmoke(t *testing.T, client *CLIClient, engine Engine, imageRef string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	name := fmt.Sprintf("redeven-smoke-%s-%d", engine, time.Now().UnixNano())
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		if _, err := runEngineCommand(cleanupCtx, engine, "rm", "--force", name); err != nil {
			t.Logf("cleanup %s %s: %v", engine, name, err)
		}
	})

	pull, err := client.PullImage(ctx, engine, imageRef)
	if err != nil {
		t.Fatalf("%s PullImage(%q) error = %v", engine, imageRef, err)
	}
	if !pull.Completed || pull.Image.Reference != imageRef {
		t.Fatalf("%s pull result = %+v", engine, pull)
	}

	if _, err := runEngineCommand(ctx, engine,
		"create",
		"--name", name,
		imageRef,
		"sh", "-c", "echo redeven-smoke-ready; while true; do sleep 1; done",
	); err != nil {
		t.Fatalf("%s create smoke container: %v", engine, err)
	}

	inspected, err := client.Inspect(ctx, engine, name)
	if err != nil {
		t.Fatalf("%s Inspect(%s) error = %v", engine, name, err)
	}
	if inspected.ContainerID == "" || inspected.Image.Reference == "" {
		t.Fatalf("%s inspect result = %+v", engine, inspected)
	}

	if _, err := client.List(ctx, engine, true); err != nil {
		t.Fatalf("%s List(all=true) error = %v", engine, err)
	}
	if _, err := client.Action(ctx, EngineActionRequest{
		Engine:      engine,
		Method:      MethodStart,
		ContainerID: name,
	}); err != nil {
		t.Fatalf("%s start smoke container: %v", engine, err)
	}
	waitForSmokeLog(t, ctx, client, engine, name)
	waitForFollowSmokeLog(t, ctx, client, engine, name)

	if _, err := client.Action(ctx, EngineActionRequest{
		Engine:      engine,
		Method:      MethodRestart,
		ContainerID: name,
		TimeoutSec:  2,
	}); err != nil {
		t.Fatalf("%s restart smoke container: %v", engine, err)
	}
	if _, err := client.Action(ctx, EngineActionRequest{
		Engine:      engine,
		Method:      MethodStop,
		ContainerID: name,
		TimeoutSec:  2,
	}); err != nil {
		t.Fatalf("%s stop smoke container: %v", engine, err)
	}
	if _, err := client.Action(ctx, EngineActionRequest{
		Engine:      engine,
		Method:      MethodRemove,
		ContainerID: name,
		Force:       true,
	}); err != nil {
		t.Fatalf("%s remove smoke container: %v", engine, err)
	}
}

func waitForSmokeLog(t *testing.T, ctx context.Context, client *CLIClient, engine Engine, containerID string) {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for {
		logs, err := client.TailLogs(ctx, EngineLogsRequest{
			Engine:      engine,
			ContainerID: containerID,
			TailLines:   20,
		})
		if err == nil {
			for _, line := range logs.Lines {
				if strings.Contains(line.Message, "redeven-smoke-ready") {
					return
				}
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("%s logs for %s did not contain smoke marker before deadline; last error=%v", engine, containerID, err)
		}
		time.Sleep(250 * time.Millisecond)
	}
}

func waitForFollowSmokeLog(t *testing.T, ctx context.Context, client *CLIClient, engine Engine, containerID string) {
	t.Helper()

	streamCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	lines := make(chan LogLine, 8)
	errCh := make(chan error, 1)
	go func() {
		errCh <- client.FollowLogs(streamCtx, EngineLogsRequest{
			Engine:      engine,
			ContainerID: containerID,
			TailLines:   20,
			Follow:      true,
		}, NewLogLineChannelSink(lines))
	}()

	for {
		select {
		case line := <-lines:
			if !strings.Contains(line.Message, "redeven-smoke-ready") {
				continue
			}
			cancel()
			if err := waitForFollowLogsExit(errCh); err != nil {
				t.Fatalf("%s follow logs for %s did not stop cleanly after marker: %v", engine, containerID, err)
			}
			return
		case err := <-errCh:
			if err == nil {
				t.Fatalf("%s follow logs for %s ended before smoke marker", engine, containerID)
			}
			t.Fatalf("%s follow logs for %s error before smoke marker: %v", engine, containerID, err)
		case <-streamCtx.Done():
			cancel()
			err := waitForFollowLogsExit(errCh)
			if err == nil {
				err = streamCtx.Err()
			}
			t.Fatalf("%s follow logs for %s did not contain smoke marker before deadline; last error=%v", engine, containerID, err)
		}
	}
}

func waitForFollowLogsExit(errCh <-chan error) error {
	select {
	case err := <-errCh:
		if err == nil || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return nil
		}
		return err
	case <-time.After(5 * time.Second):
		return errors.New("follow logs did not exit after cancel")
	}
}

func smokeEnginesFromEnv() []Engine {
	raw := strings.TrimSpace(os.Getenv(containersEngineSmokeEngines))
	if raw == "" {
		return []Engine{EngineDocker, EnginePodman}
	}
	parts := strings.Split(raw, ",")
	out := make([]Engine, 0, len(parts))
	for _, part := range parts {
		engine := Engine(strings.TrimSpace(part))
		if engine.Valid() {
			out = append(out, engine)
		}
	}
	return out
}

func runEngineCommand(ctx context.Context, engine Engine, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, string(engine), args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		detail := strings.TrimSpace(stderr.String())
		if detail != "" {
			return nil, fmt.Errorf("%s %s: %w: %s", engine, strings.Join(args, " "), err, detail)
		}
		return nil, fmt.Errorf("%s %s: %w", engine, strings.Join(args, " "), err)
	}
	return out, nil
}
