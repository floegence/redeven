package browserbridge

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"strings"
	"testing"
)

type shortWriter struct{ bytes.Buffer }

func (w *shortWriter) Write(body []byte) (int, error) {
	return w.Buffer.Write(body[:min(3, len(body))])
}
func TestNativeMessageFramingIsBoundedAndHandlesPartialWrites(t *testing.T) {
	var writer shortWriter
	if err := WriteMessage(&writer, map[string]string{"name": "fixture"}, 1024); err != nil {
		t.Fatal(err)
	}
	body, err := ReadMessage(&writer, 1024)
	if err != nil || string(body) != `{"name":"fixture"}` {
		t.Fatalf("frame: %s %v", body, err)
	}
	for _, length := range []uint32{0, 1025, 1 << 30} {
		var header [4]byte
		binary.LittleEndian.PutUint32(header[:], length)
		if _, err := ReadMessage(bytes.NewReader(header[:]), 1024); err == nil {
			t.Fatalf("accepted length %d", length)
		}
	}
	if _, err := ReadMessage(bytes.NewReader([]byte{1, 0, 0, 0, 'x'}), 1024); err == nil {
		t.Fatal("accepted invalid JSON")
	}
	if err := WriteMessage(io.Discard, json.RawMessage(`{"x":"`+strings.Repeat("a", 1024)+`"}`), 1024); err == nil {
		t.Fatal("accepted oversized output")
	}
}
func TestNativeBridgeRejectsOtherExtensionBeforeDial(t *testing.T) {
	if err := Forward(context.Background(), "/tmp/nonexistent/socket", "chrome-extension://wrong/", strings.NewReader(""), io.Discard); err == nil {
		t.Fatal("accepted another extension")
	}
}
