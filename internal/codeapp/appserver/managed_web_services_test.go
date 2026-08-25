package appserver

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/managedwebservice"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
	"github.com/floegence/redeven/internal/session"
)

func TestManagedWebServiceRoutesEnforceReadAndLifecyclePermissions(t *testing.T) {
	t.Parallel()
	backend := &managedBackendStub{catalog: []managedwebservice.Template{{TemplateID: managedwebservice.DeepSeekHarnessTemplateID, Version: managedwebservice.DeepSeekHarnessVersion}}}
	channelID := "ch_managed_permissions"

	readServer := &Server{managed: backend, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true})}
	request := httptest.NewRequest(http.MethodGet, managedServicesAPIBase+"/catalog", nil)
	request.Header.Set("Origin", envOriginWithChannel(channelID))
	response := httptest.NewRecorder()
	if !readServer.handleManagedWebServicesAPI(response, request) || response.Code != http.StatusOK {
		t.Fatalf("catalog response status = %d body=%s", response.Code, response.Body.String())
	}

	request = httptest.NewRequest(http.MethodPost, managedServicesAPIBase, strings.NewReader(`{"request_id":"request-install","template_id":"deepseek-harness","deployment":"native","workspace_path":"/workspace"}`))
	request.Header.Set("Origin", envOriginWithChannel(channelID))
	response = httptest.NewRecorder()
	readServer.handleManagedWebServicesAPI(response, request)
	if response.Code != http.StatusForbidden || backend.createCalls != 0 {
		t.Fatalf("read-only install status=%d create_calls=%d", response.Code, backend.createCalls)
	}

	fullServer := &Server{managed: backend, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanWrite: true, CanExecute: true})}
	request = httptest.NewRequest(http.MethodPost, managedServicesAPIBase, strings.NewReader(`{"request_id":"request-install","template_id":"deepseek-harness","deployment":"native","workspace_path":"/workspace"}`))
	request.Header.Set("Origin", envOriginWithChannel(channelID))
	response = httptest.NewRecorder()
	fullServer.handleManagedWebServicesAPI(response, request)
	if response.Code != http.StatusAccepted || backend.createCalls != 1 || backend.lastCreate.WorkspacePath != "/workspace" {
		t.Fatalf("full install status=%d calls=%d request=%+v body=%s", response.Code, backend.createCalls, backend.lastCreate, response.Body.String())
	}

	request = httptest.NewRequest(http.MethodPost, managedServicesAPIBase+"/mws_one/operations", strings.NewReader(`{"request_id":"request-uninstall","action":"uninstall","delete_data":true}`))
	request.Header.Set("Origin", envOriginWithChannel(channelID))
	response = httptest.NewRecorder()
	fullServer.handleManagedWebServicesAPI(response, request)
	if response.Code != http.StatusForbidden || backend.operateCalls != 0 {
		t.Fatalf("non-admin data deletion status=%d operate_calls=%d", response.Code, backend.operateCalls)
	}
}

func TestManagedOperationEventsBeginWithSnapshotAndFinishAtTerminalState(t *testing.T) {
	t.Parallel()
	backend := &managedBackendStub{subscribeOperation: pfregistry.ManagedOperation{OperationID: "mop_one", ServiceID: "mws_one", State: "succeeded", Stage: "completed", ProgressCurrent: 7, ProgressTotal: 7}}
	channelID := "ch_managed_events"
	server := &Server{managed: backend, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true})}
	request := httptest.NewRequest(http.MethodGet, managedOperationsAPIBase+"/mop_one/events", nil)
	request.Header.Set("Origin", envOriginWithChannel(channelID))
	response := httptest.NewRecorder()
	server.handleManagedWebServicesAPI(response, request)
	if response.Code != http.StatusOK || response.Header().Get("Content-Type") != "text/event-stream" {
		t.Fatalf("SSE response status=%d content-type=%q", response.Code, response.Header().Get("Content-Type"))
	}
	body := response.Body.String()
	if !strings.Contains(body, "event: snapshot\n") || !strings.Contains(body, `"state":"succeeded"`) || !strings.Contains(body, `"stage":"completed"`) {
		t.Fatalf("unexpected SSE body: %s", body)
	}
}

func TestManagedWebServiceJSONRejectsUnknownFields(t *testing.T) {
	t.Parallel()
	backend := &managedBackendStub{}
	channelID := "ch_managed_json"
	server := &Server{managed: backend, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanWrite: true, CanExecute: true})}
	request := httptest.NewRequest(http.MethodPost, managedServicesAPIBase, strings.NewReader(`{"request_id":"request-install","template_id":"deepseek-harness","deployment":"native","workspace_path":"/workspace","api_key":"must-not-be-accepted"}`))
	request.Header.Set("Origin", envOriginWithChannel(channelID))
	response := httptest.NewRecorder()
	server.handleManagedWebServicesAPI(response, request)
	if response.Code != http.StatusBadRequest || backend.createCalls != 0 {
		t.Fatalf("unknown-field response status=%d create_calls=%d body=%s", response.Code, backend.createCalls, response.Body.String())
	}
	var envelope apiResp
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil || envelope.ErrorCode != "REQUEST_INVALID" {
		t.Fatalf("unknown-field response = %+v, err=%v", envelope, err)
	}
}

type managedBackendStub struct {
	catalog            []managedwebservice.Template
	createCalls        int
	operateCalls       int
	lastCreate         managedwebservice.CreateRequest
	subscribeOperation pfregistry.ManagedOperation
}

func (b *managedBackendStub) Catalog(context.Context) ([]managedwebservice.Template, error) {
	return append([]managedwebservice.Template(nil), b.catalog...), nil
}
func (b *managedBackendStub) List(context.Context) ([]managedwebservice.ServiceView, error) {
	return []managedwebservice.ServiceView{}, nil
}
func (b *managedBackendStub) Create(_ context.Context, request managedwebservice.CreateRequest) (*managedwebservice.CreateResult, error) {
	b.createCalls++
	b.lastCreate = request
	return &managedwebservice.CreateResult{Service: pfregistry.ManagedService{ServiceID: "mws_one"}, Operation: pfregistry.ManagedOperation{OperationID: "mop_one", ServiceID: "mws_one", State: "pending"}}, nil
}
func (b *managedBackendStub) Operate(_ context.Context, serviceID string, request managedwebservice.OperationRequest) (*pfregistry.ManagedOperation, error) {
	b.operateCalls++
	return &pfregistry.ManagedOperation{OperationID: "mop_operation", ServiceID: serviceID, Action: string(request.Action), State: "pending"}, nil
}
func (b *managedBackendStub) Cancel(context.Context, string) (*pfregistry.ManagedOperation, error) {
	return &pfregistry.ManagedOperation{}, nil
}
func (b *managedBackendStub) Operation(context.Context, string) (*pfregistry.ManagedOperation, error) {
	return &pfregistry.ManagedOperation{}, nil
}
func (b *managedBackendStub) Subscribe(string) (<-chan pfregistry.ManagedOperation, func(), error) {
	events := make(chan pfregistry.ManagedOperation, 1)
	events <- b.subscribeOperation
	return events, func() {}, nil
}
func (b *managedBackendStub) Logs(context.Context, string, int) (*managedwebservice.LogResult, error) {
	return &managedwebservice.LogResult{}, nil
}
