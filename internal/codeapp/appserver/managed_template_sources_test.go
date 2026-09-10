package appserver

import (
	"context"
	templatecontract "github.com/floegence/redeven-service-templates/template"
	"github.com/floegence/redeven/internal/managedwebservice"
	"github.com/floegence/redeven/internal/session"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type templateSourceBackendStub struct {
	managedBackendStub
	calls int
	owner string
	token string
}

func (b *templateSourceBackendStub) PreviewTemplateSourceFile(_ context.Context, owner, _, _ string) (*managedwebservice.TemplateSourceFilePreview, error) {
	b.calls++
	b.owner = owner
	return &managedwebservice.TemplateSourceFilePreview{}, nil
}

func (b *templateSourceBackendStub) DiscoverTemplateSources(_ context.Context, req managedwebservice.TemplateSourceDiscoverRequest) (templatecontract.SourceCatalog, error) {
	b.calls++
	b.token = req.Token
	return templatecontract.SourceCatalog{}, nil
}
func (b *templateSourceBackendStub) InspectTemplateSource(_ context.Context, owner string, req managedwebservice.TemplateSourceInspectRequest) (*managedwebservice.TemplateSourcePreview, error) {
	b.calls++
	b.owner = owner
	b.token = req.Token
	return &managedwebservice.TemplateSourcePreview{}, nil
}
func (b *templateSourceBackendStub) ConfirmTemplateSource(_ context.Context, owner string, _ managedwebservice.TemplateSourceConfirmRequest) (*managedwebservice.Template, error) {
	b.calls++
	b.owner = owner
	return &managedwebservice.Template{TemplateID: "git_example"}, nil
}
func (b *templateSourceBackendStub) DiscardTemplateSource(_ context.Context, owner, _ string) error {
	b.calls++
	b.owner = owner
	return nil
}

func TestTemplateSourceRoutesRequireFullPermissionAndKeepCredentialsPrivate(t *testing.T) {
	channel := "ch_sources"
	for _, route := range []string{"source-discovery", "source-previews", "source-confirmations", "source-previews/candidate/file"} {
		backend := &templateSourceBackendStub{}
		server := &Server{managed: backend, resolveSessionMeta: resolveMetaForTest(channel, session.Meta{CanRead: true})}
		request := httptest.NewRequest(http.MethodPost, managedTemplatesAPIBase+"/"+route, strings.NewReader(`{}`))
		request.Header.Set("Origin", envOriginWithChannel(channel))
		response := httptest.NewRecorder()
		server.handleManagedWebServicesAPI(response, request)
		if response.Code != http.StatusForbidden || backend.calls != 0 {
			t.Fatal("read permission authorized template source mutation", route, response.Code)
		}
	}
	backend := &templateSourceBackendStub{}
	server := &Server{managed: backend, resolveSessionMeta: resolveMetaForTest(channel, session.Meta{CanRead: true, CanWrite: true, CanExecute: true, UserPublicID: "source-owner", EndpointID: "environment"})}
	request := httptest.NewRequest(http.MethodPost, managedTemplatesAPIBase+"/source-previews", strings.NewReader(`{"source":{"repository":"owner/repo"},"token":"temporary-source-token"}`))
	request.Header.Set("Origin", envOriginWithChannel(channel))
	response := httptest.NewRecorder()
	server.handleManagedWebServicesAPI(response, request)
	if response.Code != http.StatusOK || backend.calls != 1 || backend.token != "temporary-source-token" || !strings.Contains(backend.owner, "source-owner") {
		t.Fatalf("source route: %d %s", response.Code, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" || strings.Contains(response.Body.String(), "temporary-source-token") {
		t.Fatal("private source acquisition leaked its credential")
	}
	request = httptest.NewRequest(http.MethodPost, managedTemplatesAPIBase+"/source-confirmations", strings.NewReader(`{"request_id":"confirm","token":"must-not-be-accepted"}`))
	request.Header.Set("Origin", envOriginWithChannel(channel))
	response = httptest.NewRecorder()
	server.handleManagedWebServicesAPI(response, request)
	if response.Code != http.StatusBadRequest || backend.calls != 1 {
		t.Fatal("confirmation accepted an unexpected credential field")
	}
}
