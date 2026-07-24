package redevpluginintegration

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionhop"
	redevpluginartifacts "github.com/floegence/redeven/spec/redevplugin"
	"github.com/floegence/redevplugin/pkg/host"
	"github.com/floegence/redevplugin/pkg/pluginpkg"
	"github.com/floegence/redevplugin/pkg/registry"
)

type externalPackageCommitHTTPResult struct {
	Status  string                             `json:"status"`
	Receipt *host.ExternalPackageCommitReceipt `json:"receipt"`
	Plugin  *struct {
		PluginInstanceID    string                                  `json:"plugin_instance_id"`
		EnableState         registry.EnableState                    `json:"enable_state"`
		SignatureAssessment host.ExternalPackageSignatureAssessment `json:"signature_assessment"`
		ExecutionApproval   host.ExternalPackageExecutionApproval   `json:"execution_approval"`
		UpdateEligibility   host.ExternalPackageUpdateEligibility   `json:"update_eligibility"`
	} `json:"plugin"`
}

func TestExternalPackageUploadInspectCommitAndQueryThroughHTTP(t *testing.T) {
	integration, _, unsignedPackage, access := newExternalPackageTestIntegration(t)
	t.Cleanup(func() { _ = integration.Close() })
	uploadRequest := trustedExternalPackageRequest(t, http.MethodPost,
		"/_redevplugin/api/plugins/external-packages/upload/inspect", bytes.NewReader(unsignedPackage))
	uploadRequest.Header.Set("Content-Type", "application/vnd.redevplugin.package+zip")
	uploadResponse := httptest.NewRecorder()
	integration.Handler().ServeHTTP(uploadResponse, uploadRequest)
	if uploadResponse.Code != http.StatusOK {
		t.Fatalf("inspect upload status = %d body=%s", uploadResponse.Code, uploadResponse.Body.String())
	}
	var inspectionEnvelope struct {
		OK   bool                           `json:"ok"`
		Data host.ExternalPackageInspection `json:"data"`
	}
	if err := json.Unmarshal(uploadResponse.Body.Bytes(), &inspectionEnvelope); err != nil {
		t.Fatalf("decode inspection: %v body=%s", err, uploadResponse.Body.String())
	}
	inspection := inspectionEnvelope.Data
	if !inspectionEnvelope.OK || inspection.InspectionID == "" || inspection.ConfirmationDigest == "" ||
		inspection.SignatureAssessment.State != string(registry.SignatureAbsent) ||
		inspection.SourceProvenance.Kind != string(registry.PackageSourcePackageUpload) {
		t.Fatalf("inspection = %#v", inspection)
	}

	commitBody, err := json.Marshal(map[string]string{
		"inspection_id":       inspection.InspectionID,
		"confirmation_digest": inspection.ConfirmationDigest,
	})
	if err != nil {
		t.Fatal(err)
	}
	commitRequest := trustedExternalPackageRequest(t, http.MethodPost,
		"/_redevplugin/api/plugins/external-packages/commit", bytes.NewReader(commitBody))
	commitRequest.Header.Set("Content-Type", "application/json")
	commitResponse := httptest.NewRecorder()
	integration.Handler().ServeHTTP(commitResponse, commitRequest)
	if commitResponse.Code != http.StatusOK {
		t.Fatalf("commit upload status = %d body=%s", commitResponse.Code, commitResponse.Body.String())
	}
	var commitEnvelope struct {
		OK   bool                            `json:"ok"`
		Data externalPackageCommitHTTPResult `json:"data"`
	}
	if err := json.Unmarshal(commitResponse.Body.Bytes(), &commitEnvelope); err != nil {
		t.Fatalf("decode commit: %v body=%s", err, commitResponse.Body.String())
	}
	if !commitEnvelope.OK || commitEnvelope.Data.Status != string(registry.ExternalPackageCommitted) || commitEnvelope.Data.Receipt == nil ||
		commitEnvelope.Data.Plugin == nil || commitEnvelope.Data.Plugin.PluginInstanceID == "" ||
		commitEnvelope.Data.Plugin.EnableState != registry.EnableDisabled ||
		commitEnvelope.Data.Plugin.SignatureAssessment.State != string(registry.SignatureAbsent) ||
		commitEnvelope.Data.Plugin.ExecutionApproval.State != string(registry.ExecutionApprovalUserApproved) ||
		commitEnvelope.Data.Plugin.UpdateEligibility.State != string(registry.UpdateManualOnly) {
		t.Fatalf("commit = %#v", commitEnvelope.Data)
	}

	queryBody, err := json.Marshal(map[string]string{
		"inspection_id": inspection.InspectionID,
		"commit_id":     commitEnvelope.Data.Receipt.CommitID,
	})
	if err != nil {
		t.Fatal(err)
	}
	access.set(sessionPermissions{read: true})
	queryRequest := trustedExternalPackageRequest(t, http.MethodPost,
		"/_redevplugin/api/plugins/external-packages/commit/query", bytes.NewReader(queryBody))
	queryRequest.Header.Set("Content-Type", "application/json")
	queryResponse := httptest.NewRecorder()
	integration.Handler().ServeHTTP(queryResponse, queryRequest)
	if queryResponse.Code != http.StatusOK {
		t.Fatalf("query commit status = %d body=%s", queryResponse.Code, queryResponse.Body.String())
	}

	pluginID := commitEnvelope.Data.Plugin.PluginInstanceID
	permissionsResponse := postExternalPackageJSON(t, integration,
		"/_redevplugin/api/plugins/permissions/query", map[string]any{
			"plugin_instance_id": pluginID,
			"active_only":        true,
		})
	var permissionsEnvelope struct {
		OK   bool `json:"ok"`
		Data struct {
			Permissions []json.RawMessage `json:"permissions"`
		} `json:"data"`
	}
	if err := json.Unmarshal(permissionsResponse.Body.Bytes(), &permissionsEnvelope); err != nil {
		t.Fatalf("decode permissions: %v body=%s", err, permissionsResponse.Body.String())
	}
	if permissionsResponse.Code != http.StatusOK || !permissionsEnvelope.OK || len(permissionsEnvelope.Data.Permissions) != 0 {
		t.Fatalf("unsigned install permissions status=%d response=%#v", permissionsResponse.Code, permissionsEnvelope)
	}

	requirementsResponse := postExternalPackageJSON(t, integration,
		"/_redevplugin/api/plugins/permissions/requirements/query", map[string]any{
			"plugin_instance_id": pluginID,
		})
	var requirementsEnvelope struct {
		OK   bool                              `json:"ok"`
		Data host.PermissionRequirementsResult `json:"data"`
	}
	if err := json.Unmarshal(requirementsResponse.Body.Bytes(), &requirementsEnvelope); err != nil {
		t.Fatalf("decode permission requirements: %v body=%s", err, requirementsResponse.Body.String())
	}
	if requirementsResponse.Code != http.StatusOK || !requirementsEnvelope.OK ||
		requirementsEnvelope.Data.PluginInstanceID != pluginID ||
		len(requirementsEnvelope.Data.RequiredPermissions) == 0 {
		t.Fatalf("permission requirements status=%d response=%#v", requirementsResponse.Code, requirementsEnvelope)
	}
}

