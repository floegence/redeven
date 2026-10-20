package appserver

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/directoryfavorites"
	"github.com/floegence/redeven/internal/session"
)

func TestDirectoryFavoritesAPI(t *testing.T) {
	home := t.TempDir()
	folder := filepath.Join(home, "project")
	if err := os.Mkdir(folder, 0500); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(home, "file.txt")
	if err := os.WriteFile(file, []byte("test"), 0600); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	link := filepath.Join(home, "outside")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	srv, origin := newFSFileTestServer(t, home, session.Meta{NamespacePublicID: "n", EndpointID: "e", UserPublicID: "u", CanRead: true}, nil)
	defer srv.Close()
	store, err := directoryfavorites.Open(filepath.Join(t.TempDir(), "favorites.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	srv.directoryFavorites = store
	provider := &controlledAIServiceProvider{snapshot: AIReadinessSnapshot{State: AIReadinessUnavailable}}
	srv.aiProvider = provider
	const route = "/_redeven_proxy/api/fs/directory_favorites"
	request := func(method, path string) int {
		body, _ := json.Marshal(map[string]string{"path": path})
		return performFSAPIRequest(srv, method, route, origin, string(body)).Code
	}
	if status := request(http.MethodPut, folder); status != 200 {
		t.Fatalf("read-only favorite: %d", status)
	}
	for _, path := range []string{file, link, outside, "relative", filepath.Join(home, "missing")} {
		if status := request(http.MethodPut, path); status == 200 {
			t.Fatalf("accepted invalid directory %q", path)
		}
	}
	if status := performFSAPIRequest(srv, http.MethodPut, route, origin, `{"path":"/","user":"other"}`).Code; status != 400 {
		t.Fatalf("accepted caller identity: %d", status)
	}
	if status := performFSAPIRequest(srv, http.MethodGet, route+"?user=other", origin, "").Code; status != 400 {
		t.Fatalf("accepted scope query: %d", status)
	}
	got := decodeFSAPIEnvelope(t, performFSAPIRequest(srv, http.MethodGet, route, origin, ""))
	var snapshot directoryfavorites.Snapshot
	if err = json.Unmarshal(got.Data, &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Revision != 1 || len(snapshot.Paths) != 1 || snapshot.Paths[0] != folder {
		t.Fatalf("snapshot: %+v", snapshot)
	}
	for _, identity := range []session.Meta{
		{NamespacePublicID: "other", EndpointID: "e", UserPublicID: "u", CanRead: true},
		{NamespacePublicID: "n", EndpointID: "other", UserPublicID: "u", CanRead: true},
		{NamespacePublicID: "n", EndpointID: "e", UserPublicID: "other", CanRead: true},
	} {
		other, otherOrigin := newFSFileTestServer(t, home, identity, nil)
		other.directoryFavorites = store
		response := decodeFSAPIEnvelope(t, performFSAPIRequest(other, http.MethodGet, route, otherOrigin, ""))
		var isolated directoryfavorites.Snapshot
		if err = json.Unmarshal(response.Data, &isolated); err != nil {
			t.Fatal(err)
		}
		if len(isolated.Paths) != 0 || isolated.Revision != 0 {
			t.Fatalf("scope leak: %+v", isolated)
		}
		other.Close()
	}
	alias := filepath.Join(home, "alias")
	if err = os.Symlink(folder, alias); err != nil {
		t.Fatal(err)
	}
	if status := request(http.MethodPut, alias); status != 200 {
		t.Fatalf("allowed symlink: %d", status)
	}
	aliased := decodeFSAPIEnvelope(t, performFSAPIRequest(srv, http.MethodGet, route, origin, ""))
	if err = json.Unmarshal(aliased.Data, &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Revision != 2 || len(snapshot.Paths) != 2 || snapshot.Paths[0] != alias || snapshot.Paths[1] != folder {
		t.Fatalf("logical aliases merged: %+v", snapshot)
	}
	if err = os.Remove(folder); err != nil {
		t.Fatal(err)
	}
	if status := request(http.MethodDelete, folder); status != 200 {
		t.Fatalf("cannot remove missing favorite: %d", status)
	}
	if provider.acquires != 0 {
		t.Fatalf("favorites acquired AI service: %d", provider.acquires)
	}
	denied, deniedOrigin := newFSFileTestServer(t, home, session.Meta{NamespacePublicID: "n", EndpointID: "e", UserPublicID: "u"}, nil)
	defer denied.Close()
	denied.directoryFavorites = store
	if status := performFSAPIRequest(denied, http.MethodGet, route, deniedOrigin, "").Code; status != 403 {
		t.Fatalf("read permission not enforced: %d", status)
	}
}
