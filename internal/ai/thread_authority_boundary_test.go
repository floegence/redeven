package ai

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestThreadViewDoesNotExposeRedevenAgentOwnershipShadow(t *testing.T) {
	t.Parallel()

	typeOfView := reflect.TypeOf(ThreadView{})
	for _, field := range []string{"OwnerKind", "OwnerID", "ParentThreadID"} {
		if _, ok := typeOfView.FieldByName(field); ok {
			t.Fatalf("ThreadView still defines Redeven-owned Agent shadow field %q", field)
		}
	}
	body, err := json.Marshal(ThreadView{ThreadID: "thread_1", Title: "Canonical title"})
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"owner_kind", "owner_id", "parent_thread_id"} {
		if strings.Contains(string(body), field) {
			t.Fatalf("ThreadView exposed Redeven-owned Agent shadow field %q: %s", field, body)
		}
	}
}
