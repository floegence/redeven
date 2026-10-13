package ai

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestProviderInventoryPaginationAuthenticationAndFailure(t *testing.T) {
	for _, kind := range []string{"openai", "anthropic", "google"} {
		t.Run(kind, func(t *testing.T) {
			fail := false
			pages := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				pages++
				switch kind {
				case "anthropic":
					if r.Header.Get("x-api-key") != "secret" || r.Header.Get("anthropic-version") == "" {
						t.Error("missing Anthropic authentication")
					}
				case "google":
					if r.Header.Get("x-goog-api-key") != "secret" {
						t.Error("missing Google authentication")
					}
				default:
					if r.Header.Get("Authorization") != "Bearer secret" {
						t.Error("missing bearer authentication")
					}
				}
				next := r.URL.RawQuery != ""
				if fail && next {
					w.WriteHeader(429)
					return
				}
				var body string
				if kind == "google" {
					if next {
						body = `{"models":[{"name":"models/new-model","inputTokenLimit":32768,"outputTokenLimit":4096,"supportedGenerationMethods":["generateContent"]}]}`
					} else {
						body = `{"models":[{"name":"models/embedding","supportedGenerationMethods":["embedContent"]}],"nextPageToken":"next"}`
					}
				} else if next {
					body = `{"data":[{"id":"new-model"}],"has_more":false}`
				} else {
					body = `{"data":[{"id":"first-model"}],"has_more":true,"last_id":"first-model"}`
				}
				_, _ = w.Write([]byte(body))
			}))
			defer server.Close()
			in := ModelCatalogRequest{Type: kind, BaseURL: server.URL, APIKey: "secret"}
			models, err := discoverProviderInventory(t.Context(), in, server.Client())
			if err != nil || pages != 2 || len(models) == 0 || models[len(models)-1].Status != "needs_configuration" {
				t.Fatalf("complete inventory: %+v %v pages=%d", models, err, pages)
			}
			fail = true
			if models, err = discoverProviderInventory(t.Context(), in, server.Client()); err == nil || models != nil {
				t.Fatal("partial inventory was accepted")
			}
		})
	}
}

func TestProviderInventoryRejectsIncompleteAndAcceptsEmpty(t *testing.T) {
	for _, body := range []string{`{}`, `{"data":null}`, `{"data":[{"id":"a"},{"id":"a"}]}`, `{"data":[],"has_more":true}`, `{"data":[]}`} {
		t.Run(body, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(body)) }))
			defer server.Close()
			models, err := discoverProviderInventory(t.Context(), ModelCatalogRequest{Type: "openai", BaseURL: server.URL}, server.Client())
			if body == `{"data":[]}` {
				if err != nil || models == nil || len(models) != 0 {
					t.Fatalf("empty success: %+v %v", models, err)
				}
			} else if err == nil {
				t.Fatal("invalid inventory was accepted")
			}
		})
	}
}
