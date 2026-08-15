package terminal

import (
	"encoding/json"
	"errors"
	"testing"

	termgo "github.com/floegence/floeterm/terminal-go"
	"github.com/floegence/redeven/internal/sessionrpc"
)

func TestTerminalSemanticHistoryRPCChunkFitsTransportBudget(t *testing.T) {
	t.Parallel()

	chunk := termgo.SemanticHistoryChunk{
		SnapshotID: "snapshot", ChunkIndex: 0, ChunkCount: 1,
		PayloadBytes:  termgo.MaxSemanticHistoryChunkPayloadBytes,
		PayloadSHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		Payload:       make([]byte, termgo.MaxSemanticHistoryChunkPayloadBytes),
		Revision:      1, TransportGeneration: 1, ContentEpoch: 1, GeometryGeneration: 1,
		Cols: 103, Rows: 37, Anchor: "anchor", FirstAvailable: "first",
		LastAvailable: "last", ScreenStart: "screen", Offset: 63,
		TotalRows: 100, ScreenStartOffset: 63, HasPrevious: true,
	}

	payloadBytes, err := terminalSemanticHistoryRPCPayloadSize(chunk)
	if err != nil {
		t.Fatal(err)
	}
	if payloadBytes > terminalSemanticHistoryRPCPayloadBudget {
		t.Fatalf("maximum semantic history chunk bytes = %d, budget %d", payloadBytes, terminalSemanticHistoryRPCPayloadBudget)
	}
}

func TestTerminalSemanticHistoryRPCRejectsOversizedChunk(t *testing.T) {
	t.Parallel()

	chunk := termgo.SemanticHistoryChunk{Payload: make([]byte, 80*1024)}
	payloadBytes, err := terminalSemanticHistoryRPCPayloadSize(chunk)
	var rpcErr *sessionrpc.Error
	if !errors.As(err, &rpcErr) || rpcErr.Code != 413 {
		t.Fatalf("oversized history chunk error = %v", err)
	}
	if payloadBytes <= terminalSemanticHistoryRPCPayloadBudget {
		t.Fatalf("oversized history chunk bytes = %d, budget %d", payloadBytes, terminalSemanticHistoryRPCPayloadBudget)
	}
}

func TestTerminalSemanticHistoryRPCRequestSeparatesViewportAndChunkContinuation(t *testing.T) {
	t.Parallel()

	request := terminalSemanticHistoryReq{
		SessionID: "session", ConnectionID: "view", TransportGeneration: 7,
		Anchor: "anchor", Direction: termgo.HistoryBackward, Offset: 63,
		ScrollDeltaRows: 5, ViewportRows: 37,
	}
	encoded, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	var wire map[string]any
	if err := json.Unmarshal(encoded, &wire); err != nil {
		t.Fatal(err)
	}
	if wire["viewport_rows"] != float64(37) || wire["scroll_delta_rows"] != float64(5) || wire["offset"] != float64(63) {
		t.Fatalf("semantic history request lost viewport contract: %s", encoded)
	}

	continuation, err := json.Marshal(terminalSemanticHistoryReq{
		SessionID: "session", ConnectionID: "view", TransportGeneration: 7,
		Continuation: "hc-snapshot-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if string(continuation) != `{"session_id":"session","connection_id":"view","transport_generation":7,"continuation":"hc-snapshot-1"}` {
		t.Fatalf("semantic history continuation request = %s", continuation)
	}
}
