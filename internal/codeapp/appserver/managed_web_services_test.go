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
	backend := &managedBackendStub{catalog: []managedwebservice.Template{{TemplateID: managedwebservice.DeepSeekHarnessHostTemplateID, Version: managedwebservice.DeepSeekHarnessVersion}}}
	channelID := "ch_managed_permissions"

	readServer := &Server{managed: backend, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true})}
	request := httptest.NewRequest(http.MethodGet, managedServicesAPIBase+"/catalog", nil)
	request.Header.Set("Origin", envOriginWithChannel(channelID))
	response := httptest.NewRecorder()
	if !readServer.handleManagedWebServicesAPI(response, request) || response.Code != http.StatusOK {
		t.Fatalf("catalog response status = %d body=%s", response.Code, response.Body.String())
	}

	request = httptest.NewRequest(http.MethodPost, managedServicesAPIBase, strings.NewReader(`{"request_id":"request-install","template_id":"deepseek-harness-host","deployment":"native","workspace_path":"/workspace"}`))
	request.Header.Set("Origin", envOriginWithChannel(channelID))
	response = httptest.NewRecorder()
	readServer.handleManagedWebServicesAPI(response, request)
	if response.Code != http.StatusForbidden || backend.createCalls != 0 {
		t.Fatalf("read-only install status=%d create_calls=%d", response.Code, backend.createCalls)
	}

	fullServer := &Server{managed: backend, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanWrite: true, CanExecute: true})}
	request = httptest.NewRequest(http.MethodPost, managedServicesAPIBase, strings.NewReader(`{"request_id":"request-install","template_id":"deepseek-harness-host","deployment":"native","workspace_path":"/workspace"}`))
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

func TestManagedWebServiceRoutesCarryNoticeRevisionsForInstallAndUpdate(t *testing.T) {
	t.Parallel()
	backend := &managedBackendStub{}
	channelID := "ch_managed_notices"
	server := &Server{managed: backend, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanWrite: true, CanExecute: true})}

	request := httptest.NewRequest(http.MethodPost, managedServicesAPIBase, strings.NewReader(`{"request_id":"request-install","template_id":"linuxserver-webtop-ubuntu-kde","deployment":"container","workspace_path":"/workspace","accepted_notice_revisions":{"interactive-desktop-root-and-network":1}}`))
	request.Header.Set("Origin", envOriginWithChannel(channelID))
	response := httptest.NewRecorder()
	server.handleManagedWebServicesAPI(response, request)
	if response.Code != http.StatusAccepted || backend.lastCreate.AcceptedNoticeRevisions["interactive-desktop-root-and-network"] != 1 {
		t.Fatalf("install notice request=%+v status=%d body=%s", backend.lastCreate, response.Code, response.Body.String())
	}

	request = httptest.NewRequest(http.MethodPost, managedServicesAPIBase+"/mws_one/operations", strings.NewReader(`{"request_id":"request-update","action":"update","accepted_notice_revisions":{"interactive-desktop-root-and-network":2}}`))
	request.Header.Set("Origin", envOriginWithChannel(channelID))
	response = httptest.NewRecorder()
	server.handleManagedWebServicesAPI(response, request)
	if response.Code != http.StatusAccepted || backend.lastOperate.Action != managedwebservice.ActionUpdate || backend.lastOperate.AcceptedNoticeRevisions["interactive-desktop-root-and-network"] != 2 {
		t.Fatalf("update notice request=%+v status=%d body=%s", backend.lastOperate, response.Code, response.Body.String())
	}
}