func TestContainersCatalogPackageInstallsThroughExternalUploadAtCurrentTime(t *testing.T) {
	integration, _, _, access := newExternalPackageTestIntegrationWithClock(t, time.Now)
	t.Cleanup(func() { _ = integration.Close() })
	packageBytes, err := redevpluginartifacts.CatalogContainersPluginPackage()
	if err != nil {
		t.Fatal(err)
	}

	uploadRequest := trustedExternalPackageRequest(t, http.MethodPost,
		"/_redevplugin/api/plugins/external-packages/upload/inspect", bytes.NewReader(packageBytes))
	uploadRequest.Header.Set("Content-Type", "application/vnd.redevplugin.package+zip")
	uploadResponse := httptest.NewRecorder()
	integration.Handler().ServeHTTP(uploadResponse, uploadRequest)
	if uploadResponse.Code != http.StatusOK {
		t.Fatalf("inspect unsigned catalog upload status = %d body=%s", uploadResponse.Code, uploadResponse.Body.String())
	}
	var inspectionEnvelope struct {
		OK   bool                           `json:"ok"`
		Data host.ExternalPackageInspection `json:"data"`
	}
	if err := json.Unmarshal(uploadResponse.Body.Bytes(), &inspectionEnvelope); err != nil {
		t.Fatalf("decode unsigned catalog inspection: %v body=%s", err, uploadResponse.Body.String())
	}
	inspection := inspectionEnvelope.Data
	if !inspectionEnvelope.OK || inspection.SignatureAssessment.State != string(registry.SignatureAbsent) ||
		inspection.ExecutionApproval.State != string(registry.ExecutionApprovalPending) ||
		inspection.UpdateEligibility.State != string(registry.UpdateManualOnly) {
		t.Fatalf("unsigned catalog inspection = %#v", inspection)
	}

	commitResponse := postExternalPackageJSON(t, integration,
		"/_redevplugin/api/plugins/external-packages/commit", map[string]string{
			"inspection_id":       inspection.InspectionID,
			"confirmation_digest": inspection.ConfirmationDigest,
		})
	if commitResponse.Code != http.StatusOK {
		t.Fatalf("commit unsigned catalog upload status = %d body=%s", commitResponse.Code, commitResponse.Body.String())
	}
	var commitEnvelope struct {
		OK   bool                            `json:"ok"`
		Data externalPackageCommitHTTPResult `json:"data"`
	}
	if err := json.Unmarshal(commitResponse.Body.Bytes(), &commitEnvelope); err != nil {
		t.Fatalf("decode unsigned catalog commit: %v body=%s", err, commitResponse.Body.String())
	}
	if !commitEnvelope.OK || commitEnvelope.Data.Status != string(registry.ExternalPackageCommitted) ||
		commitEnvelope.Data.Plugin == nil || commitEnvelope.Data.Plugin.EnableState != registry.EnableDisabled ||
		commitEnvelope.Data.Plugin.SignatureAssessment.State != string(registry.SignatureAbsent) ||
		commitEnvelope.Data.Plugin.ExecutionApproval.State != string(registry.ExecutionApprovalUserApproved) ||
		commitEnvelope.Data.Plugin.UpdateEligibility.State != string(registry.UpdateManualOnly) {
		t.Fatalf("unsigned catalog commit = %#v", commitEnvelope.Data)
	}

	access.set(sessionPermissions{read: true})
	permissionsResponse := postExternalPackageJSON(t, integration,
		"/_redevplugin/api/plugins/permissions/query", map[string]any{
			"plugin_instance_id": commitEnvelope.Data.Plugin.PluginInstanceID,
			"active_only":        true,
		})
	var permissionsEnvelope struct {
		OK   bool `json:"ok"`
		Data struct {
			Permissions []json.RawMessage `json:"permissions"`
		} `json:"data"`
	}
	if err := json.Unmarshal(permissionsResponse.Body.Bytes(), &permissionsEnvelope); err != nil {
		t.Fatalf("decode unsigned catalog permissions: %v body=%s", err, permissionsResponse.Body.String())
	}
	if permissionsResponse.Code != http.StatusOK || !permissionsEnvelope.OK || len(permissionsEnvelope.Data.Permissions) != 0 {
		t.Fatalf("unsigned catalog install permissions status=%d response=%#v", permissionsResponse.Code, permissionsEnvelope)
	}
}

