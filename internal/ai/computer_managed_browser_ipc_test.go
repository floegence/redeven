package ai

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"testing"
	"time"
)

func TestManagedBrowserIPCFixture(t *testing.T) {
	if os.Getenv("REDEVEN_MANAGED_IPC_FIXTURE") != "1" {
		return
	}
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		var request struct{ ID string }
		if json.Unmarshal(scanner.Bytes(), &request) != nil {
			os.Exit(2)
		}
		if request.ID == "1" {
			time.Sleep(100 * time.Millisecond)
		}
		fmt.Printf("{\"id\":%q,\"tabs\":[{\"id\":%q}]}\n", request.ID, request.ID)
	}
	os.Exit(0)
}

func TestManagedBrowserRequestCancellationPreservesProcessAndResponseOrder(t *testing.T) {
	cmd := exec.Command(os.Args[0], "-test.run=^TestManagedBrowserIPCFixture$")
	cmd.Env = append(os.Environ(), "REDEVEN_MANAGED_IPC_FIXTURE=1")
	input, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	output, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	p := &managedBrowserProfile{cmd: cmd, input: input, reader: bufio.NewReader(output), done: make(chan struct{})}
	go func() { _ = cmd.Wait(); close(p.done) }()
	t.Cleanup(p.close)
	ctx, cancel := context.WithTimeout(t.Context(), 25*time.Millisecond)
	defer cancel()
	if _, err := p.call(ctx, "inventory"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("request result: %v", err)
	}
	if p.stopped() {
		t.Fatal("request cancellation retired the shared browser")
	}
	tabs, err := p.call(t.Context(), "inventory")
	if err != nil || len(tabs) != 1 || tabs[0].ID != "2" {
		t.Fatalf("late response was not isolated: %+v %v", tabs, err)
	}
	if p.stopped() {
		t.Fatal("late response retired the shared browser")
	}
}
