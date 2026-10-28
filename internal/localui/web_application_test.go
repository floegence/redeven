package localui

import (
	"context"
	"github.com/floegence/redeven/internal/webbinding"
	"net/http/httptest"
	"testing"
)

func TestWebApplicationArtifactCannotCrossParentOrSibling(t *testing.T) {
	lease := &webbinding.Lease{Context: context.Background(), Binding: webbinding.Binding{ID: "binding", Revision: 1}}
	ctx := context.WithValue(lease.Context, webEntryKey{}, lease)
	ctx = context.WithValue(ctx, webDeviceKey{}, "device")
	ctx = context.WithValue(ctx, webAdmissionKey{}, "session")
	parent := httptest.NewRequest("POST", "https://env.example.test/", nil).WithContext(ctx)
	child := parent.WithContext(context.WithValue(ctx, webApplicationKey{}, "pf:one"))
	sibling := parent.WithContext(context.WithValue(ctx, webApplicationKey{}, "pf:two"))
	scope := webArtifactScope(child)
	if webEntryScope(child) != webEntryScope(parent) {
		t.Fatal("Runtime login was duplicated for child")
	}
	if !webAuthorizationMatches(child.Context(), scope, "session") || webAuthorizationMatches(parent.Context(), scope, "session") || webAuthorizationMatches(sibling.Context(), scope, "session") {
		t.Fatal("resource artifact escaped scope")
	}
}
