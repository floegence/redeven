// Package automation owns published workflow definitions, shared business
// context and result artifacts. Agent execution remains owned by Floret.
package automation

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/session"
)

var (
	ErrInvalid      = errors.New("invalid automation request")
	ErrNotFound     = errors.New("automation not found")
	ErrConflict     = errors.New("automation revision conflict")
	ErrUnauthorized = errors.New("automation authorization required")
	ErrUnknown      = errors.New("automation execution outcome unknown")
)
var identityPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`)

type Owner struct {
	User        string `json:"user"`
	Environment string `json:"environment"`
}

func OwnerFromSession(meta *session.Meta) (Owner, error) {
	if meta == nil || !meta.CanRead || meta.UserPublicID == "" || meta.EndpointID == "" {
		return Owner{}, ErrNotFound
	}
	return Owner{meta.UserPublicID, meta.EndpointID}, nil
}
func (o Owner) valid() bool {
	return o.User != "" && o.Environment != "" && len(o.User) <= 256 && len(o.Environment) <= 256
}

type Definition struct {
	Title            string `json:"title"`
	Goal             string `json:"goal"`
	Model            string `json:"model"`
	WorkingDirectory string `json:"working_directory"`
	Nodes            []Node `json:"nodes"`
	MaxConcurrent    int    `json:"max_concurrent"`
	TimeoutSeconds   int    `json:"timeout_seconds"`
	AllowPartial     bool   `json:"allow_partial"`
}
type Node struct {
	ID             string          `json:"id"`
	Title          string          `json:"title"`
	Kind           string          `json:"kind"`
	DependsOn      []string        `json:"depends_on"`
	Instruction    string          `json:"instruction,omitempty"`
	Tool           string          `json:"tool,omitempty"`
	Parameters     json.RawMessage `json:"parameters,omitempty"`
	Items          []Item          `json:"items,omitempty"`
	ItemsFrom      string          `json:"items_from,omitempty"`
	Concurrency    int             `json:"concurrency,omitempty"`
	Condition      *Condition      `json:"condition,omitempty"`
	Template       string          `json:"template,omitempty"`
	JoinPolicy     string          `json:"join_policy,omitempty"`
	MinimumSuccess int             `json:"minimum_success,omitempty"`
	RequireReview  bool            `json:"require_review,omitempty"`
	OutputSchema   json.RawMessage `json:"output_schema,omitempty"`
}
type Item struct {
	ID    string          `json:"id"`
	Label string          `json:"label"`
	Data  json.RawMessage `json:"data"`
}
type Condition struct {
	NodeID string          `json:"node_id"`
	Field  string          `json:"field"`
	Equals json.RawMessage `json:"equals"`
}

type ValidationIssue struct {
	NodeID string `json:"node_id,omitempty"`
	Field  string `json:"field"`
	Code   string `json:"code"`
}

func (d Definition) Validate() []ValidationIssue {
	issues := []ValidationIssue{}
	add := func(id, field, code string) { issues = append(issues, ValidationIssue{id, field, code}) }
	if strings.TrimSpace(d.Title) == "" || len(d.Title) > 240 {
		add("", "title", "required")
	}
	if strings.TrimSpace(d.Goal) == "" || len(d.Goal) > 16000 {
		add("", "goal", "required")
	}
	if len(d.Nodes) < 1 || len(d.Nodes) > 128 {
		add("", "nodes", "bounds")
	}
	if d.MaxConcurrent < 1 || d.MaxConcurrent > 16 {
		add("", "max_concurrent", "bounds")
	}
	if d.TimeoutSeconds < 1 || d.TimeoutSeconds > 86400 {
		add("", "timeout_seconds", "bounds")
	}
	ids := map[string]Node{}
	for _, n := range d.Nodes {
		if !identityPattern.MatchString(n.ID) {
			add(n.ID, "id", "invalid")
		}
		if _, ok := ids[n.ID]; ok {
			add(n.ID, "id", "duplicate")
		}
		ids[n.ID] = n
		if strings.TrimSpace(n.Title) == "" || len(n.Title) > 240 {
			add(n.ID, "title", "required")
		}
		if len(n.Instruction) > 16000 || len(n.Template) > 262144 || len(n.Parameters) > 65536 || len(n.OutputSchema) > 32768 {
			add(n.ID, "configuration", "too_large")
		}
		if len(n.Parameters) > 0 && !json.Valid(n.Parameters) {
			add(n.ID, "parameters", "invalid_json")
		}
		if len(n.OutputSchema) > 0 && validateSchema(n.OutputSchema) != nil {
			add(n.ID, "output_schema", "invalid_json")
		}
		switch n.Kind {
		case "agent", "parallel":
			if strings.TrimSpace(n.Instruction) == "" {
				add(n.ID, "instruction", "required")
			}
			if n.Kind == "parallel" {
				if n.Concurrency < 1 || n.Concurrency > 16 {
					add(n.ID, "concurrency", "bounds")
				}
				if n.ItemsFrom == "" && len(n.Items) == 0 {
					add(n.ID, "items", "required")
				}
				if len(n.Items) > 500 {
					add(n.ID, "items", "bounds")
				}
				seen := map[string]bool{}
				for _, item := range n.Items {
					if !identityPattern.MatchString(item.ID) || seen[item.ID] || !json.Valid(item.Data) {
						add(n.ID, "items", "invalid_identity_or_data")
					}
					seen[item.ID] = true
				}
			}
		case "tool":
			if n.Tool != "http_get" && n.Tool != "containers_list" && n.Tool != "container_inspect" {
				add(n.ID, "tool", "unavailable")
			}
		case "condition":
			if n.Condition == nil || n.Condition.NodeID == "" || n.Condition.Field == "" || !json.Valid(n.Condition.Equals) {
				add(n.ID, "condition", "required")
			}
		case "join":
			if n.JoinPolicy != "" && n.JoinPolicy != "all" && n.JoinPolicy != "partial" {
				add(n.ID, "join_policy", "unsupported")
			}
			if n.MinimumSuccess < 0 || n.MinimumSuccess > 500 {
				add(n.ID, "minimum_success", "bounds")
			}
			if len(n.DependsOn) == 0 {
				add(n.ID, "depends_on", "required")
			}
		case "render":
			if n.Template == "" {
				add(n.ID, "template", "required")
			}
		case "deliver":
			if n.Tool != "artifact.save" {
				add(n.ID, "tool", "unavailable")
			}
		default:
			add(n.ID, "kind", "unsupported")
		}
	}
	state := map[string]int{}
	var visit func(string)
	visit = func(id string) {
		if state[id] == 1 {
			add(id, "depends_on", "cycle")
			return
		}
		if state[id] == 2 {
			return
		}
		state[id] = 1
		n := ids[id]
		seen := map[string]bool{}
		for _, dep := range n.DependsOn {
			if _, ok := ids[dep]; !ok || seen[dep] {
				add(id, "depends_on", "invalid_reference")
				continue
			}
			seen[dep] = true
			visit(dep)
		}
		state[id] = 2
	}
	for _, n := range d.Nodes {
		visit(n.ID)
		if n.ItemsFrom != "" && !contains(n.DependsOn, n.ItemsFrom) {
			add(n.ID, "items_from", "requires_dependency")
		}
		if n.Condition != nil && !contains(n.DependsOn, n.Condition.NodeID) {
			add(n.ID, "condition", "requires_dependency")
		}
	}
	return issues
}
func contains(values []string, v string) bool {
	for _, s := range values {
		if s == v {
			return true
		}
	}
	return false
}
func (d Definition) check() error {
	if issues := d.Validate(); len(issues) > 0 {
		return fmt.Errorf("%w: %s %s %s", ErrInvalid, issues[0].NodeID, issues[0].Field, issues[0].Code)
	}
	return nil
}

type Workflow struct {
	Plugin            *PluginWork `json:"plugin,omitempty"`
	Archived          bool        `json:"archived"`
	ID                string      `json:"id"`
	Revision          int64       `json:"revision"`
	PublishedRevision int64       `json:"published_revision"`
	PublishedVersion  int64       `json:"published_version"`
	Definition        Definition  `json:"definition"`
	DesignerThread    string      `json:"designer_thread,omitempty"`
	CreatedAt         time.Time   `json:"created_at"`
	UpdatedAt         time.Time   `json:"updated_at"`
}
type Published struct {
	WorkflowID  string     `json:"workflow_id"`
	Version     int64      `json:"version"`
	Definition  Definition `json:"definition"`
	PublishedAt time.Time  `json:"published_at"`
}

// GrantAuthority contains only the explicit durable delegation minted by an
// authenticated full-permission publish action. Browser credentials are excluded.
type GrantAuthority struct {
	Namespace string `json:"namespace"`
	App       string `json:"app"`
	Read      bool   `json:"read"`
	Write     bool   `json:"write"`
	Execute   bool   `json:"execute"`
}
type Grant struct {
	Authority GrantAuthority `json:"authority"`

	Revision         int64     `json:"revision"`
	Enabled          bool      `json:"enabled"`
	Tools            []string  `json:"tools"`
	Model            string    `json:"model"`
	WorkingDirectory string    `json:"working_directory"`
	ExpiresAt        time.Time `json:"expires_at"`
}

// DefinitionSchema is a model-facing data contract, never execution authority.
//
//go:embed definition.schema.json
var DefinitionSchema string

// Drafts can be incomplete; graph identity, references and bounds remain strict.
func (d Definition) checkDraft() error {
	for _, issue := range d.Validate() {
		if issue.Code == "required" && issue.Field != "title" && issue.Field != "goal" && issue.Field != "id" {
			continue
		}
		if issue.Field == "tool" && issue.Code == "unavailable" {
			continue
		}
		if issue.Field == "concurrency" && issue.Code == "bounds" {
			continue
		}
		return fmt.Errorf("%w: %s %s %s", ErrInvalid, issue.NodeID, issue.Field, issue.Code)
	}
	return nil
}
