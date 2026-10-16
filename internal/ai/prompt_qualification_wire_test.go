package ai

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

// Only synthetic response facts are retained. Authorization headers and source
// configuration never enter the recorder. It does not alter requests or replies.
type promptQualificationTransport struct {
	body  bytes.Buffer
	names []string
}

func (r *promptQualificationTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.GetBody != nil {
		body, err := req.GetBody()
		if err != nil {
			return nil, err
		}
		defer body.Close()
		var request struct{ Tools []struct{ Name string } }
		if err := json.NewDecoder(body).Decode(&request); err != nil {
			return nil, err
		}
		for _, tool := range request.Tools {
			r.names = append(r.names, tool.Name)
		}
	}
	response, err := http.DefaultTransport.RoundTrip(req)
	if err != nil {
		return nil, err
	}
	response.Body = &promptQualificationBody{Reader: io.TeeReader(response.Body, &r.body), Closer: response.Body}
	return response, nil
}

type promptQualificationBody struct {
	io.Reader
	io.Closer
}

func (r *promptQualificationTransport) snapshot() map[string]any {
	events := []map[string]any{}
	scanner := bufio.NewScanner(bytes.NewReader(r.body.Bytes()))
	scanner.Buffer(make([]byte, 4096), 2<<20)
	for scanner.Scan() {
		line := strings.TrimPrefix(scanner.Text(), "data: ")
		var event map[string]any
		if json.Unmarshal([]byte(line), &event) != nil {
			continue
		}
		kind, _ := event["type"].(string)
		if kind == "response.output_item.done" {
			if item, ok := event["item"].(map[string]any); ok && item["type"] == "function_call" {
				events = append(events, promptQualificationCallFacts(kind, item))
			}
		}
		if kind == "response.completed" || kind == "response.incomplete" {
			response, _ := event["response"].(map[string]any)
			events = append(events, map[string]any{"type": kind, "status": response["status"], "incomplete_details": response["incomplete_details"]})
			if output, ok := response["output"].([]any); ok {
				for _, value := range output {
					if item, ok := value.(map[string]any); ok && item["type"] == "function_call" {
						events = append(events, promptQualificationCallFacts(kind, item))
					}
				}
			}
		}
	}
	return map[string]any{"tool_names": r.names, "events": events, "response_bytes": r.body.Len()}
}

func promptQualificationCallFacts(kind string, item map[string]any) map[string]any {
	arguments, _ := item["arguments"].(string)
	return map[string]any{"event": kind, "id": item["id"], "call_id": item["call_id"], "name": item["name"], "arguments": arguments, "arguments_valid": json.Valid([]byte(arguments))}
}