func TestOfficialReleaseContextSignatureIsBlockedAsExternalPackage(t *testing.T) {
	integration, _, signedPackage, access := newExternalPackageTestIntegrationWithClock(t, time.Now)
	t.Cleanup(func() { _ = integration.Close() })

	inspectRequest := trustedExternalPackageRequest(t, http.MethodPost,
		"/_redevplugin/api/plugins/external-packages/upload/inspect", bytes.NewReader(signedPackage))
	inspectRequest.Header.Set("Content-Type", "application/vnd.redevplugin.package+zip")
	inspectResponse := httptest.NewRecorder()
	integration.Handler().ServeHTTP(inspectResponse, inspectRequest)
	if inspectResponse.Code != http.StatusOK {
		t.Fatalf("inspect release-context package status = %d body=%s", inspectResponse.Code, inspectResponse.Body.String())
	}
	var inspectionEnvelope struct {
		OK   bool                           `json:"ok"`
		Data host.ExternalPackageInspection `json:"data"`
	}
	if err := json.Unmarshal(inspectResponse.Body.Bytes(), &inspectionEnvelope); err != nil {
		t.Fatalf("decode release-context inspection: %v body=%s", err, inspectResponse.Body.String())
	}
	inspection := inspectionEnvelope.Data
	if !inspectionEnvelope.OK || inspection.SignatureAssessment.State != string(registry.SignatureInvalid) ||
		inspection.ExecutionApproval.State != string(registry.ExecutionApprovalPolicyBlocked) {
		t.Fatalf("release-context inspection = %#v", inspection)
	}

	commitResponse := postExternalPackageJSON(t, integration,
		"/_redevplugin/api/plugins/external-packages/commit", map[string]string{
			"inspection_id":       inspection.InspectionID,
			"confirmation_digest": inspection.ConfirmationDigest,
		})
	if commitResponse.Code != http.StatusForbidden {
		t.Fatalf("commit release-context package status = %d body=%s", commitResponse.Code, commitResponse.Body.String())
	}
	var commitEnvelope struct {
		OK    bool `json:"ok"`
		Error struct {
			Code            string `json:"code"`
			MutationOutcome string `json:"mutation_outcome"`
		} `json:"error"`
	}
	if err := json.Unmarshal(commitResponse.Body.Bytes(), &commitEnvelope); err != nil {
		t.Fatalf("decode blocked release-context commit: %v body=%s", err, commitResponse.Body.String())
	}
	if commitEnvelope.OK || commitEnvelope.Error.Code != "PLUGIN_SIGNATURE_INVALID" ||
		commitEnvelope.Error.MutationOutcome != "not_committed" {
		t.Fatalf("blocked release-context commit = %#v", commitEnvelope)
	}

	access.set(sessionPermissions{read: true, admin: true})
	catalogResponse := postExternalPackageJSON(t, integration,
		"/_redevplugin/api/plugins/catalog/query", map[string]any{})
	var catalogEnvelope struct {
		OK   bool `json:"ok"`
		Data struct {
			Plugins []json.RawMessage `json:"plugins"`
		} `json:"data"`
	}
	if err := json.Unmarshal(catalogResponse.Body.Bytes(), &catalogEnvelope); err != nil {
		t.Fatalf("decode catalog after blocked release-context commit: %v body=%s", err, catalogResponse.Body.String())
	}
	if catalogResponse.Code != http.StatusOK || !catalogEnvelope.OK || len(catalogEnvelope.Data.Plugins) != 0 {
		t.Fatalf("catalog after blocked release-context commit status=%d response=%#v", catalogResponse.Code, catalogEnvelope)
	}
}

