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
				ID:                "situation",
				Header:            "Situation",
				Question:          "Choose the closest situation.",
				ResponseMode:      requestUserInputResponseModeSelectText,
				ChoicesExhaustive: testBoolPtr(false),
				WriteLabel:        "None of the above",
				WritePlaceholder:  "Describe your current situation",
				Choices: []RequestUserInputChoice{
					{ChoiceID: "working", Label: "Already working", Kind: requestUserInputChoiceKindSelect},
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
				Text: "Working and studying part time",
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
	if len(prompt.Questions) != 1 || len(prompt.Questions[0].Choices) != 1 {
		t.Fatalf("prompt questions=%+v", prompt.Questions)
	}
	if got := prompt.Questions[0].ResponseMode; got != requestUserInputResponseModeSelectText {
		t.Fatalf("response_mode=%q, want %q", got, requestUserInputResponseModeSelectText)
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
	if got := normalized.Answers["direction"].ChoiceID; got != "" {
		t.Fatalf("choice_id=%q, want empty custom-answer path", got)
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
	if len(prompt.Questions) != 1 {
		t.Fatalf("prompt questions=%+v", prompt.Questions)
	}
	if got := prompt.Questions[0].ResponseMode; got != requestUserInputResponseModeWrite {
		t.Fatalf("response_mode=%q, want %q", got, requestUserInputResponseModeWrite)
	}
	if got := prompt.Questions[0].WritePlaceholder; got != "Describe the custom path" {
		t.Fatalf("write placeholder=%q, want %q", got, "Describe the custom path")
	}
}

func TestParseRequestUserInputPromptJSON_DefaultsResponseModeFromChoiceKinds(t *testing.T) {
	t.Parallel()

	pureSelect := parseRequestUserInputPromptJSON(`{
		"prompt_id":"rui_msg_select_tool_select",
		"message_id":"msg_select",
		"tool_id":"tool_select",
		"questions":[{
			"id":"direction",
			"header":"Direction",
			"question":"Choose the next direction.",
			"is_secret":false,
			"choices":[
				{"choice_id":"a","label":"Option A","kind":"select"},
				{"choice_id":"b","label":"Option B","kind":"select"}
			]
		}]
	}`)
	if pureSelect == nil || len(pureSelect.Questions) != 1 {
		t.Fatalf("pureSelect prompt=%+v", pureSelect)
	}
	if pureSelect.Questions[0].ResponseMode != requestUserInputResponseModeSelect {
		t.Fatalf("pure select prompt should default to response_mode=select: %+v", pureSelect.Questions[0])
	}
	if pureSelect.Questions[0].ChoicesExhaustive == nil || !*pureSelect.Questions[0].ChoicesExhaustive {
		t.Fatalf("pure select prompt should infer choices_exhaustive=true: %+v", pureSelect.Questions[0])
	}

	withWrite := parseRequestUserInputPromptJSON(`{
		"prompt_id":"rui_msg_write_tool_write",
		"message_id":"msg_write",
		"tool_id":"tool_write",
		"questions":[{
			"id":"direction",
			"header":"Direction",
			"question":"Choose the next direction.",
			"is_secret":false,
			"choices":[
				{"choice_id":"default","label":"Default path","kind":"select"},
				{"choice_id":"other","label":"Other","kind":"write","input_placeholder":"Describe the custom path"}
			]
		}]
	}`)
	if withWrite == nil || len(withWrite.Questions) != 1 {
		t.Fatalf("withWrite prompt=%+v", withWrite)
	}
	if withWrite.Questions[0].ResponseMode != requestUserInputResponseModeSelectText {
		t.Fatalf("write-choice prompt should default to response_mode=select_or_write: %+v", withWrite.Questions[0])
	}
	if withWrite.Questions[0].ChoicesExhaustive == nil || *withWrite.Questions[0].ChoicesExhaustive {
		t.Fatalf("write-choice prompt should infer choices_exhaustive=false: %+v", withWrite.Questions[0])
	}
	if len(withWrite.Questions[0].Choices) != 1 {
		t.Fatalf("canonical mixed prompt should keep only fixed choices: %+v", withWrite.Questions[0].Choices)
	}
}

func TestParseRequestUserInputPromptJSON_ChoicesExhaustiveIsAuthoritative(t *testing.T) {
	t.Parallel()

	prompt := parseRequestUserInputPromptJSON(`{
		"prompt_id":"rui_msg_non_exhaustive_tool_non_exhaustive",
		"message_id":"msg_non_exhaustive",
		"tool_id":"tool_non_exhaustive",
		"questions":[{
			"id":"direction",
			"header":"Direction",
			"question":"Choose the closest direction.",
			"is_secret":false,
			"response_mode":"select",
			"choices_exhaustive":false,
			"choices":[
				{"choice_id":"a","label":"Option A","kind":"select"},
				{"choice_id":"b","label":"Option B","kind":"select"}
			]
		}]
	}`)
	if prompt == nil || len(prompt.Questions) != 1 {
		t.Fatalf("prompt=%+v", prompt)
	}
	question := prompt.Questions[0]
	if got := question.ResponseMode; got != requestUserInputResponseModeSelectText {
		t.Fatalf("response_mode=%q, want %q", got, requestUserInputResponseModeSelectText)
	}
	if question.ChoicesExhaustive == nil || *question.ChoicesExhaustive {
		t.Fatalf("choices_exhaustive=%v, want false", question.ChoicesExhaustive)
	}
	if question.WriteLabel == "" {
		t.Fatalf("expected write_label for non-exhaustive fixed choices: %+v", question)
	}
}

func TestParseRequestUserInputPromptJSON_PreservesInteractionContract(t *testing.T) {
	t.Parallel()

	prompt := parseRequestUserInputPromptJSON(`{
		"prompt_id":"rui_msg_contract_tool_contract",
		"message_id":"msg_contract",
		"tool_id":"tool_contract",
		"reason_code":"user_decision_required",
		"interaction_contract":{
			"enabled":true,
			"reason":"guided_option_interaction",
			"single_question_per_turn":true,
			"fixed_choices_required":true,
			"open_text_fallback_required":true,
			"indirect_questions_only":true,
			"confidence":0.93,
			"source":"model"
		},
		"questions":[{
			"id":"direction",
			"header":"Direction",
			"question":"Choose the closest direction.",
			"is_secret":false,
			"response_mode":"select_or_write",
			"choices_exhaustive":false,
			"choices":[
				{"choice_id":"a","label":"Option A","kind":"select"},
				{"choice_id":"b","label":"Option B","kind":"select"}
			]
		}]
	}`)
	if prompt == nil {
		t.Fatalf("prompt should not be nil")
	}
	if !prompt.InteractionContract.Enabled {
		t.Fatalf("interaction contract should be enabled: %+v", prompt.InteractionContract)
	}
	if !prompt.InteractionContract.OpenTextFallbackRequired {
		t.Fatalf("open_text_fallback_required=false, want true: %+v", prompt.InteractionContract)
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
				ID:           "situation",
				Header:       "Situation",
				Question:     "Choose the closest situation.",
				ResponseMode: requestUserInputResponseModeWrite,
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
				Text: "Working and studying part time",
			},
		},
	}, "msg_user_1")
	if err != nil {
		t.Fatalf("buildRequestUserInputResponseRecord: %v", err)
	}
	if len(record.Responses) != 1 {
		t.Fatalf("len(record.Responses)=%d, want 1", len(record.Responses))
	}
	if got := record.Responses[0].PublicSummary; got != "Situation: Working and studying part time." {
		t.Fatalf("response public_summary=%q, want %q", got, "Situation: Working and studying part time.")
	}
	if got := record.PublicSummary; got != "Situation: Working and studying part time." {
		t.Fatalf("record public_summary=%q, want %q", got, "Situation: Working and studying part time.")
	}
}
