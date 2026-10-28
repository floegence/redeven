package localui

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
)

// The model is deterministic; Center, Gateway, Runtime, Floret and browser
// recovery use their production contracts. No credentials or paid inference.
type centerFlowerRecoveryFixture struct {
	requests atomic.Int64
	titles   atomic.Int64
	chunks   atomic.Int64
	canceled atomic.Int64
	release  chan struct{}
	once     sync.Once
}

func newCenterFlowerRecoveryFixture(t *testing.T) (*centerFlowerRecoveryFixture, *config.AIConfig) {
	t.Helper()
	f := &centerFlowerRecoveryFixture{release: make(chan struct{})}
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 2<<20))
		var request struct {
			Model  string `json:"model"`
			Stream bool   `json:"stream"`
		}
		if r.Method != http.MethodPost || r.URL.Path != "/v1/chat/completions" || err != nil || json.Unmarshal(body, &request) != nil || request.Model != "test" || !request.Stream {
			http.Error(w, "unexpected recovery provider request", http.StatusBadRequest)
			return
		}
		// First-turn title generation is a separate published Floret request.
		if bytes.Contains(body, []byte("You generate concise thread titles")) {
			f.titles.Add(1)
			w.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Center Flower recovery\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
			w.(http.Flusher).Flush()
			return
		}
		if f.requests.Add(1) != 1 {
			http.Error(w, "recovery must not resubmit inference", http.StatusConflict)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		chunk := func(content string, finish any) bool {
			raw, _ := json.Marshal(map[string]any{"id": "center-recovery", "object": "chat.completion.chunk", "model": "test", "choices": []any{map[string]any{"index": 0, "delta": map[string]any{"content": content}, "finish_reason": finish}}})
			if _, err := fmt.Fprintf(w, "data: %s\n\n", raw); err != nil {
				f.canceled.Add(1)
				return false
			}
			w.(http.Flusher).Flush()
			f.chunks.Add(1)
			return true
		}
		if !chunk("CENTER_FLOWER_RECOVERY_START ", nil) {
			return
		}
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		deadline := time.NewTimer(90 * time.Second)
		defer deadline.Stop()
		for {
			select {
			case <-r.Context().Done():
				f.canceled.Add(1)
				return
			case <-deadline.C:
				f.canceled.Add(1)
				return
			case <-ticker.C:
				if !chunk("tick ", nil) {
					return
				}
			case <-f.release:
				if chunk("CENTER_FLOWER_RECOVERY_COMPLETE", "stop") {
					fmt.Fprint(w, "data: [DONE]\n\n")
					w.(http.Flusher).Flush()
				}
				return
			}
		}
	}))
	t.Cleanup(endpoint.Close)
	t.Cleanup(func() { f.once.Do(func() { close(f.release) }) })
	tools := true
	return f, &config.AIConfig{CurrentModelID: "recovery-fixture/test", Providers: []config.AIProvider{{
		ID: "recovery-fixture", Type: "openai_compatible", BaseURL: endpoint.URL + "/v1",
		Models: []config.AIProviderModel{{ModelName: "test", ContextWindow: 32768, MaxOutputTokens: 2048, SupportsTools: &tools, InputModalities: []string{"text"}}},
	}}}
}

func (f *centerFlowerRecoveryFixture) serveControl(w http.ResponseWriter, r *http.Request) bool {
	if r.URL.Path != "/flower-recovery" {
		return false
	}
	if r.Method == http.MethodPost {
		f.once.Do(func() { close(f.release) })
	} else if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return true
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]int64{"requests": f.requests.Load(), "titles": f.titles.Load(), "chunks": f.chunks.Load(), "canceled": f.canceled.Load()})
	return true
}