func TestExternalPackageHTTPPermissionTiers(t *testing.T) {
	integration, _, unsignedPackage, access := newExternalPackageTestIntegration(t)
	t.Cleanup(func() { _ = integration.Close() })

	access.set(sessionPermissions{admin: true})
	inspectRequest := trustedExternalPackageRequest(t, http.MethodPost,
		"/_redevplugin/api/plugins/external-packages/upload/inspect", bytes.NewReader(unsignedPackage))
	inspectRequest.Header.Set("Content-Type", "application/vnd.redevplugin.package+zip")
	inspectResponse := httptest.NewRecorder()
	integration.Handler().ServeHTTP(inspectResponse, inspectRequest)
	if inspectResponse.Code != http.StatusOK {
		t.Fatalf("admin inspect status = %d body=%s", inspectResponse.Code, inspectResponse.Body.String())
	}
	var inspectionEnvelope struct {
		Data host.ExternalPackageInspection `json:"data"`
	}
	if err := json.Unmarshal(inspectResponse.Body.Bytes(), &inspectionEnvelope); err != nil {
		t.Fatalf("decode inspection: %v", err)
	}
	commitBody := map[string]string{
		"inspection_id":       inspectionEnvelope.Data.InspectionID,
		"confirmation_digest": inspectionEnvelope.Data.ConfirmationDigest,
	}

	for _, testCase := range []struct {
		name        string
		permissions sessionPermissions
	}{
		{name: "read only", permissions: sessionPermissions{read: true}},
		{name: "no access", permissions: sessionPermissions{}},
	} {
		t.Run(testCase.name+" rejects inspect", func(t *testing.T) {
			access.set(testCase.permissions)
			request := trustedExternalPackageRequest(t, http.MethodPost,
				"/_redevplugin/api/plugins/external-packages/upload/inspect", bytes.NewReader(unsignedPackage))
			request.Header.Set("Content-Type", "application/vnd.redevplugin.package+zip")
			response := httptest.NewRecorder()
			integration.Handler().ServeHTTP(response, request)
			if response.Code != http.StatusForbidden {
				t.Fatalf("inspect status = %d body=%s", response.Code, response.Body.String())
			}
		})
		t.Run(testCase.name+" rejects commit", func(t *testing.T) {
			access.set(testCase.permissions)
			response := postExternalPackageJSON(t, integration,
				"/_redevplugin/api/plugins/external-packages/commit", commitBody)
			if response.Code != http.StatusForbidden {
				t.Fatalf("commit status = %d body=%s", response.Code, response.Body.String())
			}
		})
	}

	access.set(sessionPermissions{admin: true})
	commitResponse := postExternalPackageJSON(t, integration,
		"/_redevplugin/api/plugins/external-packages/commit", commitBody)
	if commitResponse.Code != http.StatusOK {
		t.Fatalf("admin commit status = %d body=%s", commitResponse.Code, commitResponse.Body.String())
	}
	var commitEnvelope struct {
		Data externalPackageCommitHTTPResult `json:"data"`
	}
	if err := json.Unmarshal(commitResponse.Body.Bytes(), &commitEnvelope); err != nil ||
		commitEnvelope.Data.Receipt == nil || commitEnvelope.Data.Plugin == nil {
		t.Fatalf("decode committed package: err=%v body=%s", err, commitResponse.Body.String())
	}
	queryBody := map[string]string{
		"inspection_id": inspectionEnvelope.Data.InspectionID,
		"commit_id":     commitEnvelope.Data.Receipt.CommitID,
	}
	pluginBody := map[string]string{"plugin_instance_id": commitEnvelope.Data.Plugin.PluginInstanceID}

	access.set(sessionPermissions{read: true})
	for name, request := range map[string]struct {
		path string
		body any
	}{
		"commit query":            {path: "/_redevplugin/api/plugins/external-packages/commit/query", body: queryBody},
		"permission query":        {path: "/_redevplugin/api/plugins/permissions/query", body: pluginBody},
		"permission requirements": {path: "/_redevplugin/api/plugins/permissions/requirements/query", body: pluginBody},
	} {
		t.Run("read only permits "+name, func(t *testing.T) {
			response := postExternalPackageJSON(t, integration, request.path, request.body)
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
			}
		})
	}

	access.set(sessionPermissions{})
	for name, request := range map[string]struct {
		path string
		body any
	}{
		"commit query":            {path: "/_redevplugin/api/plugins/external-packages/commit/query", body: queryBody},
		"permission query":        {path: "/_redevplugin/api/plugins/permissions/query", body: pluginBody},
		"permission requirements": {path: "/_redevplugin/api/plugins/permissions/requirements/query", body: pluginBody},
	} {
		t.Run("no access rejects "+name, func(t *testing.T) {
			response := postExternalPackageJSON(t, integration, request.path, request.body)
			if response.Code != http.StatusForbidden {
				t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
			}
		})
	}
}

