package ai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
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

func TestDeepSeekCredentialIdentityIsPrivateToOwner(t *testing.T) {
	first, second := &deepSeekImageFileOwners{}, &deepSeekImageFileOwners{}
	for _, owner := range []*deepSeekImageFileOwners{first, second} {
		if err := owner.configure(&deepSeekProvider{apiKey: "same-api-key"}, "provider"); err != nil {
			t.Fatal(err)
		}
	}
	if first.owners["provider"].scope == second.owners["provider"].scope {
		t.Fatal("credential fingerprints must not be comparable across owners")
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
		{Kind: "image_count", Stage: "prepare", Source: "provider", ActualImages: 17, LimitImages: 15},
		{Kind: "image_bytes", Stage: "prepare", Source: "provider", ActualBytes: 201, LimitBytes: 200},
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
		} else if c.Kind == "image_count" || c.Kind == "image_bytes" {
			var media *flprovider.MediaLimitError
			if !errors.As(normalized, &media) || errors.Is(normalized, flprovider.ErrContextOverflow) {
				t.Fatalf("lost independent media capacity: %v", normalized)
			}
			kind, _, _ := media.RequestCapacityLimit()
			if kind != c.Kind {
				t.Fatalf("kind=%s want=%s", kind, c.Kind)
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

func TestFlowerImageCapacityProjection(t *testing.T) {
	d := &observation.CompactionDecision{Capacity: &observation.CompactionCapacity{Kind: "image_count", Stage: "prepare", Source: "provider", ActualImages: 17, LimitImages: 15}}
	got := flowerCompactionDecision(d)
	if got.Capacity == nil || got.Capacity.ActualImages != 17 || got.Capacity.LimitImages != 15 || got.Capacity.ActualBytes != 0 {
		t.Fatal(got)
	}
}

func TestDesktopCapacityRejectsAmbiguousEvidence(t *testing.T) {
	advice := flprovider.RetryAdvice{Category: flprovider.RetryPermanent}
	message := newProviderFailure(providerFailureDiagnostic{Provider: "deepseek", Shape: "unknown"}, errors.New("fixture"), advice).Error()
	for _, c := range []*FlowerCompactionCapacity{
		{Kind: "request_bytes", Stage: "response", Source: "provider", ActualBytes: 10},
		{Kind: "request_bytes", Stage: "prepare", Source: "host_policy", ActualBytes: 1, LimitBytes: 2},
		{Kind: "request_bytes", Stage: "response", Source: "unknown"},
		{Kind: "image_count", Stage: "prepare", Source: "provider", ActualImages: 1, LimitImages: 2},
		{Kind: "image_count", Stage: "prepare", Source: "provider", ActualImages: 3, LimitImages: 2, ActualBytes: 99},
		{Kind: "image_bytes", Stage: "prepare", Source: "provider", ActualBytes: 3, LimitBytes: 2, ActualImages: 99},
	} {
		if validateDesktopModelSourceRPCError(&DesktopModelSourceRPCError{Code: "FAILED", Message: message, RetryAdvice: &advice, Capacity: c}, true) == nil {
			t.Fatal("invalid evidence accepted")
		}
	}
}

func TestDeepSeekFilesLargeImageCountBoundary(t *testing.T) {
	var original bytes.Buffer
	pixels := image.NewRGBA(image.Rect(0, 0, 5120, 2880))
	for y := 0; y < 2880; y++ {
		for x := 0; x < 5120; x++ {
			pixels.SetRGBA(x, y, color.RGBA{uint8(x), uint8(y), 128, 255})
		}
	}
	if err := png.Encode(&original, pixels); err != nil {
		t.Fatal(err)
	}
	source := ContentPart{Type: "image", MimeType: "image/png", FileURI: "data:image/png;base64," + base64.StdEncoding.EncodeToString(original.Bytes())}
	optimized, _, err := prepareModelImage(t.Context(), source)
	if err != nil {
		t.Fatal(err)
	}
	expected, _ := modelImageBytes(optimized)
	uploads, requests, wantCount := 0, 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/files" {
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Error(err)
				return
			}
			defer r.MultipartForm.RemoveAll()
			file, _, err := r.FormFile("file")
			if err != nil {
				t.Error(err)
				return
			}
			defer file.Close()
			body, _ := io.ReadAll(file)
			cfg, _, err := image.DecodeConfig(bytes.NewReader(body))
			if err != nil || cfg.Width != 2560 || cfg.Height != 1440 || !bytes.Equal(body, expected) {
				t.Error("upload escaped policy", err, cfg)
			}
			uploads++
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "file-optimized", "bytes": len(body), "expires_at": time.Now().Add(time.Hour).Unix()})
			return
		}
		body, _ := io.ReadAll(r.Body)
		if bytes.Count(body, []byte("\"file_id\"")) != wantCount || bytes.Contains(body, []byte("base64")) {
			t.Error("attachments lost at count boundary", wantCount)
		}
		requests++
		fmt.Fprint(w, "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"incident\",\"status\":\"completed\",\"output\":[]}}\n\n")
	}))
	defer server.Close()
	files, err := flprovider.NewDeepSeekImageFiles(flprovider.DeepSeekImageFilesOptions{BaseURL: server.URL, APIKey: "fixture", Expiration: time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	p := &deepSeekProvider{baseURL: server.URL, apiKey: "fixture", imageFiles: files}
	for _, n := range []int{14, 15, 17} {
		wantCount = n
		parts := make([]ContentPart, n)
		for i := range parts {
			parts[i] = optimized
		}
		parts[0] = source
		prepared, err := p.prepareTurn(t.Context(), ModelGatewayRequest{Model: "deepseek-flash", Messages: []Message{{Role: "user", Content: parts}}})
		if err != nil {
			t.Fatalf("count %d: %v", n, err)
		}
		_, err = prepared.StreamTurn(t.Context(), nil)
		prepared.Close()
		if err != nil {
			t.Fatal(err)
		}
	}
	if uploads != 1 || requests != 3 {
		t.Fatal("unstable derived content or dispatch", uploads, requests)
	}
	if source.FileURI != "data:image/png;base64,"+base64.StdEncoding.EncodeToString(original.Bytes()) {
		t.Fatal("source mutated")
	}
}
