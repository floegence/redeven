package ai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/v7/observation"
	flprovider "github.com/floegence/floret/v7/provider"
)

func TestDeepSeekFilesOwnersScopeAndRouting(t *testing.T) {
	owners := &deepSeekImageFileOwners{}
	newAdapter := func(key string) *deepSeekProvider {
		return &deepSeekProvider{baseURL: "https://api.deepseek.com", apiKey: key}
	}
	first, next := newAdapter("one"), newAdapter("one")
	if err := owners.configure(first, "provider"); err != nil {
		t.Fatal(err)
	}
	if err := owners.configure(next, "provider"); err != nil {
		t.Fatal(err)
	}
	if first.imageFiles == nil || first.imageFiles != next.imageFiles {
		t.Fatal("new gateway discarded upload owner")
	}
	rotated := newAdapter("two")
	_ = owners.configure(rotated, "provider")
	if rotated.imageFiles == first.imageFiles {
		t.Fatal("credential rotation reused old owner")
	}
	other := newAdapter("one")
	_ = owners.configure(other, "other")
	if other.imageFiles == first.imageFiles {
		t.Fatal("provider identities shared cache")
	}
	for _, base := range []string{"https://proxy.example/v1", "https://api.deepseek.com.evil", "http://api.deepseek.com", "https://api.deepseek.com/anthropic", "https://api.deepseek.com?key=secret"} {
		p := &deepSeekProvider{baseURL: base, apiKey: "one"}
		if err := owners.configure(p, "custom"); err != nil || p.imageFiles != nil {
			t.Fatalf("implicit files on custom endpoint %s", base)
		}
	}
	blank := &deepSeekProvider{apiKey: "one"}
	if err := owners.configure(blank, "blank"); err != nil || blank.baseURL != "" || blank.imageFiles == nil {
		t.Fatal("enabling files changed opaque history compatibility identity")
	}

	service := &Service{}
	if service.deepSeekFiles() != service.deepSeekFiles() {
		t.Fatal("service owner not stable")
	}
	executor := &desktopModelSourceExecutor{}
	if executor.deepSeekFiles() != executor.deepSeekFiles() {
		t.Fatal("desktop owner not stable")
	}
	if service.deepSeekFiles() == executor.deepSeekFiles() {
		t.Fatal("transport owners crossed hosts")
	}
}

