package ai

import (
	"errors"
	"testing"
)

func TestValidateRequestUserInputResponse_RequiresSelectedOptionDetailWhenConfigured(t *testing.T) {
	t.Parallel()

	prompt := testRequestUserInputPrompt(
		"msg_detail_required",
		"tool_detail_required",
		AskUserReasonUserDecisionRequired,
		[]RequestUserInputQuestion{
			{
				ID:       "situation",
				Header:   "Situation",
				Question: "Choose the closest situation.",
				IsOther:  false,
				IsSecret: false,
				Options: []RequestUserInputOption{
					{OptionID: "working", Label: "Already working"},
					{
						OptionID:               "other",
						Label:                  "Other",
						DetailInputMode:        requestUserInputDetailInputRequired,
						DetailInputPlaceholder: "Describe your current situation",
					},
				},
			},
		},
	)
	if prompt == nil {
		t.Fatalf("prompt should not be nil")
	}

	_, err := validateRequestUserInputResponse(prompt, &RequestUserInputResponse{
		PromptID: prompt.PromptID,
		Answers: map[string]RequestUserInputAnswer{
			"situation": {
				SelectedOptionID: "other",
			},
		},
	})
	if !errors.Is(err, ErrWaitingPromptChanged) {
		t.Fatalf("validateRequestUserInputResponse err=%v, want %v", err, ErrWaitingPromptChanged)
	}

	_, err = validateRequestUserInputResponse(prompt, &RequestUserInputResponse{
		PromptID: prompt.PromptID,
		Answers: map[string]RequestUserInputAnswer{
			"situation": {
				SelectedOptionID: "other",
				Answers:          []string{"Working and studying part time"},
			},
		},
	})
	if err != nil {
		t.Fatalf("validateRequestUserInputResponse with required detail: %v", err)
	}
}

func TestValidateRequestUserInputResponse_AllowsOptionalSelectedOptionDetailToBeOmitted(t *testing.T) {
	t.Parallel()

	prompt := testRequestUserInputPrompt(
		"msg_detail_optional",
		"tool_detail_optional",
		AskUserReasonUserDecisionRequired,
		[]RequestUserInputQuestion{
			{
				ID:       "direction",
				Header:   "Direction",
				Question: "Choose the next direction.",
				IsOther:  false,
				IsSecret: false,
				Options: []RequestUserInputOption{
					{
						OptionID:        "other",
						Label:           "Other",
						DetailInputMode: requestUserInputDetailInputOptional,
					},
				},
			},
		},
	)
	if prompt == nil {
		t.Fatalf("prompt should not be nil")
	}

	_, err := validateRequestUserInputResponse(prompt, &RequestUserInputResponse{
		PromptID: prompt.PromptID,
		Answers: map[string]RequestUserInputAnswer{
			"direction": {
				SelectedOptionID: "other",
			},
		},
	})
	if err != nil {
		t.Fatalf("validateRequestUserInputResponse with optional detail: %v", err)
	}
}

func TestBuildRequestUserInputResponseRecord_IncludesSelectedOptionDetailInSummary(t *testing.T) {
	t.Parallel()

	prompt := testRequestUserInputPrompt(
		"msg_detail_summary",
		"tool_detail_summary",
		AskUserReasonUserDecisionRequired,
		[]RequestUserInputQuestion{
			{
				ID:       "situation",
				Header:   "Situation",
				Question: "Choose the closest situation.",
				IsOther:  false,
				IsSecret: false,
				Options: []RequestUserInputOption{
					{
						OptionID:        "other",
						Label:           "Other",
						DetailInputMode: requestUserInputDetailInputRequired,
					},
				},
			},
		},
	)
	if prompt == nil {
		t.Fatalf("prompt should not be nil")
	}

	record, _, err := buildRequestUserInputResponseRecord(*prompt, RequestUserInputResponse{
		PromptID: prompt.PromptID,
		Answers: map[string]RequestUserInputAnswer{
			"situation": {
				SelectedOptionID: "other",
				Answers:          []string{"Working and studying part time"},
			},
		},
	}, "msg_user_1")
	if err != nil {
		t.Fatalf("buildRequestUserInputResponseRecord: %v", err)
	}
	if len(record.Responses) != 1 {
		t.Fatalf("len(record.Responses)=%d, want 1", len(record.Responses))
	}
	if got := record.Responses[0].PublicSummary; got != "Situation: Other; Working and studying part time." {
		t.Fatalf("response public_summary=%q, want %q", got, "Situation: Other; Working and studying part time.")
	}
	if got := record.PublicSummary; got != "Situation: Other; Working and studying part time." {
		t.Fatalf("record public_summary=%q, want %q", got, "Situation: Other; Working and studying part time.")
	}
}
