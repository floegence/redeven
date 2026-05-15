package desktopbridge

import (
	"bytes"
	"strings"
	"testing"
)

func TestFrameCodecRoundTrip(t *testing.T) {
	var buf bytes.Buffer
	payload := []byte{0, 1, 2, 255}
	if err := WriteFrame(&buf, FrameHeader{
		StreamID: "local-ui-1",
		Type:     FrameTypeStreamData,
	}, payload); err != nil {
		t.Fatalf("WriteFrame error: %v", err)
	}

	header, gotPayload, err := ReadFrame(&buf)
	if err != nil {
		t.Fatalf("ReadFrame error: %v", err)
	}
	if header.ProtocolVersion != ProtocolVersion {
		t.Fatalf("protocol version=%q, want %q", header.ProtocolVersion, ProtocolVersion)
	}
	if header.StreamID != "local-ui-1" {
		t.Fatalf("stream id=%q, want local-ui-1", header.StreamID)
	}
	if header.Type != FrameTypeStreamData {
		t.Fatalf("frame type=%q, want %q", header.Type, FrameTypeStreamData)
	}
	if !bytes.Equal(gotPayload, payload) {
		t.Fatalf("payload=%v, want %v", gotPayload, payload)
	}
}

func TestFrameCodecRejectsPayloadLengthMismatch(t *testing.T) {
	var buf bytes.Buffer
	if err := WriteFrame(&buf, FrameHeader{
		StreamID: "stream-1",
		Type:     FrameTypeStreamData,
	}, []byte("payload")); err != nil {
		t.Fatalf("WriteFrame error: %v", err)
	}

	raw := buf.Bytes()
	raw[7] = raw[7] + 1
	_, _, err := ReadFrame(bytes.NewReader(raw))
	if err == nil {
		t.Fatal("ReadFrame succeeded for mismatched payload length")
	}
	if !strings.Contains(err.Error(), "unexpected EOF") && !strings.Contains(err.Error(), "does not match") {
		t.Fatalf("unexpected error: %v", err)
	}
}