func TestManagedWebServiceSettingsAndReconfigureUseOnePermissionBoundary(t *testing.T) {
	t.Parallel()
	backend := &managedBackendStub{}
	channelID := "ch_managed_settings"
	readServer := &Server{managed: backend, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true})}

	request := httptest.NewRequest(http.MethodGet, managedServicesAPIBase+"/mws_one/settings", nil)
	request.Header.Set("Origin", envOriginWithChannel(channelID))
	response := httptest.NewRecorder()
	readServer.handleManagedWebServicesAPI(response, request)
	if response.Code != http.StatusOK || backend.settingsCalls != 1 {
		t.Fatalf("settings read status=%d calls=%d body=%s", response.Code, backend.settingsCalls, response.Body.String())
	}

	request = httptest.NewRequest(http.MethodPatch, managedServicesAPIBase+"/mws_one/settings", strings.NewReader(`{"name":"Renamed","description":"Notes","access_mode":"unified_proxy"}`))
	request.Header.Set("Origin", envOriginWithChannel(channelID))
	response = httptest.NewRecorder()
	readServer.handleManagedWebServicesAPI(response, request)
	if response.Code != http.StatusForbidden || backend.lastMetadata.Name != "" {
		t.Fatalf("read-only settings write status=%d metadata=%+v", response.Code, backend.lastMetadata)
	}

	adminServer := &Server{managed: backend, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true})}
	request = httptest.NewRequest(http.MethodPost, managedServicesAPIBase+"/mws_one/reconfigure/preflight", strings.NewReader(`{"configuration_revision":3,"parameters":{},"runtime":{}}`))
	request.Header.Set("Origin", envOriginWithChannel(channelID))
	response = httptest.NewRecorder()
	adminServer.handleManagedWebServicesAPI(response, request)
	if response.Code != http.StatusOK || backend.preflightCalls != 1 || backend.lastDraft.ConfigurationRevision != 3 {
		t.Fatalf("preflight status=%d calls=%d draft=%+v body=%s", response.Code, backend.preflightCalls, backend.lastDraft, response.Body.String())
	}

	request = httptest.NewRequest(http.MethodPost, managedServicesAPIBase+"/mws_one/operations", strings.NewReader(`{"request_id":"request-reconfigure","action":"reconfigure","reconfigure":{"draft":{"configuration_revision":3,"parameters":{},"runtime":{}},"plan_digest":"plan","accepted_risk_ids":["devices"]}}`))
	request.Header.Set("Origin", envOriginWithChannel(channelID))
	response = httptest.NewRecorder()
	adminServer.handleManagedWebServicesAPI(response, request)
	if response.Code != http.StatusAccepted || backend.lastOperate.Reconfigure == nil || !backend.lastOperate.Reconfigure.Administrator {
		t.Fatalf("reconfigure status=%d request=%+v body=%s", response.Code, backend.lastOperate, response.Body.String())
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
	request := httptest.NewRequest(http.MethodPost, managedServicesAPIBase, strings.NewReader(`{"request_id":"request-install","template_id":"deepseek-harness-host","deployment":"native","workspace_path":"/workspace","api_key":"must-not-be-accepted"}`))
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

func TestManagedTemplateDuplicateRequiresLifecyclePermission(t *testing.T) {
	t.Parallel()
	backend := &managedBackendStub{}
	channelID := "ch_managed_template_duplicate"
	requestBody := `{"request_id":"request-template-copy","name":"Preview copy"}`

	readServer := &Server{managed: backend, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true})}
	request := httptest.NewRequest(http.MethodPost, managedTemplatesAPIBase+"/tmpl_source/duplicate", strings.NewReader(requestBody))
	request.Header.Set("Origin", envOriginWithChannel(channelID))
	response := httptest.NewRecorder()
	readServer.handleManagedWebServicesAPI(response, request)
	if response.Code != http.StatusForbidden || backend.duplicateCalls != 0 {
		t.Fatalf("read-only duplicate status=%d calls=%d", response.Code, backend.duplicateCalls)
	}

	fullServer := &Server{managed: backend, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanWrite: true, CanExecute: true})}
	request = httptest.NewRequest(http.MethodPost, managedTemplatesAPIBase+"/tmpl_source/duplicate", strings.NewReader(requestBody))
	request.Header.Set("Origin", envOriginWithChannel(channelID))
	response = httptest.NewRecorder()
	fullServer.handleManagedWebServicesAPI(response, request)
	if response.Code != http.StatusCreated || backend.duplicateCalls != 1 || backend.lastDuplicate.Name != "Preview copy" {
		t.Fatalf("full duplicate status=%d calls=%d request=%+v body=%s", response.Code, backend.duplicateCalls, backend.lastDuplicate, response.Body.String())
	}
}

