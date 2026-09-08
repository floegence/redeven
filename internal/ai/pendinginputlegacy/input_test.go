package pendinginputlegacy

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestFrozenSessionAndOptionsWireRejectNewRequestFields(t *testing.T) {
	const session = `{"endpoint_id":"env","channel_id":"channel","user_public_id":"user","namespace_public_id":"ns","can_read":true,"can_write":true,"can_execute":true}`
	value, err := DecodeSession(session)
	if err != nil || value.UserPublicID != "user" || value.CanAdmin {
		t.Fatalf("session=%+v %v", value, err)
	}
	if _, err = DecodeSession(strings.TrimSuffix(session, "}") + `,"storage_generation":"future"}`); err == nil {
		t.Fatal("accepted a field outside the historical session format")
	}
	options, err := DecodeOptions(`{}`)
	if err != nil || options.PermissionType != "" || options.NoUserInteraction || options.ReasoningSelection.Level != "" || options.Temperature != nil {
		t.Fatalf("defaults=%+v %v", options, err)
	}
	if _, err = DecodeOptions(`{"future_request_control":true}`); err == nil {
		t.Fatal("accepted a live-only request option")
	}
}

func TestFrozenTextProjectionCanonicalBytes(t *testing.T) {
	const input = `{"schema_version":2,"action_id":"assistant.ask.flower","provider":"flower","target":{"target_id":"current","locality":"auto"},"source":{"surface":"git_browser"},"context":[{"kind":"text_snapshot","title":"Migrated selection","content":"selected migration text"}],"presentation":{"label":"Ask Flower","priority":100}}`
	action, err := DecodeContext(input)
	if err != nil {
		t.Fatal(err)
	}
	references, items, err := Project(action, "env", "")
	if err != nil {
		t.Fatal(err)
	}
	refsJSON, _ := json.Marshal(references)
	const refs = `[{"reference_id":"context:0","kind":"text","label":"Migrated selection","text":"selected migration text"}]`
	if string(refsJSON) != refs {
		t.Fatalf("historical reference changed: %s", refsJSON)
	}
	contextJSON, _ := json.Marshal(items)
	const supplemental = `[{"Kind":"text_snapshot","Title":"Migrated selection","Text":"selected migration text","Metadata":{"source_surface":"git_browser","target_id":"current","target_locality":"auto"},"Sensitive":false,"Truncated":false}]`
	if string(contextJSON) != supplemental {
		t.Fatalf("historical context changed: %s", contextJSON)
	}
}

func TestFrozenContextTargetComesFromPersistedRouting(t *testing.T) {
	action, err := DecodeContext(`{"schema_version":2,"action_id":"assistant.ask.flower","provider":"flower","target":{"target_id":"current","locality":"auto"},"source":{"surface":"flower_composer"},"context":[{"kind":"file_path","path":"/workspace/source.go","is_directory":false}],"presentation":{"label":"Ask Flower","priority":100}}`)
	if err != nil {
		t.Fatal(err)
	}
	refs, items, err := Project(action, "env_original", "target_original")
	if err != nil || len(refs) != 1 || len(items) != 1 {
		t.Fatalf("projection: %+v %+v %v", refs, items, err)
	}
	if items[0].Metadata["target_id"] != "target_original" || items[0].Metadata["source_env_public_id"] != "env_original" || items[0].Metadata["target_locality"] != "remote_runtime" {
		t.Fatalf("scope=%+v", items[0].Metadata)
	}
	again, _, err := Project(action, "env_original", "target_original")
	if err != nil || again[0] != refs[0] {
		t.Fatalf("retry changed reference: %+v %v", again, err)
	}
	if _, _, err = Project(action, "", ""); err == nil {
		t.Fatal("missing historical scope was inferred")
	}
}

func TestFrozenAttachmentCanonicalBytes(t *testing.T) {
	const id = "upl_aaaaaaaaaaaaaaaaaaaaaaaa"
	attachments, err := DecodeAttachments(`[{"attachment_id":"` + id + `"}]`)
	if err != nil {
		t.Fatal(err)
	}
	input, err := TurnInput(context.Background(), " text ", attachments, nil, func(context.Context, string) (Upload, error) {
		return Upload{ID: id, Name: " file.txt ", MIMEType: " text/plain ", SHA256: strings.Repeat("A", 64), Size: 4}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(input)
	const expected = `{"text":"text","attachments":[{"resource_ref":"redeven-upload:v1:upl_aaaaaaaaaaaaaaaaaaaaaaaa:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","name":"file.txt","mime_type":"text/plain","size_bytes":4}]}`
	if string(raw) != expected {
		t.Fatalf("historical attachment changed: %s", raw)
	}
	if _, err = DecodeAttachments(`[{"attachment_id":" ` + id + `"}]`); err == nil {
		t.Fatal("silently normalized an invalid historical ID")
	}
}
