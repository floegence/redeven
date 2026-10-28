package appserver

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/session"
)

func TestServer_TaskFileAuthorizationAndBoundedTransfer(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	state, home := t.TempDir(), t.TempDir()
	state, _ = filepath.EvalSymlinks(state)
	home, _ = filepath.EvalSymlinks(home)
	svc, err := ai.NewService(ai.Options{Logger: logger, StateDir: state, AgentHomeDir: home, Shell: "/bin/sh", Config: appserverTestAIConfig()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	meta := session.Meta{EndpointID: "files-env", NamespacePublicID: "namespace", UserPublicID: "user", CanRead: true, CanWrite: true, CanExecute: true}
	thread, err := svc.CreateThread(t.Context(), &meta, "Files", "", "full_access", home)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = svc.GetTaskFiles(t.Context(), &meta, thread.ThreadID, ""); err != nil {
		t.Fatal(err)
	}
	draft := filepath.Join(state, "task-files", thread.ThreadID, "scratch", "helper.txt")
	if err = os.MkdirAll(filepath.Dir(draft), 0700); err != nil {
		t.Fatal(err)
	}
	content := bytes.Repeat([]byte{0, 1, 128, 255}, 100000)
	final := filepath.Join(home, "report.bin")
	for _, path := range []string{draft, final} {
		if err = os.WriteFile(path, content, 0600); err != nil {
			t.Fatal(err)
		}
	}
	for _, access := range []string{"owner", "foreign", "readonly", "denied"} {
		t.Run(access, func(t *testing.T) {
			current := meta
			switch access {
			case "foreign":
				current.EndpointID = "other"
			case "readonly":
				current.CanWrite = false
				current.CanExecute = false
			case "denied":
				current.CanRead = false
			}
			srv, e := New(Options{Backend: &stubBackend{}, DistFS: fstest.MapFS{"env/index.html": {Data: []byte("env")}, "inject.js": {Data: []byte("void 0")}}, ListenAddr: "127.0.0.1:0", Logger: logger, AIServiceProvider: newStaticAIServiceProvider(svc), ConfigPath: writeTestConfig(t), ResolveSessionMeta: resolveMetaForTest("files-channel", current)})
			if e != nil {
				t.Fatal(e)
			}
			root := "/_redeven_proxy/api/ai/threads/" + thread.ThreadID
			materials := performServerRequest(srv, http.MethodGet, root+"/task-materials", envOriginWithChannel("files-channel"), "")
			if access == "foreign" || access == "denied" {
				if materials.Code == 200 {
					t.Fatal("unauthorized materials")
				}
			} else if materials.Code != 200 || !bytes.Contains(materials.Body.Bytes(), []byte("\"items\":[]")) {
				t.Fatalf("materials %d %s", materials.Code, materials.Body.String())
			}
			for _, kind := range []string{"working", "delivered"} {
				path := final
				if kind == "working" {
					path = draft
				}
				query := url.Values{"path": {path}, "kind": {kind}, "offset": {"0"}}
				response := performServerRequest(srv, http.MethodGet, root+"/task-file-content?"+query.Encode(), envOriginWithChannel("files-channel"), "")
				if access == "foreign" || access == "denied" {
					if response.Code == 200 {
						t.Fatal("unauthorized bytes")
					}
					continue
				}
				if response.Code != 200 {
					t.Fatalf("%d %s", response.Code, response.Body.String())
				}
				var envelope struct {
					Data struct {
						Bytes      []byte
						NextOffset int64
						Size       int64
						Version    string
					}
				}
				var data map[string]json.RawMessage
				if e = json.Unmarshal(response.Body.Bytes(), &data); e != nil {
					t.Fatal(e)
				}
				var chunk map[string]json.RawMessage
				if e = json.Unmarshal(data["data"], &chunk); e != nil {
					t.Fatal(e)
				}
				_ = json.Unmarshal(chunk["bytes"], &envelope.Data.Bytes)
				_ = json.Unmarshal(chunk["next_offset"], &envelope.Data.NextOffset)
				if !bytes.Equal(envelope.Data.Bytes, content[:256<<10]) || envelope.Data.NextOffset != 256<<10 {
					t.Fatal("chunk mismatch")
				}
				query.Set("offset", "-1")
				bad := performServerRequest(srv, http.MethodGet, root+"/task-file-content?"+query.Encode(), envOriginWithChannel("files-channel"), "")
				if bad.Code != 400 {
					t.Fatal("negative offset accepted")
				}
			}
			if access != "owner" {
				response := performServerRequest(srv, http.MethodDelete, root+"/task-files", envOriginWithChannel("files-channel"), "")
				if response.Code == 200 {
					t.Fatal("unauthorized cleanup")
				}
			}
		})
	}
}