func TestDeepSeekFilesAdapterPreservesImagesAcrossPreparations(t *testing.T) {
	uploads, requests := 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/files" {
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Error(err)
				return
			}
			defer r.MultipartForm.RemoveAll()
			f, _, err := r.FormFile("file")
			if err != nil {
				t.Error(err)
				return
			}
			defer f.Close()
			data, _ := io.ReadAll(f)
			uploads++
			_ = json.NewEncoder(w).Encode(map[string]any{"id": fmt.Sprintf("file-%d", uploads), "bytes": len(data), "expires_at": time.Now().Add(time.Hour).Unix()})
			return
		}
		requests++
		data, _ := io.ReadAll(r.Body)
		if bytes.Contains(data, []byte("base64")) || bytes.Count(data, []byte(`"file_id"`)) != 23 {
			t.Error("image references lost or inline bytes retained")
		}
		fmt.Fprint(w, "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"r\",\"status\":\"completed\",\"output\":[]}}\n\n")
	}))
	defer server.Close()
	files, err := flprovider.NewDeepSeekImageFiles(flprovider.DeepSeekImageFilesOptions{BaseURL: server.URL, APIKey: "test", Expiration: time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	var b bytes.Buffer
	_ = png.Encode(&b, image.NewGray(image.Rect(0, 0, 8, 8)))
	parts := []ContentPart{{Type: "text", Text: "inspect all images"}}
	for range 23 {
		parts = append(parts, ContentPart{Type: "image", MimeType: "image/png", FileURI: "data:image/png;base64," + base64.StdEncoding.EncodeToString(b.Bytes())})
	}
	req := ModelGatewayRequest{Model: "deepseek-flash", Messages: []Message{{Role: "user", Content: parts}}}
	for range 2 {
		p := &deepSeekProvider{baseURL: server.URL, apiKey: "test", imageFiles: files}
		prepared, err := p.prepareTurn(t.Context(), req)
		if err != nil {
			t.Fatal(err)
		}
		estimate := prepared.TokenEstimate().EstimatedInputTokens
		if estimate < 23*1024 {
			t.Fatal("visual tokens omitted")
		}
		result, err := prepared.StreamTurn(t.Context(), nil)
		prepared.Close()
		if err != nil {
			t.Fatal(err)
		}
		req.PreviousState = result.ProviderState
	}
	if uploads != 1 || requests != 2 {
		t.Fatalf("uploads=%d requests=%d", uploads, requests)
	}
	raw, _ := json.Marshal(req.PreviousState)
	if strings.Contains(string(raw), "file_id") {
		t.Fatal("file id persisted")
	}
}

func TestDesktopModelSourceCapacityEvidenceRoundTrip(t *testing.T) {
	for _, c := range []*FlowerCompactionCapacity{
		{Kind: "request_bytes", Stage: "prepare", Source: "host_policy", ActualBytes: 101, LimitBytes: 100},
		{Kind: "request_bytes", Stage: "response", Source: "provider"}, nil,
	} {
		advice := flprovider.RetryAdvice{Category: flprovider.RetryPermanent}
		cause := newProviderFailure(providerFailureDiagnostic{Provider: "deepseek", Shape: "unknown"}, errors.New("fixture"), advice)
		source, cleanup := startTestDesktopModelSource(t, func(frame DesktopModelSourceRPCFrame) DesktopModelSourceRPCFrame {
			if frame.Method != "ai.turn.stream" {
				return DesktopModelSourceRPCFrame{Type: "error", ID: frame.ID, Error: &DesktopModelSourceRPCError{Code: "UNSUPPORTED", Message: "fixture"}}
			}
			return DesktopModelSourceRPCFrame{Type: "error", ID: frame.ID, Error: &DesktopModelSourceRPCError{Code: "TURN_STREAM_FAILED", Message: cause.Error(), RetryAdvice: &advice, Capacity: c, Reprepare: c == nil}}
		})
		_, err := source.StreamTurn(context.Background(), ModelGatewayRequest{Model: "desktop:model_test"}, nil)
		normalized := providerTransportFailure(err, DesktopModelSourceProviderType)
		if c == nil {
			var refresh *flprovider.RequestPreparationError
			if !errors.As(normalized, &refresh) {
				t.Fatalf("capacity=%+v raw=%T %v normalized=%T %v", c, err, err, normalized, normalized)
			}
		} else {
			if !errors.Is(normalized, flprovider.ErrContextOverflow) {
				t.Fatalf("capacity=%+v raw=%T %v normalized=%T %v", c, err, err, normalized, normalized)
			}
			if c.Source == "host_policy" {
				var limit *flprovider.RequestByteLimitError
				if !errors.As(normalized, &limit) || limit.ActualBytes != 101 {
					t.Fatalf("capacity=%+v raw=%T %v normalized=%T %v", c, err, err, normalized, normalized)
				}
			}
		}
		cleanup()
	}
}

func TestFlowerCompactionCapacityProjection(t *testing.T) {
	d := &observation.CompactionDecision{Capacity: &observation.CompactionCapacity{Kind: "request_bytes", Stage: "prepare", Source: "host_policy", ActualBytes: 101, LimitBytes: 100}}
	got := flowerCompactionDecision(d)
	if got.Capacity == nil || got.Capacity.ActualBytes != 101 || got.Before != nil {
		t.Fatal(got)
	}
	d.Capacity.ActualBytes = 999
	if got.Capacity.ActualBytes != 101 {
		t.Fatal("projection aliases mutable observation")
	}
}

func TestDesktopCapacityRejectsAmbiguousEvidence(t *testing.T) {
	advice := flprovider.RetryAdvice{Category: flprovider.RetryPermanent}
	message := newProviderFailure(providerFailureDiagnostic{Provider: "deepseek", Shape: "unknown"}, errors.New("fixture"), advice).Error()
	for _, c := range []*FlowerCompactionCapacity{
		{Kind: "request_bytes", Stage: "response", Source: "provider", ActualBytes: 10},
		{Kind: "request_bytes", Stage: "prepare", Source: "host_policy", ActualBytes: 1, LimitBytes: 2},
		{Kind: "request_bytes", Stage: "response", Source: "unknown"},
	} {
		if validateDesktopModelSourceRPCError(&DesktopModelSourceRPCError{Code: "FAILED", Message: message, RetryAdvice: &advice, Capacity: c}, true) == nil {
			t.Fatal("invalid evidence accepted")
		}
	}
}
