package ai

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/floegence/redeven-agent/internal/config"
)

func TestService_ListModels_DefaultFirstAndDedup(t *testing.T) {
	t.Parallel()

	svc := &Service{
		cfg: &config.AIConfig{
			Providers: []config.AIProvider{
				{
					ID:      "openai",
					Name:    "OpenAI",
					Type:    "openai",
					BaseURL: "https://api.openai.com/v1",
					Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini", IsDefault: true}, {ModelName: "gpt-4o-mini"}},
				},
				{
					ID:      "anthropic",
					Name:    "Anthropic",
					Type:    "anthropic",
					BaseURL: "https://api.anthropic.com",
					Models:  []config.AIProviderModel{{ModelName: "claude-sonnet-4-5"}},
				},
			},
		},
	}

	out, err := svc.ListModels()
	if err != nil {
		t.Fatalf("ListModels: %v", err)
	}
	if out == nil {
		t.Fatalf("ListModels returned nil")
	}

	if out.DefaultModel != "openai/gpt-5-mini" {
		t.Fatalf("DefaultModel=%q, want %q", out.DefaultModel, "openai/gpt-5-mini")
	}

	gotIDs := make([]string, 0, len(out.Models))
	for _, m := range out.Models {
		gotIDs = append(gotIDs, m.ID)
	}
	wantIDs := []string{"openai/gpt-5-mini", "openai/gpt-4o-mini", "anthropic/claude-sonnet-4-5"}
	if !reflect.DeepEqual(gotIDs, wantIDs) {
		t.Fatalf("model ids=%v, want %v", gotIDs, wantIDs)
	}

	if out.Models[0].Label != "OpenAI / gpt-5-mini" {
		t.Fatalf("default label=%q", out.Models[0].Label)
	}
	if out.Models[1].Label != "OpenAI / gpt-4o-mini" {
		t.Fatalf("second label=%q", out.Models[1].Label)
	}
	if out.Models[2].Label != "Anthropic / claude-sonnet-4-5" {
		t.Fatalf("third label=%q", out.Models[2].Label)
	}
}

func TestService_ListModels_ProviderNameFallbackDoesNotExposeProviderID(t *testing.T) {
	t.Parallel()

	svc := &Service{
		cfg: &config.AIConfig{
			Providers: []config.AIProvider{
				{
					ID:      "prov_26f7c2a6-db3d-4691-8dcf-3f179b08b252",
					Name:    "",
					Type:    "openai",
					BaseURL: "https://api.openai.com/v1",
					Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini", IsDefault: true}},
				},
			},
		},
	}

	out, err := svc.ListModels()
	if err != nil {
		t.Fatalf("ListModels: %v", err)
	}
	if out == nil || len(out.Models) == 0 {
		t.Fatalf("ListModels returned no models")
	}

	if got := out.Models[0].Label; got != "OpenAI / gpt-5-mini" {
		t.Fatalf("label=%q, want %q", got, "OpenAI / gpt-5-mini")
	}
	if strings.Contains(out.Models[0].Label, "prov_") {
		t.Fatalf("label should not contain provider id: %q", out.Models[0].Label)
	}
}

func TestDeriveThreadRunState(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name        string
		endReason   string
		finalReason string
		err         error
		wantState   string
		wantMsg     string
	}{
		{name: "task complete success", endReason: "complete", finalReason: "task_complete", err: nil, wantState: "success", wantMsg: ""},
		{name: "social reply success", endReason: "complete", finalReason: "social_reply", err: nil, wantState: "success", wantMsg: ""},
		{name: "creative reply success", endReason: "complete", finalReason: "creative_reply", err: nil, wantState: "success", wantMsg: ""},
		{name: "ask user waiting", endReason: "complete", finalReason: "ask_user_waiting_model", err: nil, wantState: "waiting_user", wantMsg: ""},
		{name: "implicit complete rejected", endReason: "complete", finalReason: "implicit_complete_backpressure", err: nil, wantState: "failed", wantMsg: "Run ended without explicit completion."},
		{name: "canceled", endReason: "canceled", finalReason: "", err: nil, wantState: "canceled", wantMsg: ""},
		{name: "timed out", endReason: "timed_out", finalReason: "", err: nil, wantState: "timed_out", wantMsg: "Timed out."},
		{name: "disconnected", endReason: "disconnected", finalReason: "", err: nil, wantState: "failed", wantMsg: "Disconnected."},
		{name: "explicit error", endReason: "error", finalReason: "", err: errors.New("boom"), wantState: "failed", wantMsg: "boom"},
		{name: "context canceled", endReason: "", finalReason: "", err: context.Canceled, wantState: "failed", wantMsg: "Disconnected."},
		{name: "context deadline", endReason: "", finalReason: "", err: context.DeadlineExceeded, wantState: "timed_out", wantMsg: "Timed out."},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			state, msg := deriveThreadRunState(tc.endReason, tc.finalReason, tc.err)
			if state != tc.wantState || msg != tc.wantMsg {
				t.Fatalf("deriveThreadRunState(%q, %q, %v)=(%q,%q), want (%q,%q)", tc.endReason, tc.finalReason, tc.err, state, msg, tc.wantState, tc.wantMsg)
			}
		})
	}
}
