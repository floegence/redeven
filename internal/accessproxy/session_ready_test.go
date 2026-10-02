package accessproxy

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type observedWaitContext struct {
	context.Context
	entered chan struct{}
	once    sync.Once
}

func (c *observedWaitContext) Done() <-chan struct{} {
	c.once.Do(func() { close(c.entered) })
	return c.Context.Done()
}

func TestSessionReadyWaitsForActivationAndHonorsCancellation(t *testing.T) {
	for _, outcome := range []string{"activated", "rejected", "canceled"} {
		t.Run(outcome, func(t *testing.T) {
			var active, called atomic.Bool
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called.Store(true)
				if !active.Load() {
					w.WriteHeader(http.StatusForbidden)
					return
				}
				w.WriteHeader(http.StatusNoContent)
			}))
			defer upstream.Close()
			ready := make(chan struct{})
			proxy, err := New(Options{Upstream: upstream.URL, SessionReady: ready})
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			observed := &observedWaitContext{Context: ctx, entered: make(chan struct{})}
			request := httptest.NewRequest(http.MethodGet, "/state", nil).WithContext(observed)
			response := httptest.NewRecorder()
			done := make(chan struct{})
			go func() { defer close(done); proxy.serveHTTP(response, request) }()
			select {
			case <-observed.entered:
			case <-ctx.Done():
				t.Fatal("request did not enter the activation barrier")
			}
			if called.Load() {
				t.Fatal("request reached upstream before activation settled")
			}
			if outcome == "canceled" {
				cancel()
			} else {
				active.Store(outcome == "activated")
				close(ready)
			}
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				t.Fatal("request remained blocked after activation or cancellation")
			}
			if outcome == "canceled" {
				if called.Load() {
					t.Fatal("canceled request reached upstream")
				}
				return
			}
			want := http.StatusForbidden
			if outcome == "activated" {
				want = http.StatusNoContent
			}
			if !called.Load() || response.Code != want {
				t.Fatalf("activation bypassed downstream authority: called=%v status=%d want=%d", called.Load(), response.Code, want)
			}
		})
	}
}
