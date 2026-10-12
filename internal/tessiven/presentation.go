package tessiven

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

const PresentationFormat = "redeven.io/tessiven-presentation/v1"
const GroupLayoutsCapability = "group_layouts"

var ErrPresentationUnsupported = errors.New("this presentation format is not supported")

type PresentationContract struct {
	Formats      []string `json:"formats"`
	Capabilities []string `json:"capabilities"`
}

func CurrentPresentationContract() PresentationContract {
	return PresentationContract{Formats: []string{PresentationFormat}, Capabilities: []string{GroupLayoutsCapability}}
}

// These data-only types are the frozen display contract, independent of the DSL.
// New DSL semantics require an explicit mapping, never a JSON cast or relabel.
type ViewObservation struct {
	State        string   `json:"state"`
	ObservedAt   string   `json:"observedAt"`
	EvidenceRefs []string `json:"evidenceRefs"`
}
type ViewNode struct {
	ID          string           `json:"id"`
	Name        string           `json:"name"`
	RuntimeRef  string           `json:"runtimeRef"`
	Observation *ViewObservation `json:"observation,omitempty"`
}
type ViewGroup struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	NodeRefs     []string  `json:"nodeRefs"`
	InstanceRefs *[]string `json:"instanceRefs,omitempty"`
}
type ViewService struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Kind        string `json:"kind"`
	Description string `json:"description,omitempty"`
}
type ViewBinding struct {
	Owner      string `json:"owner"`
	ResourceID string `json:"resourceId"`
	Engine     string `json:"engine,omitempty"`
	EndpointID string `json:"endpointId,omitempty"`
	Identity   string `json:"identity,omitempty"`
}
type ViewInstance struct {
	ID          string           `json:"id"`
	NodeRef     string           `json:"nodeRef"`
	ServiceRef  string           `json:"serviceRef"`
	Name        string           `json:"name,omitempty"`
	Role        string           `json:"role"`
	Shard       string           `json:"shard,omitempty"`
	Binding     *ViewBinding     `json:"binding,omitempty"`
	Observation *ViewObservation `json:"observation,omitempty"`
}
type ViewResource struct {
	ID          string           `json:"id"`
	Name        string           `json:"name"`
	Kind        string           `json:"kind"`
	Endpoint    string           `json:"endpoint,omitempty"`
	Description string           `json:"description,omitempty"`
	Observation *ViewObservation `json:"observation,omitempty"`
}
type ViewRelation struct {
	ID           string   `json:"id"`
	From         string   `json:"from"`
	To           string   `json:"to"`
	Kind         string   `json:"kind"`
	Protocol     string   `json:"protocol,omitempty"`
	EvidenceRefs []string `json:"evidenceRefs"`
}
type ViewEvidence struct {
	ID         string `json:"id"`
	Source     string `json:"source"`
	Locator    string `json:"locator"`
	Summary    string `json:"summary"`
	ObservedAt string `json:"observedAt,omitempty"`
}
type ViewFact struct {
	Label string `json:"label"`
	Value string `json:"value"`
}
type ViewObject struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Kind        string     `json:"kind"`
	Description string     `json:"description,omitempty"`
	Facts       []ViewFact `json:"facts,omitempty"`
	ObjectRefs  []string   `json:"objectRefs,omitempty"`
}
type ViewMetadata struct {
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
}
type ViewPosition struct {
	ObjectRef string  `json:"objectRef"`
	X         float64 `json:"x"`
	Y         float64 `json:"y"`
}
type ViewGroupLayout struct {
	Flow       string `json:"flow"`
	MaxPerLine int64  `json:"maxPerLine,omitempty"`
}
type ViewLayout struct {
	GroupLayouts      map[string]ViewGroupLayout `json:"groupLayouts,omitempty"`
	InitiallyExpanded []string                   `json:"initiallyExpanded,omitempty"`
	Order             []string                   `json:"order,omitempty"`
	Direction         string                     `json:"direction,omitempty"`
	Layers            [][]string                 `json:"layers,omitempty"`
	Positions         []ViewPosition             `json:"positions,omitempty"`
}
type RenderModel struct {
	Metadata     ViewMetadata   `json:"metadata"`
	Nodes        []ViewNode     `json:"nodes,omitempty"`
	Groups       []ViewGroup    `json:"groups,omitempty"`
	Services     []ViewService  `json:"services,omitempty"`
	Instances    []ViewInstance `json:"instances,omitempty"`
	Resources    []ViewResource `json:"resources,omitempty"`
	Relations    []ViewRelation `json:"relations,omitempty"`
	Evidence     []ViewEvidence `json:"evidence,omitempty"`
	Presentation *ViewLayout    `json:"presentation,omitempty"`
	Objects      []ViewObject   `json:"objects,omitempty"`
}
type PresentationLimitation struct {
	Code       string   `json:"code"`
	ObjectRefs []string `json:"object_refs"`
	Feature    string   `json:"feature,omitempty"`
}
type PresentationCompatibility struct {
	Status      string                   `json:"status"`
	Limitations []PresentationLimitation `json:"limitations"`
}
type CanvasPresentation struct {
	Format        string                    `json:"format"`
	Model         RenderModel               `json:"model"`
	Capabilities  []string                  `json:"capabilities"`
	Compatibility PresentationCompatibility `json:"compatibility"`
}
type PresentationVersion struct {
	CanvasID     string             `json:"canvas_id"`
	Number       int64              `json:"number"`
	DocumentYAML string             `json:"document_yaml"`
	Digest       string             `json:"digest"`
	CreatedAt    int64              `json:"created_at"`
	Source       string             `json:"source"`
	Summary      string             `json:"summary"`
	DSLVersion   string             `json:"dsl_version,omitempty"`
	Migrations   []DSLMigration     `json:"migrations,omitempty"`
	View         CanvasPresentation `json:"view"`
}
type PresentationSnapshot struct {
	Canvas  Canvas              `json:"canvas"`
	Version PresentationVersion `json:"version"`
}

