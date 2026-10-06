package gatewaycloud

import (
	"bytes"
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func TestGatewayCloudWireFixtures(t *testing.T) {
	raw, err := os.ReadFile("testdata/wire-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	types := map[string]any{"gateway_status": &GatewayStatus{}, "runtime_status": &RuntimeStatus{}, "publish_response": &PublishResponse{}, "directory_sync": &DirectorySync{}, "runtime_join": &RuntimeJoin{}, "closure_list": &ClosureList{}}
	for name, target := range types {
		t.Run(name, func(t *testing.T) {
			original := fixtures[name]
			decoder := json.NewDecoder(bytes.NewReader(original))
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(target); err != nil {
				t.Fatal(err)
			}
			encoded, err := json.Marshal(target)
			if err != nil {
				t.Fatal(err)
			}
			var before, after any
			if err := json.Unmarshal(original, &before); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(encoded, &after); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(before, after) {
				t.Fatal("wire contract fields changed")
			}
		})
	}
}
