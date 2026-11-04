package containerengine

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestReadImagePullLinesDecodesTerminalRedraws(t *testing.T) {
	input := string(rune(27)) + "[2Kfirst: Downloading 1MB/2MB" + string(rune(13)) + string(rune(27)) + "[1Afirst: Download complete" + string(rune(13)) + string(rune(10)) + "Digest: " + testSHA256Digest
	var lines []string
	err := readImagePullLines(strings.NewReader(input), func(line []byte) error {
		lines = append(lines, string(line))
		return nil
	})
	if err != nil || len(lines) != 3 || lines[0] != "first: Downloading 1MB/2MB" || lines[1] != "first: Download complete" {
		t.Fatalf("lines=%q error=%v", lines, err)
	}
	want := errors.New("stop observing")
	if err := readImagePullLines(strings.NewReader(input), func([]byte) error { return want }); !errors.Is(err, want) {
		t.Fatalf("callback error=%v", err)
	}
}

func TestImagePullProgressKeepsStatusOutputWithoutMetricChanges(t *testing.T) {
	var observed []ImagePullProgress
	tracker := newImagePullProgressTracker(EngineDocker, func(_ context.Context, item ImagePullProgress) error {
		observed = append(observed, item)
		return nil
	})
	for _, line := range []string{"Resolving image", "Waiting for registry", "Waiting for registry"} {
		if err := tracker.consume(context.Background(), line); err != nil {
			t.Fatal(err)
		}
	}
	if len(observed) != 2 || observed[1].Output != "Waiting for registry" {
		t.Fatalf("status output lost or duplicated: %+v", observed)
	}
}

type startedImagePullRunner struct{ bufferedCalls int }

func (r *startedImagePullRunner) Run(context.Context, string, ...string) ([]byte, error) {
	r.bufferedCalls++
	return nil, nil
}
func (r *startedImagePullRunner) StreamImagePull(context.Context, string, []string, func([]byte) error) error {
	return ErrLogsFollowUnsupported
}

func TestImagePullNeverReplaysStartedStreamingCommand(t *testing.T) {
	runner := &startedImagePullRunner{}
	client := &CLIClient{Runner: runner}
	_, err := client.PullImageWithProgress(context.Background(), EngineDocker, "example.invalid/image:1", func(context.Context, ImagePullProgress) error { return nil })
	if !errors.Is(err, ErrLogsFollowUnsupported) || runner.bufferedCalls != 0 {
		t.Fatalf("started pull replayed: error=%v buffered_calls=%d", err, runner.bufferedCalls)
	}
}

func TestImagePullDeduplicatesUnchangedLayerRedraws(t *testing.T) {
	var lines []string
	tracker := newImagePullProgressTracker(EngineDocker, func(_ context.Context, item ImagePullProgress) error { lines = append(lines, item.Output); return nil })
	for _, line := range []string{"one: Downloading 1MB/2MB", "two: Downloading 1MB/3MB", "one: Downloading 1MB/2MB", "two: Downloading 1MB/3MB"} {
		if err := tracker.consume(context.Background(), line); err != nil {
			t.Fatal(err)
		}
	}
	if len(lines) != 2 {
		t.Fatalf("duplicate terminal redraws: %q", lines)
	}
}
