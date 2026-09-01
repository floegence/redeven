package ai

import (
	"testing"

	flruntime "github.com/floegence/floret/v7/runtime"
)

func TestCanonicalRunInputFromFloretKeepsOriginalTurnObjective(t *testing.T) {
	t.Parallel()

	got, err := canonicalRunInputFromFloret(flruntime.AgentRequest{
		Input:              flruntime.UserInput{Text: "the ask_user answer"},
		CanonicalTurnInput: flruntime.UserInput{Text: "the original user objective"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.Text != "the original user objective" {
		t.Fatalf("canonical input=%q, want original objective", got.Text)
	}
}

func TestCanonicalRunInputFromFloretRejectsMissingOriginalTurn(t *testing.T) {
	t.Parallel()

	if _, err := canonicalRunInputFromFloret(flruntime.AgentRequest{
		Input: flruntime.UserInput{Text: "the ask_user answer"},
	}); err == nil {
		t.Fatal("missing canonical turn input must fail closed")
	}
}
