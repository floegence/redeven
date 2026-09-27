package hostapps

import (
	"compress/gzip"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	nativeapps "github.com/floegence/floe-native-apps"
)

// Reviewed original HTML5 v21 contracts; ancillary resources are synthetic.
func viewerSourceFixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	files := map[string][]byte{}
	for _, name := range []string{"index.html", "js/Client.js", "js/Window.js", "js/Protocol.js", "js/OffscreenDecodeWorker.js"} {
		f, err := os.Open(filepath.Join("testdata/original-client", filepath.Base(name)+".gz"))
		if err != nil {
			t.Fatal(err)
		}
		z, err := gzip.NewReader(f)
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(z)
		z.Close()
		f.Close()
		if err != nil {
			t.Fatal(err)
		}
		files[name] = data
	}
	for _, match := range regexp.MustCompile(`(?:src|href)=["']([^"'<>]+)["']`).FindAllSubmatch(files["index.html"], -1) {
		name := string(match[1])
		if strings.HasPrefix(name, "js/") || strings.HasPrefix(name, "css/") || strings.HasPrefix(name, "icons/") || name == "favicon.png" {
			if _, exists := files[name]; !exists {
				files[name] = []byte("/* fixture resource */")
			}
		}
	}
	files["js/DecodeWorker.js"] = []byte("/* fixture worker */")
	for name, data := range files {
		path := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func viewerFixture(t *testing.T) *nativeapps.PreparedViewer {
	t.Helper()
	viewer, err := nativeapps.PrepareViewer(viewerSourceFixture(t))
	if err != nil {
		t.Fatal(err)
	}
	return viewer
}
