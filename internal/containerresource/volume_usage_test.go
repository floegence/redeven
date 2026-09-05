package containerresource

import (
	"context"
	"testing"

	"github.com/floegence/redeven/internal/containerengine"
)

func TestVolumeInventoryAndDetailExposeIncompleteReferences(t *testing.T) {
	client := &fakeEngineClient{volumes: map[string]containerengine.VolumeRecord{
		"unused":  {Name: "unused"},
		"unknown": {Name: "unknown", ReferenceInspectionFailures: 1},
		"used":    {Name: "used", ReferencedContainers: 1},
	}}
	service := newTestServiceWithClient(t, client, nil)
	items, err := service.Volumes(context.Background(), containerengine.VolumeListRequest{Engine: containerengine.EngineDocker})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range items {
		if item.ReferencesComplete != (item.Name != "unknown") {
			t.Fatalf("inventory reference state = %#v", item)
		}
		detail, err := service.Volume(context.Background(), containerengine.VolumeInspectRequest{Engine: containerengine.EngineDocker, Name: item.Name})
		if err != nil || detail.ReferencesComplete != item.ReferencesComplete {
			t.Fatalf("detail = %#v, %v", detail, err)
		}
	}
}
