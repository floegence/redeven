package agentplugins

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
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
	for _, name := range []string{"../escape", "/absolute", "C:/escape", "repo/plugin.json:stream", "repo/a/../../escape", "repo\\escape", strings.Repeat("nested/", 33) + "file"} {
		t.Run(name, func(t *testing.T) {
			_, err := Fetch(t.Context(), githubClient(t, map[string]string{name: "payload"}), Source{Type: "github", Repository: "example/tools", Ref: "stable", Path: "."}, filepath.Join(t.TempDir(), "snapshot"))
			if err == nil {
				t.Fatal("unsafe archive accepted", name)
			}
		})
	}
}
func TestDistributionRejectsPrivateTargetsAndUnsafeRedirects(t *testing.T) {
	client := DistributionHTTP()
	defer client.CloseIdleConnections()
	transport := client.Transport.(*http.Transport)
	if transport.Proxy != nil {
		t.Fatal("distribution must not delegate destination authority to a proxy")
	}
	for _, address := range []string{"127.0.0.1:443", "10.0.0.1:443", "192.168.1.1:443", "169.254.169.254:443", "0.0.0.0:443", "[::1]:443", "[::ffff:127.0.0.1]:443", "[fc00::1]:443", "[fe80::1]:443"} {
		t.Run(address, func(t *testing.T) {
			conn, err := transport.DialContext(t.Context(), "tcp", address)
			if conn != nil {
				conn.Close()
			}
			if err == nil || err.Error() != "distribution address is not public" {
				t.Fatalf("private address was not rejected before dialing: %v", err)
			}
		})
	}
	for _, raw := range []string{"http://example.com/archive", "https://user@example.com/archive"} {
		u, err := url.Parse(raw)
		if err != nil {
			t.Fatal(err)
		}
		if err := client.CheckRedirect(&http.Request{URL: u}, nil); err == nil {
			t.Fatal("unsafe redirect accepted", raw)
		}
	}
	server := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Error("distribution request reached a loopback server")
	}))
	defer server.Close()
	if _, err := get(t.Context(), client, server.URL, MaxConfigBytes); err == nil {
		t.Fatal("loopback distribution download accepted")
	}
}
func TestGitHubFetchCountsDirectoryEntries(t *testing.T) {
	files := make(map[string]string, MaxFiles+1)
	for i := 0; i <= MaxFiles; i++ {
		files[fmt.Sprintf("repo/dir-%04d/", i)] = ""
	}
	dest := filepath.Join(t.TempDir(), "snapshot")
	_, err := Fetch(t.Context(), githubClient(t, files), Source{Type: "github", Repository: "example/tools", Ref: "stable", Path: "."}, dest)
	if err == nil || !strings.Contains(err.Error(), "archive exceeds limits") {
		t.Fatalf("archive directory entries escaped admission limit: %v", err)
	}
	if _, err := os.Stat(dest); !os.IsNotExist(err) {
		t.Fatalf("oversized archive reached snapshot creation: %v", err)
	}
}
func TestGitHubSourceRejectsDriveAndStreamPaths(t *testing.T) {
	for _, path := range []string{"C:/escape", "plugin:stream", "a/../b"} {
		if _, err := (Source{Type: "github", Repository: "example/tools", Path: path}).Normalize(); err == nil {
			t.Fatal("unsafe package path accepted", path)
		}
	}
}
