//go:build !windows

package containerengine

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestImagePullStreamUsesTerminalAndPreservesBothOutputs(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var lines []string
	err := (execRunner{}).StreamImagePull(ctx, "sh", []string{"-c", "test -t 1 && test -t 2 || exit 9; echo 'layer: Downloading 1MB/2MB'; echo 'registry status' >&2"}, func(line []byte) error {
		lines = append(lines, string(line))
		return nil
	})
	if err != nil || len(lines) != 2 || lines[1] != "registry status" {
		t.Fatalf("lines=%q error=%v", lines, err)
	}
}

func TestImagePullStreamCancelsWholeProcessAndDoesNotReplay(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	started := time.Now()
	var lines []string
	err := (execRunner{}).StreamImagePull(ctx, "sh", []string{"-c", "echo started; sleep 60 & wait"}, func(line []byte) error {
		lines = append(lines, string(line))
		return nil
	})
	if !errors.Is(err, context.DeadlineExceeded) || time.Since(started) > 3*time.Second || strings.Join(lines, "") != "started" {
		t.Fatalf("cancellation: %v output=%q elapsed=%s", err, lines, time.Since(started))
	}
}

func TestImagePullStreamClassifiesRegistryFailure(t *testing.T) {
	command := filepath.Join(t.TempDir(), "engine")
	if err := os.WriteFile(command, []byte("#!/bin/sh"+string(rune(10))+"i=0; while [ $i -lt 5000 ]; do echo 'layer: Downloading'; i=$((i+1)); done; echo 'manifest unknown' >&2; exit 1"), 0700); err != nil {
		t.Fatal(err)
	}
	err := (execRunner{}).StreamImagePull(context.Background(), command, []string{"pull", "example.invalid/image:1"}, func([]byte) error { return nil })
	if !errors.Is(err, ErrImageNotFound) {
		t.Fatalf("error=%v", err)
	}
}
