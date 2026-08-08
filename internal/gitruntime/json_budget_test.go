package gitruntime

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/sessionrpc"
)

type boundedJSONTextValue string

func (boundedJSONTextValue) MarshalText() ([]byte, error) { return []byte("custom"), nil }

func TestValidateRawJSONBoundaries(t *testing.T) {
	for _, valid := range [][]byte{
		nil,
		[]byte(`{"path":"space and \\n newline","paths":["a","b"]}`),
		[]byte(`{"unicode":"\ud83d\ude00"}`),
		[]byte(`{"number":-1.25e+3,"ok":true,"none":null}`),
	} {
		if err := validateRawJSON(valid); err != nil {
			t.Fatalf("valid JSON rejected: %q: %v", valid, err)
		}
	}
	for _, invalid := range [][]byte{
		[]byte(`{"x":"\ud800"}`),
		[]byte(`{"x":01}`),
		[]byte(`{"x":[1,]}`),
		[]byte(strings.Repeat(" ", MaxRawRequestBytes+1)),
	} {
		if err := validateRawJSON(invalid); err == nil {
			t.Fatalf("invalid or over-budget JSON accepted: %.80q", invalid)
		}
	}
}

func TestValidateRawJSONRejectsDepthAndRecordLimit(t *testing.T) {
	deep := strings.Repeat("[", MaxJSONDepth+1) + "0" + strings.Repeat("]", MaxJSONDepth+1)
	if err := validateRawJSON([]byte(deep)); err == nil {
		t.Fatal("over-depth JSON accepted")
	}
	records := "[" + strings.Repeat("0,", MaxJSONRecords) + "0]"
	if err := validateRawJSON([]byte(records)); err == nil {
		t.Fatal("over-record JSON accepted")
	}
}

func TestDecodeStrictRejectsUnknownFields(t *testing.T) {
	type request struct {
		Path string `json:"path"`
	}
	var req request
	if err := decodeStrict([]byte(`{"path":"ok","extra":true}`), &req); err == nil {
		t.Fatal("unknown request field accepted")
	}
}

func TestRetainedBytesRejectsMapsAndOversizedSliceCapacity(t *testing.T) {
	withMap := struct {
		Values map[string]string `json:"values"`
	}{Values: map[string]string{"a": "b"}}
	if _, err := retainedBytes(&withMap, maxRetainedRequestBytes); err == nil {
		t.Fatal("map-backed DTO accepted")
	}
	withSlice := struct {
		Paths []string `json:"paths"`
	}{Paths: make([]string, 0, MaxJSONRecords+1)}
	if _, err := retainedBytes(&withSlice, maxRetainedRequestBytes); err == nil {
		t.Fatal("over-capacity repeated field accepted")
	}
}

func TestSyntheticEnvelopeIncludesWireOverhead(t *testing.T) {
	payload := make([]byte, MaxSyntheticEnvelope)
	for i := range payload {
		payload[i] = '0'
	}
	if syntheticEnvelopeFits(1101, payload, nil) {
		t.Fatal("payload equal to envelope cap ignored wire overhead")
	}
}

func TestMarshalJSONBoundedMatchesEncodingJSON(t *testing.T) {
	type embedded struct {
		Promoted string `json:"promoted,omitempty"`
		Hidden   string `json:"-"`
	}
	type pointerEmbedded struct {
		Optional string `json:"optional,omitempty"`
	}
	type response struct {
		embedded
		*pointerEmbedded
		Renamed  string          `json:"renamed,omitempty"`
		Empty    string          `json:"empty,omitempty"`
		Strings  []string        `json:"strings,omitempty"`
		Array    [2]int          `json:"array,omitempty"`
		Pointer  *int            `json:"pointer,omitempty"`
		Raw      json.RawMessage `json:"raw,omitempty"`
		Enabled  bool            `json:"enabled"`
		Signed   int64           `json:"signed"`
		Unsigned uint64          `json:"unsigned"`
	}
	integer := 42
	cases := []any{
		response{
			embedded:        embedded{Promoted: "line\n<>&\u2028", Hidden: "no"},
			pointerEmbedded: &pointerEmbedded{Optional: "yes"},
			Renamed:         string([]byte{'a', 0xff, 'b'}),
			Strings:         []string{"quote\"", "slash\\"},
			Array:           [2]int{0, 7},
			Pointer:         &integer,
			Raw:             json.RawMessage(` { "html": "<tag>", "n": 1 } `),
			Enabled:         true,
			Signed:          -123,
			Unsigned:        ^uint64(0),
		},
		response{},
		[]response{{Renamed: "first"}, {Renamed: "second"}},
		[2]string{"left", "right"},
	}
	for _, value := range cases {
		want, err := json.Marshal(value)
		if err != nil {
			t.Fatalf("encoding/json marshal %T: %v", value, err)
		}
		gotSize, err := JSONEncodedSize(value, MaxResponsePayload)
		if err != nil {
			t.Fatalf("bounded size %T: %v", value, err)
		}
		if gotSize != len(want) {
			t.Fatalf("bounded size %T = %d, want %d", value, gotSize, len(want))
		}
		got, err := MarshalJSONBounded(value, MaxResponsePayload)
		if err != nil {
			t.Fatalf("bounded marshal %T: %v", value, err)
		}
		if string(got) != string(want) {
			t.Fatalf("bounded marshal %T = %s, want %s", value, got, want)
		}
		if cap(got) != len(got) || cap(got) > MaxResponsePayload {
			t.Fatalf("bounded marshal cap = %d, len = %d", cap(got), len(got))
		}
	}
}

