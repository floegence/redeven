package ai

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	fltools "github.com/floegence/floret/v7/tools"
)

func TestSubagentArgumentsRejectBeforeEffectAuthority(t *testing.T) {
	root := t.TempDir()
	r := newRun(runOptions{WorkingDir: root, AgentHomeDir: root, Shell: "/bin/sh", RunID: "run-arguments", ThreadID: "thread-arguments", ToolAllowlist: []string{"subagents"}})
	r.ensureSkillManager().userHome = root
	surface, err := r.buildRunToolSurface(runToolSurfaceConfig{}, FlowerPermissionFullAccess)
	if err != nil {
		t.Fatal(err)
	}
	registry := fltools.NewRegistry(surface.FloretToolItems...)
	for _, tc := range []struct{ args, code string }{
		{`{"action":"spawn"}`, "spawn_requires_task_name"},
		{`{"action":"spawn","task_name":"Review"}`, "spawn_requires_task_description"},
		{`{"action":"spawn","task_name":"Review","task_description":"Inspect","message":" \t"}`, "spawn_requires_message"},
		{`{"action":"wait","ids":[]}`, "wait_requires_ids"},
		{`{"action":"status"}`, "status_requires_target_or_ids"},
		{`{"action":"inspect"}`, "inspect_requires_target_or_ids"},
		{`{"action":"send_input","message":"Guidance"}`, "send_input_requires_target"},
		{`{"action":"send_input","target":"child"}`, "send_input_requires_message"},
		{`{"action":"send_input","target":"child","message":"` + strings.Repeat("界", 1334) + `"}`, "send_input_message_too_long"},
		{`{"action":"close","target":" "}`, "close_requires_target"},
		{`{"action":"close_all","ids":["child"]}`, "unsupported_fields"},
		{`{"action":"close_all","target":"child"}`, "unsupported_fields"},
		{`{"action":"close_all","limit":1}`, "unsupported_fields"},
		{`{"action":"close_all","running_only":false}`, "unsupported_fields"},
		{`{"action":"close","target":"child","ids":["other"]}`, "unsupported_fields"},
		{`{"action":"wait","ids":["child"],"target":"other"}`, "unsupported_fields"},
		{`{"action":"list","target":"child"}`, "unsupported_fields"},
		{`{"action":"status","target":"child","limit":1}`, "unsupported_fields"},
		{`{"action":"inspect","target":"child","running_only":true}`, "unsupported_fields"},
		{`{"action":"send_input","target":"child","message":"guidance","scope":"current_thread"}`, "unsupported_fields"},
		{`{"action":"spawn","task_name":"Review","task_description":"Inspect","message":"Work","ids":[]}`, "unsupported_fields"},
	} {
		t.Run(tc.code, func(t *testing.T) {
			call := fltools.ToolCall{ID: "rejected", Name: "subagents", Args: tc.args}
			_, err := registry.ActivityForCall(call, fltools.DispatchOptions{})
			var cause subagentArgumentsError
			if !errors.As(err, &cause) || cause.InvalidArgumentsCode() != "invalid_arguments.subagents."+tc.code {
				t.Fatalf("decoder lost typed cause: %v", err)
			}
			result := registry.Dispatch(t.Context(), call, fltools.DispatchOptions{EffectDispatcher: func(context.Context, fltools.EffectDispatchRequest, func(context.Context) fltools.Result) fltools.Result {
				t.Error("invalid input reached effect authority")
				return fltools.Result{}
			}})
			if !result.IsError || !strings.Contains(result.Text, cause.Error()) || result.RequiresEffectFinalization() {
				t.Fatalf("result=%+v", result)
			}
		})
	}
}

func TestSubagentDecoderPreservesAcceptedInputs(t *testing.T) {
	for _, raw := range []string{
		`{"action":"spawn","task_name":" Review ","task_description":" Inspect ","message":" Authorized task ","context_mode":"full_history"}`,
		`{"action":"send_input","target":" child ","message":" Guidance "}`,
		`{"action":"wait","ids":["child"],"timeout_ms":10000}`,
		`{"action":"list","running_only":false}`,
		`{"action":"status","target":"child"}`,
		`{"action":"inspect","ids":["child"]}`,
		`{"action":"close","target":"child"}`,
		`{"action":"close_all"}`,
		`{"action":"close_all","scope":"current_thread"}`,
		`{"action":"close_all","scope":null,"ids":null,"target":null,"limit":null,"running_only":null}`,
		`{"action":"inspect","target":"first","ids":["second","first"]}`,
	} {
		var want map[string]any
		if err := json.Unmarshal([]byte(raw), &want); err != nil {
			t.Fatal(err)
		}
		got, err := decodeSubagentsToolInput([]byte(raw))
		if err != nil || !reflect.DeepEqual(got, want) {
			t.Fatalf("input=%s got=%#v err=%v", raw, got, err)
		}
	}
}

func TestSubagentDecoderRejectsMisleadingRunScope(t *testing.T) {
	_, err := decodeSubagentsToolInput([]byte(`{"action":"close_all","scope":"current_run"}`))
	var cause subagentArgumentsError
	if !errors.As(err, &cause) || cause.InvalidArgumentsCode() != "invalid_arguments.subagents.close_all_invalid_scope" {
		t.Fatalf("misleading scope accepted: %v", err)
	}
}