type managedBackendStub struct {
	catalog            []managedwebservice.Template
	createCalls        int
	operateCalls       int
	lastCreate         managedwebservice.CreateRequest
	lastOperate        managedwebservice.OperationRequest
	duplicateCalls     int
	lastDuplicate      managedwebservice.TemplateDuplicateRequest
	subscribeOperation pfregistry.ManagedOperation
	settingsCalls      int
	preflightCalls     int
	lastMetadata       managedwebservice.ServiceMetadataPatch
	lastDraft          managedwebservice.ReconfigureDraft
}

func (b *managedBackendStub) Catalog(context.Context) ([]managedwebservice.Template, error) {
	return append([]managedwebservice.Template(nil), b.catalog...), nil
}
func (b *managedBackendStub) Template(_ context.Context, templateID string) (*managedwebservice.Template, error) {
	for i := range b.catalog {
		if b.catalog[i].TemplateID == templateID {
			copy := b.catalog[i]
			return &copy, nil
		}
	}
	return nil, managedwebserviceTestError("TEMPLATE_NOT_FOUND", http.StatusNotFound)
}
func (b *managedBackendStub) CreateTemplate(_ context.Context, request managedwebservice.TemplateWriteRequest) (*managedwebservice.Template, error) {
	return &managedwebservice.Template{TemplateID: "tmpl_created", Name: request.Name, Deployment: request.Spec.Kind, Revision: 1}, nil
}
func (b *managedBackendStub) UpdateTemplate(_ context.Context, templateID string, request managedwebservice.TemplateWriteRequest) (*managedwebservice.Template, error) {
	return &managedwebservice.Template{TemplateID: templateID, Name: request.Name, Deployment: request.Spec.Kind, Revision: 2}, nil
}
func (b *managedBackendStub) DeleteTemplate(context.Context, string) error { return nil }
func (b *managedBackendStub) DuplicateTemplate(_ context.Context, _ string, request managedwebservice.TemplateDuplicateRequest) (*managedwebservice.Template, error) {
	b.duplicateCalls++
	b.lastDuplicate = request
	return &managedwebservice.Template{TemplateID: "tmpl_copy", Name: request.Name, Revision: 1}, nil
}
func (b *managedBackendStub) ValidateTemplate(context.Context, managedwebservice.TemplateWriteRequest) error {
	return nil
}
func (b *managedBackendStub) List(context.Context) ([]managedwebservice.ServiceView, error) {
	return []managedwebservice.ServiceView{}, nil
}
func (b *managedBackendStub) Settings(_ context.Context, serviceID string) (*managedwebservice.ServiceSettingsView, error) {
	b.settingsCalls++
	return &managedwebservice.ServiceSettingsView{ServiceID: serviceID, Name: "Service", ConfigurationRevision: 1}, nil
}
func (b *managedBackendStub) UpdateSettings(_ context.Context, serviceID string, patch managedwebservice.ServiceMetadataPatch) (*managedwebservice.ServiceSettingsView, error) {
	b.settingsCalls++
	b.lastMetadata = patch
	return &managedwebservice.ServiceSettingsView{ServiceID: serviceID, Name: patch.Name, Description: patch.Description, AccessMode: patch.AccessMode, ConfigurationRevision: 1}, nil
}
func (b *managedBackendStub) PreflightReconfigure(_ context.Context, _ string, draft managedwebservice.ReconfigureDraft) (*managedwebservice.ReconfigurePlan, error) {
	b.preflightCalls++
	b.lastDraft = draft
	return &managedwebservice.ReconfigurePlan{ConfigurationRevision: draft.ConfigurationRevision, PlanDigest: "plan"}, nil
}
func (b *managedBackendStub) Create(_ context.Context, request managedwebservice.CreateRequest) (*managedwebservice.CreateResult, error) {
	b.createCalls++
	b.lastCreate = request
	return &managedwebservice.CreateResult{Service: pfregistry.ManagedService{ServiceID: "mws_one"}, Operation: pfregistry.ManagedOperation{OperationID: "mop_one", ServiceID: "mws_one", State: "pending"}}, nil
}
func (b *managedBackendStub) Operate(_ context.Context, serviceID string, request managedwebservice.OperationRequest) (*pfregistry.ManagedOperation, error) {
	b.operateCalls++
	b.lastOperate = request
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

func managedwebserviceTestError(code string, status int) error {
	return &managedwebservice.Error{Code: code, Message: code, HTTPStatus: status}
}
