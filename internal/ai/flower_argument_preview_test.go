package ai

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	fltools "github.com/floegence/floret/v7/tools"
)

func TestFlowerArgumentPreviewChunkBoundaries(t *testing.T) {
	integer := func(n int) *int { return &n }
	for _, test := range []struct {
		name, tool, raw string
		want            *fltools.ArgumentPreview
	}{
		{"write", "file.write", `{"file_path":"/missing/a.txt","content":"a\r\nb\n"}`, &fltools.ArgumentPreview{DisplayName: "a.txt", Additions: integer(2)}},
		{"empty", "file.write", `{"content":""}`, &fltools.ArgumentPreview{Additions: integer(0)}},
		{"unicode", "file.write", `{"content":"\u4e2d\ud83d\ude00\n中文😀","ignored":[true,null,{"content":"ignored"}]}`, &fltools.ArgumentPreview{Additions: integer(2)}},
		{"edit", "file.edit", `{"old_string":"same\r\nold\r\ntail\n","new_string":"same\r\nnew\r\ntail\n","replace_all":true}`, &fltools.ArgumentPreview{Additions: integer(1), Deletions: integer(1)}},
		{"noop", "file.edit", `{"new_string":"same","old_string":"same"}`, &fltools.ArgumentPreview{Additions: integer(0), Deletions: integer(0)}},
		{"escaped", "file.write", `{"content":"quote: \" / \\ \t \b \f \r"}`, &fltools.ArgumentPreview{Additions: integer(1)}},
	} {
		t.Run(test.name, func(t *testing.T) {
			for split := 0; split <= len(test.raw); split++ {
				parse := flowerArgumentPreviewFactory(test.tool)()
				if _, err := parse(test.raw[:split], false); err != nil {
					t.Fatalf("split %d: %v", split, err)
				}
				got, err := parse(test.raw[split:], true)
				if err != nil || !reflect.DeepEqual(got, test.want) {
					t.Fatalf("split %d: got %#v, %v; want %#v", split, got, err, test.want)
				}
			}
			parse := flowerArgumentPreviewFactory(test.tool)()
			for i := range len(test.raw) {
				got, err := parse(test.raw[i:i+1], i == len(test.raw)-1)
				if err != nil {
					t.Fatalf("byte %d: %v", i, err)
				}
				if i == len(test.raw)-1 && !reflect.DeepEqual(got, test.want) {
					t.Fatalf("bytewise got %#v; want %#v", got, test.want)
				}
			}
		})
	}
}

func TestFlowerArgumentPreviewPatchFormats(t *testing.T) {
	for _, patch := range []string{
		"*** Begin Patch\n*** Update File: missing.txt\n--- header-like content\n+++ header-like content\n context\n*** Add File: second.txt\n+\n+text\n*** End Patch",
		"diff --git a/missing.txt b/missing.txt\r\n--- a/missing.txt\r\n+++ b/missing.txt\r\n@@ -1,2 +1,2 @@\r\n--- header-like content\r\n+++ header-like content\r\n context\r\ndiff --git a/second.txt b/second.txt\r\n--- /dev/null\r\n+++ b/second.txt\r\n@@ -0,0 +1,2 @@\r\n+\r\n+text",
	} {
		raw, _ := json.Marshal(map[string]string{"patch": patch})
		parse := flowerArgumentPreviewFactory("apply_patch")()
		for i := range len(raw) {
			got, err := parse(string(raw[i:i+1]), i == len(raw)-1)
			if err != nil {
				t.Fatal(err)
			}
			if i == len(raw)-1 && (got.Additions == nil || *got.Additions != 3 || got.Deletions == nil || *got.Deletions != 1) {
				t.Fatalf("counts %#v", got)
			}
		}
	}
}

func TestFlowerArgumentPreviewPartialAndIsolation(t *testing.T) {
	first, second := flowerArgumentPreviewFactory("file.edit")(), flowerArgumentPreviewFactory("file.write")()
	got, err := first(`{"old_string":"a\nb`, false)
	if err != nil || got.Deletions == nil || *got.Deletions != 2 || got.Additions != nil {
		t.Fatalf("partial %#v %v", got, err)
	}
	other, err := second(`{"content":"one"}`, true)
	if err != nil || other.Additions == nil || *other.Additions != 1 || other.Deletions != nil {
		t.Fatalf("independent %#v %v", other, err)
	}
	got, err = first(`","new_string":"a\nc"}`, true)
	if err != nil || *got.Additions != 1 || *got.Deletions != 1 {
		t.Fatalf("complete %#v %v", got, err)
	}
	if flowerArgumentPreviewFactory("file.read") != nil {
		t.Fatal("read tool must not register a mutation preview")
	}
}

func TestFlowerArgumentPreviewRejectsMalformedAndBoundedInput(t *testing.T) {
	for _, raw := range []string{
		`{"content":"a","content":"b"}`, `{"content":1}`, `{"content":"bad\q"}`,
		`{"content":"\ud800x"}`, `{"content":"\udc00"}`, `{"content":"open`,
		`{"content":"ok",}`, `{"content":"ok"} false`, `{"ignored":[1,]}`, `[]`,
		`{"content":"` + strings.Repeat("x", maxFlowerArgumentPreviewBytes) + `"}`,
		`{"ignored":` + strings.Repeat("[", 65) + strings.Repeat("]", 65) + `}`,
	} {
		if _, err := flowerArgumentPreviewFactory("file.write")()(raw, true); err == nil {
			t.Fatalf("accepted malformed input %.80q", raw)
		}
	}
}
