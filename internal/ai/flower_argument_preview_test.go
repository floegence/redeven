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

func TestFlowerArgumentPreviewNamesArriveBeforeArgumentsComplete(t *testing.T) {
	for _, tool := range []string{"file.edit", "file.write"} {
		t.Run(tool, func(t *testing.T) {
			parse := flowerArgumentPreviewFactory(tool)()
			preview, err := parse(`{"file_path":"src/exam`, false)
			if err != nil || preview.DisplayName != "" {
				t.Fatalf("incomplete path: %#v, %v", preview, err)
			}
			preview, err = parse(`ple.ts",`, false)
			if err != nil || preview.DisplayName != "example.ts" {
				t.Fatalf("complete path before body: %#v, %v", preview, err)
			}
		})
	}
}

func TestFlowerArgumentPreviewPatchNamesStreamFromCompleteHeaders(t *testing.T) {
	parse := flowerArgumentPreviewFactory("apply_patch")()
	for _, step := range []struct{ delta, name string }{
		{`{"patch":"*** Begin Patch\n*** Update File: src/exam`, ""},
		{`ple.ts\n@@\n-old\n+new`, "example.ts"},
		{`\n*** Add File: src/second.ts`, "example.ts"},
		{`\n+second`, "example.ts, second.ts"},
		{`\n*** Delete File: src/removed.ts\n`, "example.ts, second.ts, removed.ts"},
		{`*** End Patch"}`, "example.ts, second.ts, removed.ts"},
	} {
		preview, err := parse(step.delta, false)
		if err != nil || preview.DisplayName != step.name {
			t.Fatalf("delta %q: %#v, %v; want %q", step.delta, preview, err, step.name)
		}
	}
}

func TestFlowerArgumentPreviewPatchNamesRespectPatchStructure(t *testing.T) {
	for _, test := range []struct{ name, patch, want string }{
		{"move", "*** Begin Patch\n*** Update File: src/old.ts\n*** Move to: src/new.ts\n@@\n-old\n+new\n*** End Patch", "old.ts → new.ts"},
		{"body and duplicates", "*** Begin Patch\n*** Add File: src/real.ts\n+*** Update File: fake.ts\n+*** Delete File: fake.ts\n*** Update File: src/real.ts\n@@\n-old\n+new\n*** End Patch", "real.ts"},
		{"unicode", "*** Begin Patch\r\n*** Delete File: src/中文😀.ts\r\n*** End Patch", "中文😀.ts"},
		{"no canonical envelope", "*** Update File: fake.ts\n+text", ""},
		{"after end", "*** Begin Patch\n*** Delete File: real.ts\n*** End Patch\n*** Delete File: fake.ts\n", "real.ts"},
		{"invalid path", "*** Begin Patch\n*** Update File: ../outside.ts\n*** Add File: /absolute.ts\n+text\n*** End Patch", ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw, _ := json.Marshal(map[string]string{"patch": test.patch})
			parse := flowerArgumentPreviewFactory("apply_patch")()
			for i := range len(raw) {
				preview, err := parse(string(raw[i:i+1]), i == len(raw)-1)
				if err != nil {
					t.Fatal(err)
				}
				if i == len(raw)-1 && preview.DisplayName != test.want {
					t.Fatalf("got %q; want %q", preview.DisplayName, test.want)
				}
			}
		})
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

func TestFlowerArgumentPreviewPatchNamesStayBounded(t *testing.T) {
	var patch strings.Builder
	patch.WriteString("*** Begin Patch\n")
	for i := range 1000 {
		patch.WriteString("*** Delete File: src/" + strings.Repeat("x", i+1) + ".ts\n")
	}
	patch.WriteString("*** End Patch")
	raw, _ := json.Marshal(map[string]string{"patch": patch.String()})
	preview, err := flowerArgumentPreviewFactory("apply_patch")()(string(raw), true)
	if err != nil || len([]rune(preview.DisplayName)) > 200 || !strings.HasSuffix(preview.DisplayName, "…") {
		t.Fatalf("unbounded display name: %#v, %v", preview, err)
	}
}