func TestExternalPackageCloseRemovesPendingArtifactBeforeClosingStage(t *testing.T) {
	integration, stateDir, unsignedPackage, _ := newExternalPackageTestIntegration(t)
	closed := false
	t.Cleanup(func() {
		if !closed {
			_ = integration.Close()
		}
	})

	uploadRequest := trustedExternalPackageRequest(t, http.MethodPost,
		"/_redevplugin/api/plugins/external-packages/upload/inspect", bytes.NewReader(unsignedPackage))
	uploadRequest.Header.Set("Content-Type", "application/vnd.redevplugin.package+zip")
	uploadResponse := httptest.NewRecorder()
	integration.Handler().ServeHTTP(uploadResponse, uploadRequest)
	if uploadResponse.Code != http.StatusOK {
		t.Fatalf("inspect upload status = %d body=%s", uploadResponse.Code, uploadResponse.Body.String())
	}
	if artifacts := countExternalPackageStageArtifacts(t, stateDir); artifacts != 1 {
		t.Fatalf("pending stage artifacts = %d, want 1", artifacts)
	}
	if err := integration.Close(); err != nil {
		t.Fatalf("close integration with pending inspection: %v", err)
	}
	closed = true
	if artifacts := countExternalPackageStageArtifacts(t, stateDir); artifacts != 0 {
		t.Fatalf("stage artifacts after close = %d, want 0", artifacts)
	}
}