func TestMarshalJSONBoundedFailsClosedForUnsupportedTypes(t *testing.T) {
	for _, value := range []any{
		map[string]string{"unsupported": "map"},
		struct {
			Float float64 `json:"float"`
		}{Float: 1.5},
		struct {
			Value string `json:"value,string"`
		}{Value: "unsupported tag option"},
		struct {
			Values map[string]string `json:"values,omitempty"`
		}{},
		struct {
			Float float64 `json:"float,omitempty"`
		}{},
		[]byte("encoding/json would use base64"),
		json.Number("123"),
		boundedJSONTextValue("custom text marshaler"),
	} {
		if _, err := MarshalJSONBounded(value, MaxResponsePayload); err == nil {
			t.Fatalf("unsupported value %T was accepted", value)
		}
	}
}

func TestMarshalJSONBoundedRejectsHighEscapeExpansionBeforeAllocation(t *testing.T) {
	type response struct {
		Value string `json:"value"`
	}
	value := response{Value: strings.Repeat("<", maxRetainedResponseBytes-1024)}
	if _, err := retainedBytes(&value, maxRetainedResponseBytes); err != nil {
		t.Fatalf("high-escape response should pass retained DTO admission: %v", err)
	}
	if _, err := JSONEncodedSize(&value, MaxResponsePayload); err == nil {
		t.Fatal("high-escape response size was accepted")
	}
	if payload, err := MarshalJSONBounded(&value, MaxResponsePayload); err == nil || payload != nil {
		t.Fatalf("high-escape response = len %d, err %v", len(payload), err)
	}
}

func TestBudgetedRPCRejectsLargeRequestAndResponseWithoutClosingConnection(t *testing.T) {
	type request struct {
		Value string `json:"value"`
	}
	type response struct {
		Value string `json:"value"`
	}
	runtime := New()
	router := sessionrpc.NewRouter()
	RegisterTyped(router, 1101, runtime, DefaultRPCSpec[request, response](), nil, nil, accessgate.RPCAccessPublic,
		func(_ context.Context, req *request) (*response, error) {
			switch req.Value {
			case "large-response":
				return &response{Value: strings.Repeat("x", MaxResponsePayload)}, nil
			case "escaped-response":
				return &response{Value: strings.Repeat("<", maxRetainedResponseBytes-1024)}, nil
			case "large-error":
				return nil, &sessionrpc.Error{Code: 500, Message: strings.Repeat("x", MaxResponsePayload)}
			default:
				return &response{Value: req.Value}, nil
			}
		})

	call := func(raw json.RawMessage) (json.RawMessage, uint32) {
		t.Helper()
		var payload json.RawMessage
		if callErr := router.Call(context.Background(), 1101, raw, &payload); callErr != nil {
			var rpcErr *sessionrpc.Error
			if !errors.As(callErr, &rpcErr) {
				t.Fatalf("business RPC error: %v", callErr)
			}
			return payload, rpcErr.Code
		}
		return payload, 0
	}

	largeRequest, err := json.Marshal(request{Value: strings.Repeat("x", MaxRawRequestBytes)})
	if err != nil {
		t.Fatal(err)
	}
	if _, code := call(largeRequest); code != ErrorRequestBudget {
		t.Fatalf("large request code = %d, want %d", code, ErrorRequestBudget)
	}
	for _, value := range []string{"large-response", "escaped-response", "large-error"} {
		raw, _ := json.Marshal(request{Value: value})
		if _, code := call(raw); code != ErrorResponseBudget {
			t.Fatalf("%s code = %d, want %d", value, code, ErrorResponseBudget)
		}
	}
	payload, code := call(json.RawMessage(`{"value":"still-open"}`))
	if code != 0 {
		t.Fatalf("small request code = %d", code)
	}
	var got response
	if err := json.Unmarshal(payload, &got); err != nil || got.Value != "still-open" {
		t.Fatalf("small response = %q, %v", payload, err)
	}
}
