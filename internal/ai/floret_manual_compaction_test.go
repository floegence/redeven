package ai

import (
	"context"
	"testing"

	flruntime "github.com/floegence/floret/v4/runtime"
)

func TestFlowerManualCompactionSourceRecognizesOnlyPureSlashCommand(t *testing.T) {
	tests := []struct {
		name  string
		input RunInput
		want  bool
	}{
		{name: "exact", input: RunInput{Text: "/compact"}, want: true},
		{name: "surrounding whitespace", input: RunInput{Text: "  /compact\n"}, want: true},
		{name: "ordinary prompt", input: RunInput{Text: "please /compact now"}},
		{name: "attachment", input: RunInput{Text: "/compact", Attachments: []RunAttachmentIn{{AttachmentID: "attachment-1"}}}},
		{name: "context action", input: RunInput{Text: "/compact", ContextAction: &ContextActionEnvelope{}}},
		{name: "structured response", input: RunInput{Text: "/compact", StructuredResponse: &RequestUserInputResponseRecord{}}},
		{name: "secret answer", input: RunInput{Text: "/compact", SecretAnswers: []RequestUserInputSecretAnswer{{}}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := flowerManualCompactionSource(tt.input, "request-compact")
			if (got != nil) != tt.want {
				t.Fatalf("source present=%v, want %v", got != nil, tt.want)
			}
		})
	}
	if got := flowerManualCompactionSource(RunInput{Text: "/compact"}, "  "); got != nil {
		t.Fatal("empty request identity must not create a manual compaction source")
	}
}

func TestFlowerManualCompactionSourceIsConsumedOnce(t *testing.T) {
	source := flowerManualCompactionSource(RunInput{Text: "/compact"}, "request-compact")
	if source == nil {
		t.Fatal("missing manual compaction source")
	}
	request, ok, err := source.PollManualCompaction(t.Context(), flruntime.ManualCompactionPollRequest{Step: 0})
	if err != nil || !ok {
		t.Fatalf("first poll request=%#v ok=%v err=%v", request, ok, err)
	}
	if request.RequestID != "request-compact" || request.Source != flowerManualCompactionSourceName {
		t.Fatalf("first poll request=%#v", request)
	}
	request, ok, err = source.PollManualCompaction(context.Background(), flruntime.ManualCompactionPollRequest{Step: 1})
	if err != nil || ok || request != (flruntime.ManualCompactionRequest{}) {
		t.Fatalf("second poll request=%#v ok=%v err=%v", request, ok, err)
	}
}