func viewObservation(value *Observation) *ViewObservation {
	if value == nil {
		return nil
	}
	return &ViewObservation{State: value.State, ObservedAt: value.ObservedAt, EvidenceRefs: append([]string{}, value.EvidenceRefs...)}
}

func projectPresentation(document *Document, capabilities []string) CanvasPresentation {
	view := CanvasPresentation{Format: PresentationFormat, Capabilities: []string{}, Compatibility: PresentationCompatibility{Status: "complete", Limitations: []PresentationLimitation{}}}
	model := &view.Model
	model.Metadata = ViewMetadata{Title: document.Metadata.Title, Description: document.Metadata.Description}
	// This is a reviewed display mapping, not the current DSL registry. A new
	// canonical format must explicitly preserve this display contract's meaning.
	if document.APIVersion != "redeven.io/tessiven/v1.1.0" {
		view.Compatibility = PresentationCompatibility{Status: "unavailable", Limitations: []PresentationLimitation{{Code: "presentation_mapping_unavailable", ObjectRefs: []string{}}}}
		return view
	}
	for _, value := range document.Nodes {
		model.Nodes = append(model.Nodes, ViewNode{ID: value.ID, Name: value.Name, RuntimeRef: value.RuntimeRef, Observation: viewObservation(value.Observation)})
	}
	for _, value := range document.Groups {
		group := ViewGroup{ID: value.ID, Name: value.Name, NodeRefs: append([]string{}, value.NodeRefs...)}
		if value.InstanceRefs != nil {
			refs := append([]string{}, value.InstanceRefs...)
			group.InstanceRefs = &refs
		}
		model.Groups = append(model.Groups, group)
	}
	for _, value := range document.Services {
		model.Services = append(model.Services, ViewService{ID: value.ID, Name: value.Name, Kind: value.Kind, Description: value.Description})
	}
	for _, value := range document.Instances {
		instance := ViewInstance{ID: value.ID, NodeRef: value.NodeRef, ServiceRef: value.ServiceRef, Name: value.Name, Role: value.Role, Shard: value.Shard, Observation: viewObservation(value.Observation)}
		if binding := value.Binding; binding != nil {
			instance.Binding = &ViewBinding{Owner: binding.Owner, ResourceID: binding.ResourceID, Engine: binding.Engine, EndpointID: binding.EndpointID, Identity: binding.Identity}
		}
		model.Instances = append(model.Instances, instance)
	}
	for _, value := range document.Resources {
		model.Resources = append(model.Resources, ViewResource{ID: value.ID, Name: value.Name, Kind: value.Kind, Endpoint: value.Endpoint, Description: value.Description, Observation: viewObservation(value.Observation)})
	}
	for _, value := range document.Relations {
		model.Relations = append(model.Relations, ViewRelation{ID: value.ID, From: value.From, To: value.To, Kind: value.Kind, Protocol: value.Protocol, EvidenceRefs: append([]string{}, value.EvidenceRefs...)})
	}
	for _, value := range document.Evidence {
		model.Evidence = append(model.Evidence, ViewEvidence{ID: value.ID, Source: value.Source, Locator: value.Locator, Summary: value.Summary, ObservedAt: value.ObservedAt})
	}
	if value := document.Presentation; value != nil {
		layout := &ViewLayout{InitiallyExpanded: value.InitiallyExpanded, Order: value.Order, Direction: string(value.Direction), Layers: value.Layers}
		for _, position := range value.Positions {
			layout.Positions = append(layout.Positions, ViewPosition{ObjectRef: position.ObjectRef, X: position.X, Y: position.Y})
		}
		for _, capability := range capabilities {
			if capability == GroupLayoutsCapability {
				view.Capabilities = append(view.Capabilities, capability)
				layout.GroupLayouts = map[string]ViewGroupLayout{}
				for id, group := range value.GroupLayouts {
					layout.GroupLayouts[id] = ViewGroupLayout{Flow: group.Flow, MaxPerLine: group.MaxPerLine}
				}
			}
		}
		model.Presentation = layout
	}
	return view
}

