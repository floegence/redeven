package ai

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"

	flprovider "github.com/floegence/floret/v7/provider"
)

func annotationString(v map[string]any, key string) string { s, _ := v[key].(string); return s }
func cloneMessageAttribution(a *flprovider.MessageAttribution) *flprovider.MessageAttribution {
	if a == nil {
		return nil
	}
	v := *a
	v.Parts = append([]flprovider.ContentAttributionPart(nil), a.Parts...)
	return &v
}

// The protocol adapter owns source paths; Floret alone extracts and counts input.
// Match by ordered canonical roles, validating the rendered value before using a
// source. A mismatch suppresses optional distribution without changing the budget.
func renderedContextAttribution(format flprovider.RequestFormat, raw []byte, req ModelGatewayRequest, aliases providerToolAliases) []flprovider.RenderedContentAttribution {
	var body map[string]any
	if json.Unmarshal(raw, &body) != nil {
		return nil
	}
	out := []flprovider.RenderedContentAttribution{}
	invalid := func() { out = append(out, flprovider.RenderedContentAttribution{Path: "/attribution_mismatch"}) }
	key := "messages"
	if format == flprovider.RequestFormatOpenAIResponses {
		key = "input"
	}
	list, _ := body[key].([]any)
	for _, role := range []string{"system", "user"} {
		originals := []Message{}
		pendingToolImages := false
		for _, m := range req.Messages {
			messageRole := strings.ToLower(strings.TrimSpace(m.Role))
			if format == flprovider.RequestFormatOpenAIChat && role == "user" {
				// Chat inserts one user message for each contiguous group of tool
				// images. Account for that structural slot without guessing its text.
				if messageRole != "tool" && pendingToolImages {
					originals = append(originals, Message{})
					pendingToolImages = false
				}
				if messageRole == "tool" {
					for _, p := range m.Content {
						pendingToolImages = pendingToolImages || strings.EqualFold(strings.TrimSpace(p.Type), "image")
					}
				}
			}
			if messageRole == role && (len(m.Content) > 0 || m.Attribution != nil) {
				originals = append(originals, m)
			}
		}
		if pendingToolImages {
			originals = append(originals, Message{})
		}
		if role == "system" && (format == flprovider.RequestFormatOpenAIResponses || format == flprovider.RequestFormatAnthropic) {
			path := "/instructions"
			if format == flprovider.RequestFormatAnthropic {
				path = "/system/0/text"
			}
			var parts []flprovider.ContentAttributionPart
			offset := 0
			hasAttribution := false
			for _, m := range originals {
				text := joinMessageText(m)
				if text == "" {
					continue
				}
				if offset > 0 {
					parts = append(parts, flprovider.ContentAttributionPart{Start: offset, End: offset + 2, Category: "system"})
					offset += 2
				}
				a := m.Attribution
				category := "system"
				if a != nil {
					category = a.Category
					hasAttribution = true
				}
				// System messages are joined by the renderer using the same text helper.
				if a != nil && len(a.Parts) > 0 {
					for _, p := range trimmedAttributionParts(m, text) {
						p.Start += offset
						p.End += offset
						if p.Category == "" {
							p.Category = category
						}
						parts = append(parts, p)
					}
				} else {
					parts = append(parts, flprovider.ContentAttributionPart{Start: offset, End: offset + len(text), Category: category})
				}
				offset += len(text)
			}
			if hasAttribution {
				rendered, _ := body["instructions"].(string)
				if format == flprovider.RequestFormatAnthropic {
					blocks, _ := body["system"].([]any)
					if len(blocks) > 0 {
						first, _ := blocks[0].(map[string]any)
						rendered, _ = first["text"].(string)
					}
				}
				if rendered != collectSystemPrompt(originals) {
					invalid()
				} else {
					out = append(out, flprovider.RenderedContentAttribution{Path: path, Category: "system", Parts: parts})
				}
			}
			continue
		}
		u := 0
		for i, v := range list {
			item, _ := v.(map[string]any)
			if item["role"] != role {
				continue
			}
			if format == flprovider.RequestFormatAnthropic {
				blocks, _ := item["content"].([]any)
				if len(blocks) > 0 {
					first, _ := blocks[0].(map[string]any)
					if first["type"] == "tool_result" {
						continue
					}
				}
			}
			if u >= len(originals) {
				break
			}
			m := originals[u]
			u++
			if m.Attribution == nil {
				continue
			}
			path := fmt.Sprintf("/%s/%d/content", key, i)
			texts := []struct{ path, text string }{}
			if text, ok := item["content"].(string); ok {
				texts = append(texts, struct{ path, text string }{path, text})
			} else {
				blocks, _ := item["content"].([]any)
				for j, block := range blocks {
					b, _ := block.(map[string]any)
					if text, ok := b["text"].(string); ok && (b["type"] == "text" || b["type"] == "input_text") {
						texts = append(texts, struct{ path, text string }{fmt.Sprintf("%s/%d/text", path, j), text})
					}
				}
			}
			segments := messageAttributionSegments(m, format != flprovider.RequestFormatJSON)
			if role == "system" && format != flprovider.RequestFormatJSON {
				segments = []attributionSegment{{text: joinMessageText(m), parts: trimmedAttributionParts(m, joinMessageText(m)), valid: true}}
			}
			if len(segments) != len(texts) {
				invalid()
				continue
			}
			for j, segment := range segments {
				if segment.text != texts[j].text || !segment.valid {
					invalid()
					break
				}
				out = append(out, flprovider.RenderedContentAttribution{Path: texts[j].path, Category: m.Attribution.Category, Parts: segment.parts})
			}
		}
		for ; u < len(originals); u++ {
			if originals[u].Attribution != nil {
				invalid()
			}
		}
	}
	definitions := map[string]ToolDef{}
	for _, t := range req.Tools {
		name := t.Name
		if aliases.canonicalToWire != nil {
			name = aliases.wireName(t.Name)
		}
		definitions[name] = t
	}
	var tools func(string, []any)
	tools = func(path string, list []any) {
		for i, v := range list {
			tool, _ := v.(map[string]any)
			p := fmt.Sprintf("%s/%d", path, i)
			if nested, ok := tool["tools"].([]any); ok {
				tools(p+"/tools", nested)
				continue
			}
			def := tool
			if f, ok := tool["function"].(map[string]any); ok {
				def = f
			}
			name, _ := def["name"].(string)
			if t, ok := definitions[name]; ok {
				out = append(out, flprovider.RenderedContentAttribution{Path: p, Category: "tool_definition", Key: t.Name, Source: t.Source, Namespace: t.Namespace})
			}
		}
	}
	if list, ok := body["tools"].([]any); ok {
		tools("/tools", list)
	}
	return out
}