type externalPackageTestAccess struct {
	permissions sessionPermissions
}

func (a *externalPackageTestAccess) set(permissions sessionPermissions) {
	a.permissions = permissions
}

func newExternalPackageTestIntegration(t *testing.T) (*Integration, string, []byte, *externalPackageTestAccess) {
	integration, stateDir, signedPackage, access := newExternalPackageTestIntegrationWithClock(t, officialReleaseFixtureTime)
	return integration, stateDir, packageWithoutSignature(t, signedPackage), access
}

func newExternalPackageTestIntegrationWithClock(t *testing.T, now func() time.Time) (*Integration, string, []byte, *externalPackageTestAccess) {
	t.Helper()
	stateDir := t.TempDir()
	access := &externalPackageTestAccess{permissions: sessionPermissions{admin: true}}
	integration, err := New(context.Background(), Options{
		StateDir:         stateDir,
		PermissionPolicy: testPermissionPolicy(t, "execute_read_write"),
		RuntimePath:      testRuntimePath(t, stateDir),
		Containers:       mustContainersAdapter(t, &capabilityEngineClient{}),
		releaseTrustNow:  now,
		ResolveSessionMeta: func(channelID string) (*session.Meta, bool) {
			if channelID != "ch_external" {
				return nil, false
			}
			permissions := access.permissions
			return &session.Meta{
				ChannelID: channelID, EndpointID: "env_external", UserPublicID: "user_external",
				CanRead: permissions.read, CanWrite: permissions.write,
				CanExecute: permissions.execute, CanAdmin: permissions.admin,
			}, true
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	release, err := redevpluginartifacts.OfficialContainersPluginRelease()
	if err != nil {
		_ = integration.Close()
		t.Fatal(err)
	}
	return integration, stateDir, release.PackageBytes, access
}

func postExternalPackageJSON(t *testing.T, integration *Integration, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	request := trustedExternalPackageRequest(t, http.MethodPost, path, bytes.NewReader(raw))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	integration.Handler().ServeHTTP(response, request)
	return response
}

func countExternalPackageStageArtifacts(t *testing.T, stateDir string) int {
	t.Helper()
	count := 0
	err := filepath.WalkDir(filepath.Join(stateDir, "apps", "redevplugin"), func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".artifact") &&
			strings.Contains(filepath.ToSlash(path), "/external-package-stage/") {
			count++
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return count
}

func packageWithoutSignature(t *testing.T, raw []byte) []byte {
	t.Helper()
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err)
	}
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, entry := range reader.File {
		if entry.Name == pluginpkg.PackageSignaturePath {
			continue
		}
		source, err := entry.Open()
		if err != nil {
			t.Fatal(err)
		}
		header := entry.FileHeader
		destination, err := writer.CreateHeader(&header)
		if err != nil {
			_ = source.Close()
			t.Fatal(err)
		}
		if _, err := io.Copy(destination, source); err != nil {
			_ = source.Close()
			t.Fatal(err)
		}
		if err := source.Close(); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func trustedExternalPackageRequest(t *testing.T, method, path string, body *bytes.Reader) *http.Request {
	t.Helper()
	req := httptest.NewRequest(method, path, body)
	req.Header.Set(sessionhop.HeaderChannelID, "ch_external")
	req.Header.Set("Origin", "https://env.example.test")
	req.Header.Set(csrfHeader, csrfProof)
	req.Host = "env.example.test"
	req = WithRouteRole(req, RouteRoleEnvTrusted)
	var err error
	req, err = WithTrustedOrigin(req, "https://env.example.test")
	if err != nil {
		t.Fatal(err)
	}
	return req
}
