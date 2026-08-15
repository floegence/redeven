package terminal

import (
	"errors"
	"strings"
	"testing"

	termgo "github.com/floegence/floeterm/terminal-go"
	"github.com/floegence/redeven/internal/sessionrpc"
)

func TestTerminalSemanticHistoryRPCLimitBoundsResponseCells(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		requested int
		cols      int
		want      int
	}{
		{name: "small viewport", requested: 24, cols: 80, want: 12},
		{name: "wide viewport", requested: 200, cols: 103, want: 9},
		{name: "maximum width", requested: 200, cols: 500, want: 2},
		{name: "one row minimum", requested: 200, cols: 4096, want: 1},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			got, err := terminalSemanticHistoryRPCLimit(test.requested, test.cols)
			if err != nil {
				t.Fatal(err)
			}
			if got != test.want {
				t.Fatalf("terminalSemanticHistoryRPCLimit(%d, %d) = %d, want %d", test.requested, test.cols, got, test.want)
			}
			if got*test.cols > terminalSemanticHistoryMaxPageCells && got != 1 {
				t.Fatalf("effective page has %d cells, budget %d", got*test.cols, terminalSemanticHistoryMaxPageCells)
			}
		})
	}
}

func TestTerminalSemanticHistoryRPCPayloadFailsBeforeTransportOverflow(t *testing.T) {
	t.Parallel()

	page := termgo.SemanticHistoryPage{
		Revision: 1,
		Frame: termgo.SemanticFrame{
			Width:  410,
			Height: 5,
			Rows:   make([]termgo.SemanticRow, 5),
		},
	}
	for rowIndex := range page.Frame.Rows {
		page.Frame.Rows[rowIndex].Cells = make([]termgo.SemanticCell, page.Frame.Width)
		for cellIndex := range page.Frame.Rows[rowIndex].Cells {
			page.Frame.Rows[rowIndex].Cells[cellIndex] = termgo.SemanticCell{
				Text:  strings.Repeat("x", 64),
				Width: 1,
			}
		}
	}

	payloadBytes, err := terminalSemanticHistoryRPCPayloadSize(page)
	var rpcErr *sessionrpc.Error
	if !errors.As(err, &rpcErr) || rpcErr.Code != 413 {
		t.Fatalf("oversized history payload error = %v", err)
	}
	if payloadBytes <= terminalSemanticHistoryRPCPayloadBudget {
		t.Fatalf("oversized history payload bytes = %d, budget %d", payloadBytes, terminalSemanticHistoryRPCPayloadBudget)
	}
}

func TestTerminalSemanticHistoryRPCPayloadFitsNormalShellPageBudget(t *testing.T) {
	t.Parallel()

	page := termgo.SemanticHistoryPage{
		Revision: 1,
		Frame: termgo.SemanticFrame{
			Width:  103,
			Height: 9,
			Rows:   make([]termgo.SemanticRow, 9),
		},
	}
	for rowIndex := range page.Frame.Rows {
		page.Frame.Rows[rowIndex].Cells = make([]termgo.SemanticCell, page.Frame.Width)
		for cellIndex := range page.Frame.Rows[rowIndex].Cells {
			page.Frame.Rows[rowIndex].Cells[cellIndex] = termgo.SemanticCell{
				Text:  " ",
				Width: 1,
				Style: termgo.SemanticStyle{Foreground: "default", Background: "default"},
			}
		}
	}

	payloadBytes, err := terminalSemanticHistoryRPCPayloadSize(page)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("normal shell semantic history payload bytes = %d", payloadBytes)
	if payloadBytes > terminalSemanticHistoryRPCPayloadBudget {
		t.Fatalf("normal shell payload bytes = %d, budget %d", payloadBytes, terminalSemanticHistoryRPCPayloadBudget)
	}
}

func TestTerminalSemanticHistoryRPCLimitRejectsInvalidContracts(t *testing.T) {
	t.Parallel()

	for _, input := range []struct {
		requested int
		cols      int
	}{
		{requested: 0, cols: 80},
		{requested: 201, cols: 80},
		{requested: 24, cols: 0},
	} {
		_, err := terminalSemanticHistoryRPCLimit(input.requested, input.cols)
		var rpcErr *sessionrpc.Error
		if !errors.As(err, &rpcErr) || (rpcErr.Code != 400 && rpcErr.Code != 409) {
			t.Fatalf("terminalSemanticHistoryRPCLimit(%d, %d) error = %v", input.requested, input.cols, err)
		}
	}
}
