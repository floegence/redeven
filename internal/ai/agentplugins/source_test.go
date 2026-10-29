package agentplugins

import (
	"archive/zip"
	"bytes"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func githubClient(t *testing.T, files map[string]string) *http.Client {
	t.Helper()
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	for name, body := range files {
		file, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = io.WriteString(file, body); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return &http.Client{Transport: updateTransport(func(r *http.Request) (*http.Response, error) {
		var body []byte
		switch r.URL.Path {
		case "/repos/example/tools/commits/stable":
			body = []byte("{\"sha\":\"" + strings.Repeat("a", 40) + "\"}")
		case "/repos/example/tools/zipball/" + strings.Repeat("a", 40):
			body = archive.Bytes()
		default:
			t.Errorf("unexpected distribution request: %s", r.URL)
			return nil, io.ErrUnexpectedEOF
		}
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(bytes.NewReader(body))}, nil
	})}
}
func TestGitHubFetchPinsCommitAndSelectsPackage(t *testing.T) {
	client := githubClient(t, map[string]string{"repo-hash/plugins/review/plugin.json": "{\"$schema\":\"" + ManifestSchema + "\",\"name\":\"review\"}", "repo-hash/README.md": "repository"})
	dest := filepath.Join(t.TempDir(), "snapshot")
	source, err := Fetch(t.Context(), client, Source{Type: "github", Repository: "example/tools", Ref: "stable", Path: "plugins/review"}, dest)
	if err != nil || source.Commit != strings.Repeat("a", 40) {
		t.Fatal(source, err)
	}
	pkg, err := Load(dest)
	if err != nil || pkg.Manifest.Name != "review" {
		t.Fatal(pkg, err)
	}
	if _, err = os.Stat(filepath.Join(dest, "README.md")); !os.IsNotExist(err) {
		t.Fatal("repository files escaped package selection", err)
	}
}
func TestGitHubFetchRejectsUnsafeArchives(t *testing.T) {
	for _, name := range []string{"../escape", "/absolute", "C:/escape", "repo/plugin.json:stream", "repo/a/../../escape", "repo\\escape"} {
		t.Run(name, func(t *testing.T) {
			_, err := Fetch(t.Context(), githubClient(t, map[string]string{name: "payload"}), Source{Type: "github", Repository: "example/tools", Ref: "stable", Path: "."}, filepath.Join(t.TempDir(), "snapshot"))
			if err == nil {
				t.Fatal("unsafe archive accepted", name)
			}
		})
	}
}
func TestGitHubSourceRejectsDriveAndStreamPaths(t *testing.T) {
	for _, path := range []string{"C:/escape", "plugin:stream", "a/../b"} {
		if _, err := (Source{Type: "github", Repository: "example/tools", Path: path}).Normalize(); err == nil {
			t.Fatal("unsafe package path accepted", path)
		}
	}
}