// Attribution offsets refer to concatenated canonical text bytes. Renderers may
// trim each text block; project those exact intervals without re-tokenizing.
type attributionSegment struct {
	text  string
	parts []flprovider.ContentAttributionPart
	valid bool
}

func messageAttributionSegments(m Message, trim bool) []attributionSegment {
	total := 0
	for _, p := range m.Content {
		if strings.EqualFold(strings.TrimSpace(p.Type), "text") {
			total += len(p.Text)
		}
	}
	valid := true
	end := 0
	for _, p := range m.Attribution.Parts {
		if p.Start != end || p.End <= p.Start || p.End > total {
			valid = false
			break
		}
		end = p.End
	}
	if len(m.Attribution.Parts) > 0 && end != total {
		valid = false
	}
	out := []attributionSegment{}
	offset := 0
	for _, p := range m.Content {
		if !strings.EqualFold(strings.TrimSpace(p.Type), "text") {
			continue
		}
		text := p.Text
		start := offset
		offset += len(text)
		if trim {
			start += len(text) - len(strings.TrimLeftFunc(text, unicode.IsSpace))
			text = strings.TrimSpace(text)
		}
		if text == "" {
			continue
		}
		segment := attributionSegment{text: text, valid: valid}
		for _, source := range m.Attribution.Parts {
			a, b := max(start, source.Start), min(start+len(text), source.End)
			if b > a {
				source.Start = a - start
				source.End = b - start
				if !utf8.ValidString(text[source.Start:source.End]) {
					segment.valid = false
				}
				segment.parts = append(segment.parts, source)
			}
		}
		out = append(out, segment)
	}
	return out
}
func trimmedAttributionParts(m Message, rendered string) []flprovider.ContentAttributionPart {
	segments := messageAttributionSegments(m, true)
	var parts []flprovider.ContentAttributionPart
	offset := 0
	for _, s := range segments {
		if !s.valid {
			return []flprovider.ContentAttributionPart{{Start: -1, End: len(rendered)}}
		}
		if offset > 0 {
			parts = append(parts, flprovider.ContentAttributionPart{Start: offset, End: offset + 1, Category: m.Attribution.Category})
			offset++
		}
		if len(s.parts) == 0 {
			parts = append(parts, flprovider.ContentAttributionPart{Start: offset, End: offset + len(s.text), Category: m.Attribution.Category})
		} else {
			for _, p := range s.parts {
				p.Start += offset
				p.End += offset
				parts = append(parts, p)
			}
		}
		offset += len(s.text)
	}
	return parts
}
