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

func TestParseRequestUserInputPromptJSON_RejectsLegacyOtherFallback(t *testing.T) {
	t.Parallel()

	prompt := parseRequestUserInputPromptJSON(`{
		"prompt_id":"rui_msg_legacy_other_tool_legacy_other",
		"message_id":"msg_legacy_other",
		"tool_id":"tool_legacy_other",
		"tool_name":"ask_user",
		"questions":[{
			"id":"direction",
			"header":"Direction",
			"question":"Choose the next direction.",
			"is_secret":false,
			"is_other":true,
			"options":[{"option_id":"default","label":"Default path"}]
		}]
	}`)
	if prompt != nil {
		t.Fatalf("legacy runtime prompt should be rejected: %+v", prompt)
	}
}

func TestRequestUserInputQuestionFromModelRecord_RejectsLegacyShape(t *testing.T) {
	t.Parallel()

	_, reason, ok := requestUserInputQuestionFromModelRecord(map[string]any{
		"id":        "direction",
		"header":    "Direction",
		"question":  "Choose the next direction.",
		"is_secret": false,
		"is_other":  true,
		"options": []any{
			map[string]any{"option_id": "default", "label": "Default path"},
		},
	})
	if ok {
		t.Fatalf("legacy model question unexpectedly accepted")
	}
	if reason != askUserGateReasonLegacyContractShape {
		t.Fatalf("reason=%q, want %q", reason, askUserGateReasonLegacyContractShape)
	}

	question, reason, ok := requestUserInputQuestionFromModelRecord(map[string]any{
		"id":                 "direction",
		"header":             "Direction",
		"question":           "Choose the next direction.",
		"is_secret":          false,
		"response_mode":      "select_or_write",
		"choices_exhaustive": false,
		"write_label":        "None of the above",
		"write_placeholder":  "Type another answer",
		"choices": []any{
			map[string]any{"choice_id": "default", "label": "Default path", "kind": "select"},
		},
	})
	if !ok || reason != "" {
		t.Fatalf("canonical model question ok=%v reason=%q question=%+v", ok, reason, question)
	}
	if question.ResponseMode != requestUserInputResponseModeSelectText {
		t.Fatalf("response_mode=%q, want %q", question.ResponseMode, requestUserInputResponseModeSelectText)
	}
}

func TestParseRequestUserInputPromptJSON_RejectsLegacyOptionDetail(t *testing.T) {
	t.Parallel()

	prompt := parseRequestUserInputPromptJSON(`{
		"prompt_id":"rui_msg_legacy_optional_tool_legacy_optional",
		"message_id":"msg_legacy_optional",
		"tool_id":"tool_legacy_optional",
		"tool_name":"ask_user",
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
	if prompt != nil {
		t.Fatalf("legacy option detail prompt should be rejected: %+v", prompt)
	}
}

func TestParseRequestUserInputPromptJSON_RejectsMissingResponseModeAndExhaustiveFlag(t *testing.T) {
	t.Parallel()

	pureSelect := parseRequestUserInputPromptJSON(`{
		"prompt_id":"rui_msg_select_tool_select",
		"message_id":"msg_select",
		"tool_id":"tool_select",
		"tool_name":"ask_user",
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
	if pureSelect != nil {
		t.Fatalf("missing response_mode should be rejected: %+v", pureSelect)
	}

	withWrite := parseRequestUserInputPromptJSON(`{
		"prompt_id":"rui_msg_write_tool_write",
		"message_id":"msg_write",
		"tool_id":"tool_write",
		"tool_name":"ask_user",
		"questions":[{
			"id":"direction",
			"header":"Direction",
			"question":"Choose the next direction.",
			"is_secret":false,
			"response_mode":"select_or_write",
			"choices":[
				{"choice_id":"default","label":"Default path","kind":"select"},
				{"choice_id":"other","label":"Other","kind":"write","input_placeholder":"Describe the custom path"}
			]
		}]
	}`)
	if withWrite != nil {
		t.Fatalf("missing choices_exhaustive should be rejected: %+v", withWrite)
	}
}

func TestParseRequestUserInputPromptJSON_RejectsInconsistentChoicesExhaustive(t *testing.T) {
	t.Parallel()

	prompt := parseRequestUserInputPromptJSON(`{
		"prompt_id":"rui_msg_non_exhaustive_tool_non_exhaustive",
		"message_id":"msg_non_exhaustive",
		"tool_id":"tool_non_exhaustive",
		"tool_name":"ask_user",
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
	if prompt != nil {
		t.Fatalf("inconsistent choices_exhaustive should be rejected: %+v", prompt)
	}
}

func TestParseRequestUserInputPromptJSON_PreservesInteractionContract(t *testing.T) {
	t.Parallel()

	prompt := parseRequestUserInputPromptJSON(`{
		"prompt_id":"rui_msg_contract_tool_contract",
		"message_id":"msg_contract",
		"tool_id":"tool_contract",
		"tool_name":"ask_user",
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
