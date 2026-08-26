package ai

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestContractSafeStringNormalizesUTF8BeforeLengthCheck(t *testing.T) {
	invalid := "prefix " + string([]byte{0xe8, 0xa2})
	got, truncated := contractSafeString(invalid, 100)
	if truncated {
		t.Fatal("short normalized text was reported as truncated")
	}
	if !utf8.ValidString(got) || !strings.Contains(got, "\uFFFD") {
		t.Fatalf("contract text=%q, want valid UTF-8 replacement", got)
	}
}

func TestTerminalSnapshotNormalizesOutputWithoutChangingRawAccounting(t *testing.T) {
	validSplit := &terminalProcess{
		id: "process-valid", status: terminalProcessStatusSuccess,
		outputChunks: []terminalProcessOutputChunk{
			{seq: 1, data: []byte{0xe5}},
			{seq: 2, data: []byte{0x9b, 0x9e}},
		},
		lastSeq: 2,
		total:   3,
	}
	valid := validSplit.Snapshot()
	if valid.Output != "回" || valid.outputUTF8Repaired {
		t.Fatalf("split valid rune snapshot=%#v", valid)
	}

	raw := append([]byte("prefix "), 0xe8, 0xa2)
	incomplete := &terminalProcess{
		id: "process-incomplete", status: terminalProcessStatusSuccess,
		outputChunks: []terminalProcessOutputChunk{{seq: 1, data: raw}},
		lastSeq:      1,
		total:        int64(len(raw)),
	}
	snapshot := incomplete.Snapshot()
	if !utf8.ValidString(snapshot.Output) || !strings.Contains(snapshot.Output, "\uFFFD") || !snapshot.outputUTF8Repaired {
		t.Fatalf("incomplete output snapshot=%#v", snapshot)
	}
	if snapshot.TotalBytes != int64(len(raw)) || snapshot.FirstSeq != 1 || snapshot.LastSeq != 1 {
		t.Fatalf("raw accounting changed: snapshot=%#v raw_bytes=%d", snapshot, len(raw))
	}
	payload := terminalProcessResultPayload(snapshot)
	if output, _ := payload["output"].(string); !utf8.ValidString(output) {
		t.Fatalf("terminal result payload output=%q is not valid UTF-8", output)
	}
}
