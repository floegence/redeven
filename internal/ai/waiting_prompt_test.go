package ai

import (
	"errors"
	"testing"
)

func TestValidateRequestUserInputResponse_RequiresWriteChoiceText(t *testing.T) {
	t.Parallel()

	prompt := testRequestUserInputPrompt(
		"msg_write_required",
		"tool_write_required",
		AskUserReasonUserDecisionRequired,
		[]RequestUserInputQuestion{
			{
				ID:       "situation",
				Header:   "Situation",
				Question: "Choose the closest situation.",
				Choices: []RequestUserInputChoice{
					{ChoiceID: "working", Label: "Already working", Kind: requestUserInputChoiceKindSelect},
					{
						ChoiceID:         "other",
						Label:            "Other",
						Kind:             requestUserInputChoiceKindWrite,
						InputPlaceholder: "Describe your current situation",
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
				ChoiceID: "other",
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
				ChoiceID: "other",
				Text:     "Working and studying part time",
			},
		},
	})
	if err != nil {
		t.Fatalf("validateRequestUserInputResponse with write choice text: %v", err)
	}
}

func TestValidateRequestUserInputResponse_LegacyOtherFallbackInfersWriteChoice(t *testing.T) {
	t.Parallel()

	prompt := parseRequestUserInputPromptJSON(`{
		"prompt_id":"rui_msg_legacy_other_tool_legacy_other",
		"message_id":"msg_legacy_other",
		"tool_id":"tool_legacy_other",
		"questions":[{
			"id":"direction",
			"header":"Direction",
			"question":"Choose the next direction.",
			"is_secret":false,
			"is_other":true,
			"options":[{"option_id":"default","label":"Default path"}]
		}]
	}`)
	if prompt == nil {
		t.Fatalf("prompt should not be nil")
	}
	if len(prompt.Questions) != 1 || len(prompt.Questions[0].Choices) != 2 {
		t.Fatalf("prompt questions=%+v", prompt.Questions)
	}
	if got := prompt.Questions[0].Choices[1].Kind; got != requestUserInputChoiceKindWrite {
		t.Fatalf("write choice kind=%q, want %q", got, requestUserInputChoiceKindWrite)
	}

	normalized, err := validateRequestUserInputResponse(prompt, &RequestUserInputResponse{
		PromptID: prompt.PromptID,
		Answers: map[string]RequestUserInputAnswer{
			"direction": {
				Text: "Need a custom direction",
			},
		},
	})
	if err != nil {
		t.Fatalf("validateRequestUserInputResponse legacy other fallback: %v", err)
	}
	if got := normalized.Answers["direction"].ChoiceID; got != "other" {
		t.Fatalf("choice_id=%q, want %q", got, "other")
	}
}

func TestParseRequestUserInputPromptJSON_NormalizesLegacyOptionDetailToWriteChoice(t *testing.T) {
	t.Parallel()

	prompt := parseRequestUserInputPromptJSON(`{
		"prompt_id":"rui_msg_legacy_optional_tool_legacy_optional",
		"message_id":"msg_legacy_optional",
		"tool_id":"tool_legacy_optional",
		"questions":[{
			"id":"direction",
			"header":"Direction",
			"question":"Choose the next direction.",
			"is_secret":false,
			"options":[{
				"option_id":"other",
				"label":"Other",
				"detail_input_mode":"optional",
				"detail_input_placeholder":"Describe the custom path"
			}]
		}]
	}`)
	if prompt == nil {
		t.Fatalf("prompt should not be nil")
	}
	if len(prompt.Questions) != 1 || len(prompt.Questions[0].Choices) != 1 {
		t.Fatalf("prompt questions=%+v", prompt.Questions)
	}
	if got := prompt.Questions[0].Choices[0].Kind; got != requestUserInputChoiceKindWrite {
		t.Fatalf("choice kind=%q, want %q", got, requestUserInputChoiceKindWrite)
	}
	if got := prompt.Questions[0].Choices[0].InputPlaceholder; got != "Describe the custom path" {
		t.Fatalf("input placeholder=%q, want %q", got, "Describe the custom path")
	}
}

func TestBuildRequestUserInputResponseRecord_IncludesWriteChoiceTextInSummary(t *testing.T) {
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
				Choices: []RequestUserInputChoice{
					{
						ChoiceID: "other",
						Label:    "Other",
						Kind:     requestUserInputChoiceKindWrite,
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
				ChoiceID: "other",
				Text:     "Working and studying part time",
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
