package ai

import (
	"strings"
	"testing"
)

func TestFloretToolResultRecoversFrameAttachmentFromPayload(t *testing.T) {
	ref := "computer://browser-main/" + strings.Repeat("a", 64)
	result, err := floretToolResultFromFlower(nil, ToolResult{ToolID: "call", ToolName: "computer.screenshot", Status: toolResultStatusSuccess, Data: map[string]any{"after_frame": ref}})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Attachments) != 1 || result.Attachments[0].ID != ref {
		t.Fatalf("attachments=%#v", result.Attachments)
	}
}
