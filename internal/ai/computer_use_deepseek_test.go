package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
)

func TestDeepSeekComputerUseQualification(t *testing.T) {
	if os.Getenv("REDEVEN_COMPUTER_USE_E2E") != "1" {
		t.Skip("online computer-use qualification disabled")
	}
	base := strings.TrimRight(os.Getenv("REDEVEN_COMPUTER_USE_E2E_BASE_URL"), "/")
	key := os.Getenv("REDEVEN_COMPUTER_USE_E2E_API_KEY")
	model := os.Getenv("REDEVEN_COMPUTER_USE_MODEL")
	if model == "" {
		model = "deepseek-v4-flash-vision-exp"
	}
	if model != "deepseek-v4-flash-vision-exp" {
		t.Fatalf("qualification requires deepseek-v4-flash-vision-exp")
	}
	if base == "" || key == "" {
		t.Fatal("DeepSeek qualification base URL and API key are required")
	}
	image := "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
	tools := []any{
		map[string]any{"type": "function", "name": "computer.screenshot", "description": "Capture the selected target screenshot.", "parameters": map[string]any{"type": "object", "properties": map[string]any{"target_id": map[string]any{"type": "string"}}, "required": []string{"target_id"}, "additionalProperties": false}},
		map[string]any{"type": "function", "name": "computer.click", "description": "Click the selected target.", "parameters": map[string]any{"type": "object", "properties": map[string]any{"target_id": map[string]any{"type": "string"}, "x": map[string]any{"type": "number"}, "y": map[string]any{"type": "number"}}, "required": []string{"target_id", "x", "y"}, "additionalProperties": false}},
		map[string]any{"type": "function", "name": "browser.navigate", "description": "Navigate the selected browser target.", "parameters": map[string]any{"type": "object", "properties": map[string]any{"target_id": map[string]any{"type": "string"}, "url": map[string]any{"type": "string"}}, "required": []string{"target_id", "url"}, "additionalProperties": false}},
	}
	input := []any{map[string]any{"role": "user", "content": []any{map[string]any{"type": "input_text", "text": "Use the typed Redeven function computer.screenshot on target browser-fixture, then use the returned screenshot to decide whether to click the success button. Do not use any native computer_use tool."}, map[string]any{"type": "input_image", "image_url": image}}}}
	body := map[string]any{"model": model, "input": input, "tools": tools, "max_output_tokens": 256}
	first := deepSeekQualificationRequest(t, base, key, body)
	assertNoNativeComputerTool(t, first)
	if calls := deepSeekFunctionCalls(first); len(calls) == 0 {
		t.Fatalf("DeepSeek did not return a typed function call; response omitted for safety")
	} else {
		call := calls[0]
		output := []any{map[string]any{"type": "input_text", "text": `{"target_id":"browser-fixture","summary":"screenshot captured","after_frame":"computer://browser-fixture/frame-1"}`}, map[string]any{"type": "input_image", "image_url": image}}
		followInput := append(append([]any{}, input...), map[string]any{"type": "function_call_output", "call_id": call["call_id"], "output": output})
		follow := map[string]any{"model": model, "input": followInput, "tools": tools, "max_output_tokens": 256}
		second := deepSeekQualificationRequest(t, base, key, follow)
		assertNoNativeComputerTool(t, second)
	}
}

func deepSeekQualificationRequest(t *testing.T, base, key string, body map[string]any) map[string]any {
	t.Helper()
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, base+"/responses", bytes.NewReader(encoded))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode/100 != 2 {
		t.Fatalf("DeepSeek qualification request failed with HTTP %d: %s", resp.StatusCode, sanitizeLogText(string(raw), 400))
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("invalid DeepSeek response: %v", err)
	}
	return out
}

func assertNoNativeComputerTool(t *testing.T, response map[string]any) {
	encoded, _ := json.Marshal(response)
	if bytes.Contains(encoded, []byte(`"computer_use"`)) {
		t.Fatalf("DeepSeek response contains forbidden native computer_use tool")
	}
}

func deepSeekFunctionCalls(response map[string]any) []map[string]any {
	items, _ := response["output"].([]any)
	out := []map[string]any{}
	for _, item := range items {
		if record, ok := item.(map[string]any); ok && strings.TrimSpace(fmt.Sprint(record["type"])) == "function_call" {
			out = append(out, record)
		}
	}
	return out
}
