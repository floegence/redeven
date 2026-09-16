package containerengine

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestInspectIncludesTmpfsFromHostConfig(t *testing.T) {
	for _, engine := range []Engine{EngineDocker, EnginePodman} {
		t.Run(string(engine), func(t *testing.T) {
			raw := `[{"Id":"test","Name":"/test","Config":{"Image":"example.invalid/app:1"},
			"HostConfig":{"Tmpfs":{"/tmp":"rw,noexec,nosuid,nodev,size=536870912","/cache":"ro,size=1048576"}},
			"Mounts":[{"Type":"volume","Name":"data","Source":"/var/lib/docker/volumes/data/_data","Destination":"/data","RW":true}]}]`
			container, err := parseContainerInspect(engine, []byte(raw))
			if err != nil {
				t.Fatal(err)
			}
			want := []MountInput{{Type: MountTypeVolume, Source: "data", Target: "/data"},
				{Type: MountTypeTmpfs, Target: "/cache", ReadOnly: true}, {Type: MountTypeTmpfs, Target: "/tmp"}}
			if !reflect.DeepEqual(container.Runtime.Mounts, want) {
				t.Fatalf("observed mounts = %+v, want %+v", container.Runtime.Mounts, want)
			}
		})
	}
}

func TestInspectTmpfsDeduplicatesAndRejectsConflicts(t *testing.T) {
	for _, tt := range []struct {
		name, kind, source, options string
		readWrite, reject           bool
	}{
		{name: "same tmpfs", kind: "tmpfs", readWrite: true, options: "rw,size=1048576"},
		{name: "same readonly tmpfs", kind: "tmpfs", options: "ro"},
		{name: "default writable", kind: "tmpfs", readWrite: true},
		{name: "last access option is readonly", kind: "tmpfs", options: "rw,ro"},
		{name: "last access option is writable", kind: "tmpfs", readWrite: true, options: "ro,rw"},
		{name: "access conflict", kind: "tmpfs", readWrite: true, options: "ro", reject: true},
		{name: "type conflict", kind: "bind", source: "/private/secret-path", readWrite: true, reject: true},
		{name: "source conflict", kind: "tmpfs", source: "/private/secret-path", readWrite: true, reject: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			doc := []map[string]any{{"Id": "test", "HostConfig": map[string]any{"Tmpfs": map[string]string{"/tmp": tt.options}},
				"Mounts": []map[string]any{{"Type": tt.kind, "Source": tt.source, "Destination": "/tmp", "RW": tt.readWrite}}}}
			raw, err := json.Marshal(doc)
			if err != nil {
				t.Fatal(err)
			}
			container, err := parseContainerInspect(EngineDocker, raw)
			if tt.reject {
				if err == nil || strings.Contains(err.Error(), "secret-path") {
					t.Fatalf("conflict must fail without leaking paths: %v", err)
				}
				return
			}
			if err != nil || len(container.Runtime.Mounts) != 1 {
				t.Fatalf("duplicate tmpfs was not reconciled: %+v, %v", container.Runtime.Mounts, err)
			}
		})
	}
}

func TestInspectMountDuplicatesAndInvalidTmpfsTargets(t *testing.T) {
	mount := inspectMount{Type: "tmpfs", Destination: "/tmp", RW: true}
	actual, err := inspectContainerMountInputs([]inspectMount{mount, mount}, map[string]string{"/tmp": "rw"})
	if err != nil || len(actual) != 1 {
		t.Fatalf("identical records must produce one mount: %+v, %v", actual, err)
	}
	conflicting := mount
	conflicting.RW = false
	if _, err := inspectContainerMountInputs([]inspectMount{mount, conflicting}, nil); err == nil {
		t.Fatal("conflicting records must be rejected")
	}
	for _, target := range []string{"", "relative", "/tmp\ninvalid", "/tmp\x00invalid"} {
		if _, err := inspectContainerMountInputs(nil, map[string]string{target: "rw"}); err == nil {
			t.Fatal("invalid tmpfs target was accepted")
		}
	}
}
