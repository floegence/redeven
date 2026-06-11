package ai

import (
	"strings"
	"testing"

	flruntime "github.com/floegence/floret/runtime"
)

func TestFloretEventSinkDoesNotProjectSanitizedProviderText(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 2)
	r := &run{
		messageID:                 "msg_floret_event",
		onStreamEvent:             func(ev any) { events = append(events, ev) },
		currentTextBlockIndex:     -1,
		currentThinkingBlockIndex: -1,
		needNewTextBlock:          true,
		needNewThinkingBlock:      true,
	}
	sink := floretEventSink{run: r}
	sink.EmitEvent(flruntime.Event{Type: "provider_delta", Message: "text"})
	sink.EmitEvent(flruntime.Event{Type: "provider_reasoning", Message: "thinking"})

	if len(r.assistantBlocks) != 0 || len(events) != 0 {
		t.Fatalf("provider event sink wrote assistant output: blocks=%#v events=%#v", r.assistantBlocks, events)
	}
}

func TestFlowerMessagesToFloretRejectsUnsupportedRole(t *testing.T) {
	t.Parallel()

	_, err := flowerMessagesToFloret([]Message{{Role: "developer"}})
	if err == nil || !strings.Contains(err.Error(), "unsupported role") {
		t.Fatalf("error=%v, want unsupported role rejection", err)
	}
}
