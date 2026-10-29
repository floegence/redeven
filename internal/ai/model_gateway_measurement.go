package ai

import (
	"encoding/json"
	"net/http"
	"time"

	flprovider "github.com/floegence/floret/v7/provider"
	responses "github.com/openai/openai-go/v3/responses"
)

func (p *openAIProvider) httpMeasurementIdentity() string {
	if !p.officialOpenAI || p.transportIdentity.Account == "" {
		return ""
	}
	return "http:" + openAIHash([]any{p.transportIdentity, p.measurementCredential})
}
func (p *openAIProvider) preparedMeasurementIdentity(req ModelGatewayRequest) string {
	if p.chatGPT && p.officialOpenAI && p.responsesPool != nil && p.responsesPool.selection(openAIRequestRoute(p.transportIdentity, req)) == "" && (req.ReusePolicy == nil || req.ReusePolicy.ProviderStateAllowed) {
		p.responsesPool.mu.Lock()
		defer p.responsesPool.mu.Unlock()
		e := p.responsesPool.entries[openAIConnectionKey{p.transportIdentity, req.Model, string(req.PromptScopeID)}]
		if e != nil && e.conn != nil && !e.busy && time.Since(e.opened) < p.responsesPool.lifetime {
			return "ws:" + openAIHash(p.transportIdentity) + ":" + e.measurementID
		}
	}
	return p.httpMeasurementIdentity()
}

// These facts come from this response or this socket's handshake. A protocol
// name, configured model or a prior HTTP response cannot establish inclusion.
func (p *openAIProvider) responseMeasurement(payload []byte, completed responses.Response, result ModelGatewayResult, lease *openAIConnectionLease, response *http.Response) *flprovider.RequestMeasurement {
	if !p.officialOpenAI || p.transportIdentity.Account == "" || completed.Status != "completed" || completed.ID == "" || !result.Usage.InputTokensReported || !result.Usage.Available {
		return nil
	}
	identity, included := p.httpMeasurementIdentity(), false
	if lease != nil {
		identity = "ws:" + openAIHash(p.transportIdentity) + ":" + lease.entry.measurementID
		included = lease.entry.reasoningIncluded
	} else if response != nil {
		included = response.Header.Values("x-reasoning-included") != nil
	}
	var body map[string]json.RawMessage
	if json.Unmarshal(payload, &body) != nil || len(body["previous_response_id"]) > 0 {
		return nil
	}
	// Hosted execution can aggregate hidden calls. It has no complete-input proof.
	if string(body["truncation"]) == "\"auto\"" {
		return nil
	}
	var tools []struct{ Type string }
	if json.Unmarshal(body["tools"], &tools) != nil && len(body["tools"]) > 0 {
		return nil
	}
	for _, tool := range tools {
		if tool.Type != "function" && tool.Type != "namespace" {
			return nil
		}
	}
	rendered := flprovider.RenderedRequest{Provider: p.providerType, Model: completed.Model, Format: flprovider.RequestFormatOpenAIResponses, Payload: payload}
	if !included && hasEncryptedReasoning(payload) {
		return nil
	}
	prefix, err := flprovider.RenderedMeasurementPrefix(rendered, identity, "input")
	if err != nil {
		return nil
	}
	evidence := &flprovider.RequestMeasurement{CompleteInput: true, OpaqueInput: included, Input: prefix, ResponseID: completed.ID}
	// Only ChatGPT's validated native state replays these exact output items.
	if !p.chatGPT || result.ProviderState == nil || result.ProviderState.Kind != chatGPTStateKind || !result.Usage.OutputTokensReported {
		return evidence
	}
	var input []json.RawMessage
	if json.Unmarshal(body["input"], &input) != nil {
		return evidence
	}
	for _, item := range completed.Output {
		input = append(input, json.RawMessage(item.RawJSON()))
	}
	body["input"], _ = json.Marshal(input)
	rendered.Payload, _ = json.Marshal(body)
	if !included && hasEncryptedReasoning(rendered.Payload) {
		return evidence
	}
	evidence.ResponseEnd, _ = flprovider.RenderedMeasurementPrefix(rendered, identity, "response_end")
	return evidence
}

func hasEncryptedReasoning(payload []byte) bool {
	var value any
	if json.Unmarshal(payload, &value) != nil {
		return true
	}
	var contains func(any) bool
	contains = func(value any) bool {
		switch v := value.(type) {
		case map[string]any:
			for key, item := range v {
				if key == "encrypted_content" || key == "redacted_thinking" {
					return true
				}
				if contains(item) {
					return true
				}
			}
		case []any:
			for _, item := range v {
				if contains(item) {
					return true
				}
			}
		}
		return false
	}
	return contains(value)
}