func ParsePresentationCapabilities(raw string) ([]string, error) {
	if raw == "" {
		return []string{}, nil
	}
	values := strings.Split(raw, ",")
	if len(values) > 16 {
		return nil, ErrInvalidRequest
	}
	seen := map[string]bool{}
	for _, value := range values {
		if len(value) == 0 || len(value) > 64 || seen[value] {
			return nil, ErrInvalidRequest
		}
		for _, character := range value {
			if !(character >= 'a' && character <= 'z' || character >= '0' && character <= '9' || character == '_') {
				return nil, ErrInvalidRequest
			}
		}
		seen[value] = true
	}
	return values, nil
}

// Presentation reads metadata and its immutable source in one snapshot. It
// never changes the source or turns a display mapping into resource authority.
func (s *Service) Presentation(ctx context.Context, id string, number int64, format string, capabilities []string) (PresentationSnapshot, error) {
	if format != PresentationFormat {
		return PresentationSnapshot{}, ErrPresentationUnsupported
	}
	if _, err := ParsePresentationCapabilities(strings.Join(capabilities, ",")); err != nil {
		return PresentationSnapshot{}, err
	}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return PresentationSnapshot{}, err
	}
	defer tx.Rollback()
	var result PresentationSnapshot
	err = scanCanvas(tx.QueryRowContext(ctx, `SELECT id,title,description,latest_version,archived,created_at,updated_at,flower_thread_id FROM canvases WHERE id=?`, id), &result.Canvas)
	if err != nil {
		return result, notFound(err)
	}
	if number == 0 {
		number = result.Canvas.LatestVersion
	}
	version, err := readVersionSource(ctx, tx, id, number)
	if err != nil {
		return result, err
	}
	validation := validateDocument(version.DocumentYAML, true)
	view := CanvasPresentation{Format: PresentationFormat, Model: RenderModel{Metadata: ViewMetadata{Title: result.Canvas.Title}}, Capabilities: []string{}, Compatibility: PresentationCompatibility{Status: "unavailable", Limitations: []PresentationLimitation{{Code: "source_unreadable", ObjectRefs: []string{}}}}}
	if validation.Valid {
		view = projectPresentation(validation.Document, capabilities)
	}
	result.Version = PresentationVersion{CanvasID: version.CanvasID, Number: version.Number, DocumentYAML: version.DocumentYAML, Digest: version.Digest, CreatedAt: version.CreatedAt, Source: version.Source, Summary: version.Summary, DSLVersion: validation.DSLVersion, Migrations: validation.Migrations, View: view}
	if err := tx.Commit(); err != nil {
		return PresentationSnapshot{}, fmt.Errorf("read canvas presentation: %w", err)
	}
	return result, nil
}
