package main

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestVersionRequiresNoStateAndReportsBuildIdentity(t *testing.T) {
	for _, arg := range []string{"version", "--version"} {
		var output bytes.Buffer
		if err := runWithOutput([]string{arg}, &output); err != nil {
			t.Fatal(err)
		}
		var actual map[string]string
		if err := json.Unmarshal(output.Bytes(), &actual); err != nil {
			t.Fatal(err)
		}
		if len(actual) != 3 || actual["version"] != Version || actual["commit"] != Commit || actual["build_time"] != BuildTime {
			t.Fatalf("Unexpected build identity: %v", actual)
		}
	}
	if err := runWithOutput([]string{"version", "serve"}, &bytes.Buffer{}); err == nil {
		t.Fatal("Version must reject extra arguments")
	}
}
