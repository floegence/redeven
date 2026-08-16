package agent

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"
)

func TestStartControlChannelWaitsForPreviousOwner(t *testing.T) {
	previousDone := make(chan struct{})
	previousCanceled := make(chan struct{})
	a := &Agent{
		log: slog.New(slog.NewTextHandler(io.Discard, nil)),
		controlCancel: func() {
			close(previousCanceled)
		},
		controlLoopDone: previousDone,
	}

	started := make(chan struct{})
	go func() {
		a.startControlChannel(context.Background())
		close(started)
	}()

	select {
	case <-previousCanceled:
	case <-time.After(time.Second):
		t.Fatal("previous control owner was not canceled")
	}
	select {
	case <-started:
		t.Fatal("replacement control owner started before the previous owner exited")
	case <-time.After(25 * time.Millisecond):
	}

	close(previousDone)
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("replacement control owner did not start after the previous owner exited")
	}
	a.stopControlChannel()
}
