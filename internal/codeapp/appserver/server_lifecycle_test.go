package appserver

import (
	"context"
	"io"
	"log/slog"
	"sync"
	"testing"
)

func TestServerConcurrentShutdownAndRetiredContext(t *testing.T) {
	server := &Server{log: slog.New(slog.NewTextHandler(io.Discard, nil)), addr: "127.0.0.1:0"}
	for range 10 {
		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		if err := server.Start(ctx); err != nil {
			t.Fatal(err)
		}
		retired := server.srv
		var workers sync.WaitGroup
		for range 4 {
			workers.Go(func() {
				_ = server.URL()
				cancel()
				if err := server.Close(); err != nil {
					t.Error(err)
				}
			})
		}
		workers.Wait()
		if server.URL() != "" {
			t.Fatal("closed listener still advertised")
		}
		if err := server.Start(t.Context()); err != nil {
			t.Fatal(err)
		}
		url := server.URL()
		if err := server.closeServer(retired); err != nil {
			t.Fatal(err)
		}
		if url == "" || server.URL() != url {
			t.Fatal("retired context closed replacement listener")
		}
		if err := server.Close(); err != nil {
			t.Fatal(err)
		}
	}
}
