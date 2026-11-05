package codeapp

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/codeapp/appserver"
	"github.com/floegence/redeven/internal/plugincreation"
)

func TestCloseDrainsAuthorToolsBeforeClosingDraftStore(t *testing.T) {
	store, err := plugincreation.Open(filepath.Join(t.TempDir(), "drafts.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	owner := plugincreation.Owner{User: "author", Environment: "environment"}
	drained := false
	controller := newAIReadinessController(context.Background(), ai.Options{}, func(context.Context, ai.Options) (*ai.Service, error) {
		return new(ai.Service), nil
	}, func(*ai.Service) error {
		_, err := store.List(context.Background(), owner)
		if err != nil {
			t.Errorf("author state closed before tools drained: %v", err)
		}
		drained = true
		return err
	})
	controller.Start()
	waitForAIReadinessState(t, controller, appserver.AIReadinessReady)
	service := &Service{aiReady: controller, pluginDrafts: store}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}
	if !drained {
		t.Fatal("author tools were not drained")
	}
	if _, err := store.List(context.Background(), owner); err == nil {
		t.Fatal("draft store remains open after shutdown")
	}
}
