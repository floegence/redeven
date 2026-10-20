package ai

import (
	"encoding/json"
	"reflect"
	"testing"

	fltools "github.com/floegence/floret/v7/tools"
)

func TestActivityPayloadProjectionMatchesPublishedJSONPolicy(t *testing.T) {
	variants := []fltools.ActivityPayload{
		fltools.StructuredActivityPayload{}, fltools.TerminalActivityPayload{},
		fltools.FileActivityPayload{}, fltools.PatchActivityPayload{},
		fltools.WebSearchActivityPayload{}, fltools.WebFetchActivityPayload{},
		fltools.TodosActivityPayload{}, fltools.QuestionActivityPayload{},
		fltools.CompletionActivityPayload{}, fltools.SubAgentActivityPayload{},
		fltools.SubAgentOperationActivityPayload{},
	}
	renderers := []fltools.ActivityRenderer{
		fltools.ActivityRendererStructured, fltools.ActivityRendererTerminal,
		fltools.ActivityRendererFile, fltools.ActivityRendererPatch,
		fltools.ActivityRendererWebSearch, fltools.ActivityRendererWebFetch,
		fltools.ActivityRendererTodos, fltools.ActivityRendererQuestion,
		fltools.ActivityRendererCompletion, fltools.ActivityRendererSubAgent,
		fltools.ActivityRendererSubAgentOperation,
	}
	for index, variant := range variants {
		t.Run(reflect.TypeOf(variant).Name(), func(t *testing.T) {
			for _, populated := range []bool{false, true} {
				pointer := reflect.New(reflect.TypeOf(variant))
				if populated {
					populateActivityProjectionFixture(pointer.Elem())
				}
				for _, input := range []fltools.ActivityPayload{pointer.Elem().Interface().(fltools.ActivityPayload), pointer.Interface().(fltools.ActivityPayload)} {
					if value, ok := input.(fltools.SubAgentActivityPayload); ok && !populated {
						value.ThreadID = "thread-fixture"
						value.ParentThreadID = "thread-parent"
						input = value
					}
					if value, ok := input.(*fltools.SubAgentActivityPayload); ok && !populated {
						value.ThreadID = "thread-fixture"
						value.ParentThreadID = "thread-parent"
					}
					raw, err := json.Marshal(input)
					if err != nil {
						t.Fatal(err)
					}
					var old map[string]any
					if err := json.Unmarshal(raw, &old); err != nil {
						t.Fatal(err)
					}
					for _, tool := range []string{"tool", "goal", "subagents"} {
						expected, expectedOK := sanitizeActivityPayloadValue(old, renderers[index], tool)
						actual, actualOK := sanitizeActivityPayloadValue(activityPayloadMap(input), renderers[index], tool)
						a, _ := json.Marshal(actual)
						e, _ := json.Marshal(expected)
						if actualOK != expectedOK || string(a) != string(e) {
							t.Fatalf("%T populated=%v tool=%s: got %s (%v), want %s (%v)", input, populated, tool, a, actualOK, e, expectedOK)
						}
					}
				}
				pointer.Elem().SetZero()
				if got := activityPayloadMap(reflect.Zero(pointer.Type()).Interface().(fltools.ActivityPayload)); got != nil {
					t.Fatalf("nil payload: %v", got)
				}
			}
		})
	}
}

// Populate every published field, including nested payloads. This makes upstream
// contract additions fail parity instead of silently disappearing from the DTO.
func populateActivityProjectionFixture(value reflect.Value) {
	switch value.Kind() {
	case reflect.Struct:
		for index := 0; index < value.NumField(); index++ {
			populateActivityProjectionFixture(value.Field(index))
		}
	case reflect.Pointer:
		value.Set(reflect.New(value.Type().Elem()))
		populateActivityProjectionFixture(value.Elem())
	case reflect.Slice:
		value.Set(reflect.MakeSlice(value.Type(), 1, 1))
		populateActivityProjectionFixture(value.Index(0))
	case reflect.String:
		value.SetString("fixture")
	case reflect.Bool:
		value.SetBool(true)
	case reflect.Int, reflect.Int64, reflect.Int32, reflect.Int16, reflect.Int8:
		value.SetInt(7)
	case reflect.Uint8:
		value.SetUint(65)
	default:
		panic("unsupported Activity fixture field: " + value.Type().String())
	}
}
