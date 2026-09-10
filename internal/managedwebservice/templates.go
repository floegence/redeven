package managedwebservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"

	templatecontract "github.com/floegence/redeven-service-templates/template"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

const templateSpecSchemaVersion = 6

var (
	templateNamePattern             = regexp.MustCompile(`^[^\x00-\x1f\x7f]{1,80}$`)
	templateParameterPattern        = regexp.MustCompile(`^[A-Z][A-Z0-9_]{0,63}$`)
	managedWorkspaceIdentityPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$`)
	composeVolumePattern            = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$`)
	exactSemverPattern              = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[-0-9A-Za-z.]+)?(?:\+[-0-9A-Za-z.]+)?$`)
)

func (m *Manager) Template(ctx context.Context, templateID string) (*Template, error) {
	templateID = strings.TrimSpace(templateID)
	if !m.isBuiltInTemplateID(templateID) {
		if m.registry == nil {
			return nil, serviceError("TEMPLATE_NOT_FOUND", "The managed Web Service template was not found.", 404, false, nil)
		}
		source, err := m.registry.GetManagedTemplateSource(ctx, templateID)
		if err != nil {
			return nil, err
		}
		if source != nil {
			item, _, err := m.readSourceTemplate(ctx, *source)
			return item, err
		}
		record, err := m.registry.GetManagedTemplate(ctx, templateID)
		if err != nil {
			return nil, err
		}
		if record == nil {
			return nil, serviceError("TEMPLATE_NOT_FOUND", "The managed Web Service template was not found.", 404, false, nil)
		}
		return m.templateFromRecord(ctx, *record)
	}
	items, err := m.Catalog(ctx)
	if err != nil {
		return nil, err
	}
	for i := range items {
		if items[i].TemplateID == templateID {
			return &items[i], nil
		}
	}
	return nil, serviceError("TEMPLATE_NOT_FOUND", "The managed Web Service template was not found.", 404, false, nil)
}

func (m *Manager) ValidateTemplate(_ context.Context, req TemplateWriteRequest) error {
	return validateTemplateWriteRequest(req)
}

func (m *Manager) CreateTemplate(ctx context.Context, req TemplateWriteRequest) (*Template, error) {
	if err := validateRequestID(req.RequestID); err != nil {
		return nil, err
	}
	if err := validateTemplateWriteRequest(req); err != nil {
		return nil, err
	}
	m.requestMu.Lock()
	defer m.requestMu.Unlock()
	specJSON, specHash, err := canonicalTemplateSpec(req.Spec)
	if err != nil {
		return nil, err
	}
	fingerprint := requestFingerprint("template-create", strings.TrimSpace(req.Name), strings.TrimSpace(req.Description), specHash)
	if existing, err := m.registry.GetManagedTemplateRequest(ctx, req.RequestID); err != nil {
		return nil, err
	} else if existing != nil {
		if existing.RequestFingerprint != fingerprint {
			return nil, serviceError("IDEMPOTENCY_CONFLICT", "request_id was already used for a different template request.", 409, false, nil)
		}
		return m.Template(ctx, existing.TemplateID)
	}
	templateID, err := randomID("tmpl")
	if err != nil {
		return nil, err
	}
	familyID, err := randomID("family")
	if err != nil {
		return nil, err
	}
	record := pfregistry.ManagedTemplate{
		TemplateID: templateID, Name: strings.TrimSpace(req.Name), Description: strings.TrimSpace(req.Description), Source: "custom",
		Deployment: string(req.Spec.Kind), Revision: 1, SpecJSON: specJSON, SpecSHA256: specHash, ServiceFamilyID: familyID,
	}
	request := pfregistry.ManagedTemplateRequest{RequestID: strings.TrimSpace(req.RequestID), RequestFingerprint: fingerprint, TemplateID: templateID, Action: "create"}
	if err := m.registry.CreateManagedTemplateWithRequest(ctx, record, request); err != nil {
		return nil, templateRegistryError(err)
	}
	return m.templateFromRecord(ctx, record)
}

func (m *Manager) UpdateTemplate(ctx context.Context, templateID string, req TemplateWriteRequest) (*Template, error) {
	if err := validateRequestID(req.RequestID); err != nil {
		return nil, err
	}
	if err := validateTemplateWriteRequest(req); err != nil {
		return nil, err
	}
	m.requestMu.Lock()
	defer m.requestMu.Unlock()
	record, err := m.registry.GetManagedTemplate(ctx, templateID)
	if err != nil {
		return nil, err
	}
	if record == nil {
		if m.isBuiltInTemplateID(templateID) {
			return nil, serviceError("BUILTIN_TEMPLATE_IMMUTABLE", "Built-in templates cannot be edited. Duplicate the template first.", 409, false, nil)
		}
		return nil, serviceError("TEMPLATE_NOT_FOUND", "The managed Web Service template was not found.", 404, false, nil)
	}
	specJSON, specHash, err := canonicalTemplateSpec(req.Spec)
	if err != nil {
		return nil, err
	}
	if Deployment(record.Deployment) != req.Spec.Kind || record.SpecSHA256 != specHash {
		services, listErr := m.registry.ListManagedServices(ctx)
		if listErr != nil {
			return nil, listErr
		}
		for _, service := range services {
			if service.TemplateID != record.TemplateID {
				continue
			}
			if Deployment(record.Deployment) != req.Spec.Kind {
				return nil, serviceError("TEMPLATE_DEPLOYMENT_IN_USE", "Uninstall the managed Web Service before changing this template's deployment type.", 409, false, nil)
			}
			active, activeErr := m.registry.GetActiveManagedOperation(ctx, service.ServiceID)
			if activeErr != nil {
				return nil, activeErr
			}
			if active != nil {
				return nil, serviceError("TEMPLATE_OPERATION_CONFLICT", "Wait for the managed Web Service operation to finish before changing this template's Runtime definition.", 409, true, nil)
			}
		}
	}
	record.Name, record.Description = strings.TrimSpace(req.Name), strings.TrimSpace(req.Description)
	record.Deployment, record.SpecJSON, record.SpecSHA256 = string(req.Spec.Kind), specJSON, specHash
	record.Revision++
	if err := m.registry.UpdateManagedTemplate(ctx, *record); err != nil {
		return nil, templateRegistryError(err)
	}
	return m.templateFromRecord(ctx, *record)
}

func (m *Manager) DeleteTemplate(ctx context.Context, templateID string) error {
	if m.isBuiltInTemplateID(templateID) {
		return serviceError("BUILTIN_TEMPLATE_IMMUTABLE", "Built-in templates cannot be deleted.", 409, false, nil)
	}
	m.requestMu.Lock()
	defer m.requestMu.Unlock()
	if source, err := m.registry.GetManagedTemplateSource(ctx, templateID); err != nil {
		return err
	} else if source != nil {
		m.templateSourceMu.Lock()
		defer m.templateSourceMu.Unlock()
		if err := m.registry.DeleteManagedTemplateSource(ctx, templateID); err != nil {
			return templateRegistryError(err)
		}
		if directory, err := m.sourceDirectory(*source); err == nil {
			_ = os.RemoveAll(directory)
		}
		return nil
	}
	if err := m.registry.DeleteManagedTemplate(ctx, templateID); err != nil {
		return templateRegistryError(err)
	}
	return nil
}

func (m *Manager) DuplicateTemplate(ctx context.Context, templateID string, req TemplateDuplicateRequest) (*Template, error) {
	if err := validateRequestID(req.RequestID); err != nil {
		return nil, err
	}
	name := strings.TrimSpace(req.Name)
	if !templateNamePattern.MatchString(name) {
		return nil, serviceError("TEMPLATE_NAME_INVALID", "Template name must contain 1 to 80 printable characters.", 400, false, nil)
	}
	m.requestMu.Lock()
	defer m.requestMu.Unlock()
	source, err := m.Template(ctx, templateID)
	if err != nil {
		return nil, err
	}
	if source.Spec == nil {
		return nil, serviceError("TEMPLATE_UNAVAILABLE", "This template cannot be duplicated until its exact deployment definition is available.", 409, true, nil)
	}
	if !source.Duplicateable {
		return nil, serviceError("TEMPLATE_DUPLICATION_UNAVAILABLE", "This template must retain its original source and cannot be duplicated into an editable definition.", 409, false, nil)
	}
	spec := *source.Spec
	spec.SchemaVersion = templateSpecSchemaVersion
	spec.Kind = source.Deployment
	if source.Source == "builtin" && !completeBuiltInDuplicateSpec(spec) {
		return nil, serviceError("TEMPLATE_UNAVAILABLE", "This built-in template cannot be duplicated until its exact audited deployment definition is available.", 409, true, nil)
	}
	specJSON, specHash, err := canonicalTemplateSpec(spec)
	if err != nil {
		return nil, err
	}
	fingerprint := requestFingerprint("template-duplicate", source.TemplateID, fmt.Sprint(source.Revision), name, specHash)
	if existing, err := m.registry.GetManagedTemplateRequest(ctx, req.RequestID); err != nil {
		return nil, err
	} else if existing != nil {
		if existing.RequestFingerprint != fingerprint {
			return nil, serviceError("IDEMPOTENCY_CONFLICT", "request_id was already used for a different template request.", 409, false, nil)
		}
		return m.Template(ctx, existing.TemplateID)
	}
	copyID, err := randomID("tmpl")
	if err != nil {
		return nil, err
	}
	familyID, err := randomID("family")
	if err != nil {
		return nil, err
	}
	record := pfregistry.ManagedTemplate{
		TemplateID: copyID, Name: name, Description: source.Description, Source: "custom", Deployment: string(spec.Kind),
		Revision: 1, SpecJSON: specJSON, SpecSHA256: specHash, DerivedFromTemplateID: source.TemplateID, DerivedFromRevision: source.Revision, ServiceFamilyID: familyID,
	}
	request := pfregistry.ManagedTemplateRequest{RequestID: strings.TrimSpace(req.RequestID), RequestFingerprint: fingerprint, TemplateID: copyID, Action: "duplicate"}
	if err := m.registry.CreateManagedTemplateWithRequest(ctx, record, request); err != nil {
		return nil, templateRegistryError(err)
	}
	return m.templateFromRecord(ctx, record)
}

func completeBuiltInDuplicateSpec(spec TemplateSpec) bool {
	switch spec.Kind {
	case DeploymentHost:
		return spec.Host != nil && (spec.Host.Artifact != nil || spec.Host.NPM != nil)
	case DeploymentContainer:
		return spec.Container != nil && strings.Contains(spec.Container.Image, "@sha256:")
	default:
		return false
	}
}

func (m *Manager) templateFromRecord(ctx context.Context, record pfregistry.ManagedTemplate) (*Template, error) {
	spec, err := verifiedTemplateSpec(record.SpecJSON, record.SpecSHA256)
	if errors.Is(err, errTemplateSpecIdentityMismatch) {
		return nil, serviceError("TEMPLATE_IDENTITY_MISMATCH", "The saved template definition identity has changed.", 409, false, err)
	}
	if err != nil {
		return nil, serviceError("TEMPLATE_SPEC_INVALID", "The saved template definition is invalid or no longer satisfies the template policy.", 409, false, err)
	}
	available, code, reason := m.customTemplateAvailability(ctx, spec.Kind)
	defaultWorkspacePath, err := m.defaultWorkspacePath(record.TemplateID)
	if err != nil {
		return nil, err
	}
	effectiveSpec, err := effectiveTemplateSpec(spec)
	if err != nil {
		return nil, err
	}
	result := &Template{
		TemplateID: record.TemplateID, Name: record.Name, Description: record.Description, Source: "custom", Deployment: spec.Kind,
		ContainerMode: containerMode(spec.Kind), Revision: record.Revision, Editable: true, Duplicateable: true, DerivedFromTemplateID: record.DerivedFromTemplateID,
		DerivedFromRevision: record.DerivedFromRevision, ServiceFamilyID: record.ServiceFamilyID, Available: available, ReasonCode: code, Reason: reason,
		Deployments: []DeploymentAvailability{{Deployment: spec.Kind, Available: available, ReasonCode: code, Reason: reason}}, DefaultWorkspacePath: defaultWorkspacePath, WorkspaceRoots: m.workspaceRoots(), Spec: &spec, EffectiveSpec: &effectiveSpec,
		HostLifecyclePlan: hostLifecyclePlan(spec),
		DefaultAccessMode: pfregistry.AccessModeUnifiedProxy,
	}
	result.RecommendedRelease = recommendedReleaseForTemplate(*result)
	if result.RecommendedRelease != nil {
		result.ReleaseSource = result.RecommendedRelease.Kind
	}
	return result, nil
}

func (m *Manager) customTemplateAvailability(ctx context.Context, kind Deployment) (bool, string, string) {
	switch kind {
	case DeploymentHost:
		if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
			return false, "PLATFORM_UNSUPPORTED", "Host templates support Linux and macOS."
		}
		return true, "", ""
	case DeploymentContainer:
		return m.dockerAvailability(ctx)
	case DeploymentCompose:
		if ok, code, reason := m.dockerAvailability(ctx); !ok {
			return ok, code, reason
		}
		if m.containers == nil || !m.containers.SupportsComposeDeployment() {
			return false, "COMPOSE_UNAVAILABLE", "Docker Compose is not available in this Environment."
		}
		return true, "", ""
	default:
		return false, "DEPLOYMENT_INVALID", "The template deployment type is invalid."
	}
}

func containerMode(kind Deployment) string {
	if kind == DeploymentCompose {
		return "compose"
	}
	if kind == DeploymentContainer {
		return "single"
	}
	return ""
}

func validateTemplateWriteRequest(req TemplateWriteRequest) error {
	if !templateNamePattern.MatchString(strings.TrimSpace(req.Name)) {
		return serviceError("TEMPLATE_NAME_INVALID", "Template name must contain 1 to 80 printable characters.", 400, false, nil)
	}
	if len(req.Description) > 1000 {
		return serviceError("TEMPLATE_METADATA_INVALID", "Template description is too long.", 400, false, nil)
	}
	if req.Spec.Container != nil && req.Spec.Container.RuntimeProfile == ContainerRuntimeProfileInteractiveDesktop {
		return serviceError("TEMPLATE_RUNTIME_PROFILE_RESERVED", "The interactive desktop runtime profile is reserved for reviewed Redeven templates.", 400, false, nil)
	}
	return validateTemplateSpec(req.Spec)
}

func templateContractError(err error) error {
	if err == nil {
		return nil
	}
	var typed *templatecontract.Error
	if errors.As(err, &typed) {
		return serviceError(typed.Code, typed.Message, 400, false, nil)
	}
	return err
}

func validateTemplateSpec(spec TemplateSpec) error {
	return templateContractError(templatecontract.ValidateSpec(spec))
}
func validateComposeYAML(raw, mainService string) error {
	return templateContractError(templatecontract.ValidateComposeYAML(raw, mainService))
}

func canonicalTemplateSpec(spec TemplateSpec) (string, string, error) {
	raw, err := json.Marshal(spec)
	if err != nil {
		return "", "", err
	}
	digest := sha256.Sum256(raw)
	return string(raw), hex.EncodeToString(digest[:]), nil
}

func effectiveTemplateSpec(spec TemplateSpec) (TemplateSpec, error) {
	raw, err := json.Marshal(spec)
	if err != nil {
		return TemplateSpec{}, err
	}
	effective := TemplateSpec{}
	if err := decodeStrictJSON(raw, &effective); err != nil {
		return TemplateSpec{}, err
	}
	if effective.Container != nil {
		normalizeContainerTemplateDefaults(effective.Container)
	}
	return effective, nil
}

var errTemplateSpecIdentityMismatch = errors.New("template spec document identity mismatch")

func verifiedTemplateSpec(raw, expectedDigest string) (TemplateSpec, error) {
	digest := sha256.Sum256([]byte(raw))
	if hex.EncodeToString(digest[:]) != strings.TrimSpace(expectedDigest) {
		return TemplateSpec{}, errTemplateSpecIdentityMismatch
	}
	spec := TemplateSpec{}
	if err := decodeStrictJSON([]byte(raw), &spec); err != nil {
		return TemplateSpec{}, err
	}
	if err := validatePersistedTemplateSpec(spec); err != nil {
		return TemplateSpec{}, err
	}
	return spec, nil
}

func validatePersistedTemplateSpec(spec TemplateSpec) error {
	return validateTemplateSpec(spec)
}

func templateRegistryError(err error) error {
	switch {
	case errors.Is(err, pfregistry.ErrManagedTemplateNameConflict):
		return serviceError("TEMPLATE_NAME_CONFLICT", "A template with this name already exists in the Environment.", 409, false, err)
	case errors.Is(err, pfregistry.ErrManagedTemplateInUse):
		return serviceError("TEMPLATE_IN_USE", "Uninstall the managed service before deleting its template.", 409, false, err)
	case errors.Is(err, pfregistry.ErrManagedTemplateNotFound):
		return serviceError("TEMPLATE_NOT_FOUND", "The managed Web Service template was not found.", 404, false, err)
	default:
		return err
	}
}

func (m *Manager) isBuiltInTemplateID(templateID string) bool {
	_, ok := m.catalog.definition(templateID)
	return ok
}

func sortTemplates(items []Template) {
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].Source != items[j].Source {
			return items[i].Source == "builtin"
		}
		if items[i].Source == "builtin" && items[i].SortOrder != items[j].SortOrder {
			return items[i].SortOrder < items[j].SortOrder
		}
		return strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
	})
}

func resolveTemplateInputs(spec TemplateSpec, supplied map[string]string, acceptedNotices map[string]int64) (serviceConfiguration, map[string]string, error) {
	definitions := make(map[string]TemplateParameter, len(spec.Parameters))
	for _, parameter := range spec.Parameters {
		definitions[parameter.Name] = parameter
	}
	for name := range supplied {
		if _, ok := definitions[name]; !ok {
			return serviceConfiguration{}, nil, serviceError("TEMPLATE_PARAMETER_UNKNOWN", "The deployment contains a parameter that is not defined by the template.", 400, false, nil)
		}
	}
	plain := map[string]string{}
	secrets := map[string]string{}
	for _, parameter := range spec.Parameters {
		value, present := supplied[parameter.Name]
		if !present {
			value = parameter.Default
		}
		if parameter.Required && strings.TrimSpace(value) == "" {
			return serviceConfiguration{}, nil, serviceError("TEMPLATE_PARAMETER_REQUIRED", "A required template parameter is missing.", 400, false, nil)
		}
		if strings.ContainsRune(value, '\x00') || len(value) > 64*1024 {
			return serviceConfiguration{}, nil, serviceError("TEMPLATE_PARAMETER_INVALID", "A template parameter value is invalid or too large.", 400, false, nil)
		}
		if (spec.Kind == DeploymentContainer || spec.Kind == DeploymentCompose) && strings.ContainsAny(value, "\r\n") {
			return serviceConfiguration{}, nil, serviceError("TEMPLATE_PARAMETER_INVALID", "Container template parameters cannot contain line breaks.", 400, false, nil)
		}
		if parameter.Type == "secret" {
			if value != "" {
				secrets[parameter.Name] = value
			}
		} else {
			plain[parameter.Name] = value
		}
	}
	return newServiceConfiguration(plain, acceptedNotices), secrets, nil
}

func validateAcceptedNotices(template Template, accepted map[string]int64) error {
	known := make(map[string]TemplateNotice, len(template.Notices))
	for _, notice := range template.Notices {
		known[notice.ID] = notice
		value, present := accepted[notice.ID]
		if notice.AcknowledgementRequired && !present {
			return serviceError("NOTICE_ACKNOWLEDGEMENT_REQUIRED", "Accept the current safety notice before installing or updating this service.", 409, false, nil)
		}
		if present && value != notice.Revision {
			return serviceError("NOTICE_ACKNOWLEDGEMENT_STALE", "The accepted safety notice revision does not match the current template.", 409, false, nil)
		}
	}
	for id := range accepted {
		if _, ok := known[id]; !ok {
			return serviceError("NOTICE_ACKNOWLEDGEMENT_UNKNOWN", "The request contains an unknown safety notice acknowledgement.", 400, false, nil)
		}
	}
	return nil
}

func cloneNoticeRevisions(values map[string]int64) map[string]int64 {
	if len(values) == 0 {
		return nil
	}
	cloned := make(map[string]int64, len(values))
	for id, revision := range values {
		cloned[id] = revision
	}
	return cloned
}

func (m *Manager) serviceSecretPath(serviceID string) string {
	return filepath.Join(m.stateDir, "secrets", strings.TrimSpace(serviceID)+".json")
}

func (m *Manager) writeServiceSecrets(serviceID string, values map[string]string) error {
	return m.writeServiceSecretDocument(serviceID, serviceSecrets{SchemaVersion: serviceConfigurationSchemaVersion, Parameters: values})
}

func (m *Manager) writeServiceSecretDocument(serviceID string, values serviceSecrets) error {
	if len(values.Parameters) == 0 && len(values.Environment) == 0 {
		if err := os.Remove(m.serviceSecretPath(serviceID)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}
	values.SchemaVersion = serviceConfigurationSchemaVersion
	raw, err := json.Marshal(values)
	if err != nil {
		return err
	}
	path := m.serviceSecretPath(serviceID)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, raw, 0o600); err != nil {
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}

func (m *Manager) serviceParameters(service *pfregistry.ManagedService) (map[string]string, error) {
	values := map[string]string{}
	if service != nil && strings.TrimSpace(service.ConfigurationJSON) != "" {
		configuration, err := decodeServiceConfiguration(service.ConfigurationJSON)
		if err != nil {
			return nil, err
		}
		for name, value := range configuration.Parameters {
			values[name] = value
		}
	}
	if service == nil {
		return values, nil
	}
	raw, err := os.ReadFile(m.serviceSecretPath(service.ServiceID))
	if errors.Is(err, os.ErrNotExist) {
		return values, nil
	}
	if err != nil {
		return nil, err
	}
	secrets := serviceSecrets{}
	if err := decodeStrictJSON(raw, &secrets); err != nil {
		return nil, serviceError("SERVICE_SECRETS_INVALID", "The managed-service secret file is invalid.", 409, false, err)
	}
	if secrets.SchemaVersion != serviceConfigurationSchemaVersion {
		return nil, serviceError("SERVICE_SECRETS_VERSION_UNSUPPORTED", "The managed-service secret file version is unsupported.", 409, false, nil)
	}
	for name, value := range secrets.Parameters {
		values[name] = value
	}
	return values, nil
}

func (m *Manager) serviceSecretDocument(serviceID string) (serviceSecrets, error) {
	raw, err := os.ReadFile(m.serviceSecretPath(serviceID))
	if errors.Is(err, os.ErrNotExist) {
		return serviceSecrets{SchemaVersion: serviceConfigurationSchemaVersion}, nil
	}
	if err != nil {
		return serviceSecrets{}, err
	}
	values := serviceSecrets{}
	if err := decodeStrictJSON(raw, &values); err != nil {
		return serviceSecrets{}, serviceError("SERVICE_SECRETS_INVALID", "The managed-service secret file is invalid.", 409, false, err)
	}
	if values.SchemaVersion != serviceConfigurationSchemaVersion {
		return serviceSecrets{}, serviceError("SERVICE_SECRETS_VERSION_UNSUPPORTED", "The managed-service secret file version is unsupported.", 409, false, nil)
	}
	return values, nil
}
