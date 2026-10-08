// Package tessiven owns service canvas documents and their immutable versions.
package tessiven

import (
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"strconv"
	"strings"
	"sync"

	tessivenspec "github.com/floegence/redeven/spec/tessiven"
	"github.com/santhosh-tekuri/jsonschema/v5"
	"gopkg.in/yaml.v3"
)

const MaxDocumentBytes = 4 << 20

type Observation struct {
	State        string   `json:"state"`
	ObservedAt   string   `json:"observedAt"`
	EvidenceRefs []string `json:"evidenceRefs"`
}
type Node struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	RuntimeRef  string       `json:"runtimeRef"`
	Observation *Observation `json:"observation,omitempty"`
}
type Group struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	NodeRefs     []string `json:"nodeRefs"`
	InstanceRefs []string `json:"instanceRefs,omitempty"`
}
type BusinessService struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Kind        string `json:"kind"`
	Description string `json:"description,omitempty"`
}
type Binding struct {
	Owner      string `json:"owner"`
	ResourceID string `json:"resourceId"`
	Engine     string `json:"engine,omitempty"`
	EndpointID string `json:"endpointId,omitempty"`
	Identity   string `json:"identity,omitempty"`
}
type Instance struct {
	ID          string       `json:"id"`
	NodeRef     string       `json:"nodeRef"`
	ServiceRef  string       `json:"serviceRef"`
	Name        string       `json:"name,omitempty"`
	Role        string       `json:"role"`
	Shard       string       `json:"shard,omitempty"`
	Binding     *Binding     `json:"binding,omitempty"`
	Observation *Observation `json:"observation,omitempty"`
}
type Resource struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Kind        string       `json:"kind"`
	Endpoint    string       `json:"endpoint,omitempty"`
	Description string       `json:"description,omitempty"`
	Observation *Observation `json:"observation,omitempty"`
}
type Relation struct {
	ID           string   `json:"id"`
	From         string   `json:"from"`
	To           string   `json:"to"`
	Kind         string   `json:"kind"`
	Protocol     string   `json:"protocol,omitempty"`
	EvidenceRefs []string `json:"evidenceRefs"`
}
type Evidence struct {
	ID         string `json:"id"`
	Source     string `json:"source"`
	Locator    string `json:"locator"`
	Summary    string `json:"summary"`
	ObservedAt string `json:"observedAt,omitempty"`
}
type Metadata struct {
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
}
type Position struct {
	ObjectRef string  `json:"objectRef"`
	X         float64 `json:"x"`
	Y         float64 `json:"y"`
}
type Presentation struct {
	InitiallyExpanded []string   `json:"initiallyExpanded,omitempty"`
	Order             []string   `json:"order,omitempty"`
	Positions         []Position `json:"positions,omitempty"`
}
type Document struct {
	APIVersion   string            `json:"apiVersion"`
	Kind         string            `json:"kind"`
	Metadata     Metadata          `json:"metadata"`
	Nodes        []Node            `json:"nodes,omitempty"`
	Groups       []Group           `json:"groups,omitempty"`
	Services     []BusinessService `json:"services,omitempty"`
	Instances    []Instance        `json:"instances,omitempty"`
	Resources    []Resource        `json:"resources,omitempty"`
	Relations    []Relation        `json:"relations,omitempty"`
	Evidence     []Evidence        `json:"evidence,omitempty"`
	Presentation *Presentation     `json:"presentation,omitempty"`
}
type Diagnostic struct {
	Path    string `json:"path"`
	Line    int    `json:"line"`
	Column  int    `json:"column"`
	Message string `json:"message"`
}
type Validation struct {
	Valid       bool         `json:"valid"`
	Diagnostics []Diagnostic `json:"diagnostics"`
	Document    *Document    `json:"document,omitempty"`
}
type ValidationError struct {
	Diagnostics []Diagnostic `json:"diagnostics"`
}

func (e *ValidationError) Error() string { return "Tessiven document validation failed" }

var documentSchema = sync.OnceValues(func() (*jsonschema.Schema, error) {
	c := jsonschema.NewCompiler()
	c.AssertFormat = true
	if err := c.AddResource("tessiven.json", strings.NewReader(string(tessivenspec.Schema))); err != nil {
		return nil, err
	}
	return c.Compile("tessiven.json")
})

func Schema() json.RawMessage { return append(json.RawMessage(nil), tessivenspec.Schema...) }

// Validate rejects ambiguous YAML before applying the single public schema and
// cross-object contracts. It never interprets source locators or endpoint text.
func Validate(source string) Validation {
	result := Validation{Diagnostics: []Diagnostic{}}
	locations := map[string]*yaml.Node{}
	add := func(path, message string) {
		if len(result.Diagnostics) >= 100 {
			return
		}
		location := locations[path]
		if location == nil {
			location = locations[""]
		}
		d := Diagnostic{Path: path, Line: 1, Column: 1, Message: message}
		if location != nil {
			d.Line, d.Column = location.Line, location.Column
		}
		result.Diagnostics = append(result.Diagnostics, d)
	}
	if len(source) == 0 || len(source) > MaxDocumentBytes {
		add("", "Document must contain between 1 and 4194304 bytes.")
		return result
	}
	var root yaml.Node
	decoder := yaml.NewDecoder(strings.NewReader(source))
	if err := decoder.Decode(&root); err != nil {
		add("", err.Error())
		return result
	}
	var extra yaml.Node
	if err := decoder.Decode(&extra); err != io.EOF {
		add("", "Exactly one YAML document is required.")
		return result
	}
	if len(root.Content) != 1 {
		add("", "A document object is required.")
		return result
	}
	var walk func(*yaml.Node, string, int) any
	count := 0
	walk = func(n *yaml.Node, path string, depth int) any {
		locations[path] = n
		count++
		if depth > 32 || count > 250000 {
			add(path, "Document nesting or object limit exceeded.")
			return nil
		}
		if n.Anchor != "" || n.Kind == yaml.AliasNode {
			add(path, "YAML anchors and aliases are not supported.")
			return nil
		}
		switch n.Kind {
		case yaml.MappingNode:
			out := map[string]any{}
			for i := 0; i < len(n.Content); i += 2 {
				key, value := n.Content[i], n.Content[i+1]
				p := path + "/" + strings.ReplaceAll(strings.ReplaceAll(key.Value, "~", "~0"), "/", "~1")
				locations[p] = key
				if key.Tag != "!!str" {
					add(p, "Object keys must be strings.")
					continue
				}
				if _, exists := out[key.Value]; exists {
					add(p, "Duplicate object field.")
					continue
				}
				out[key.Value] = walk(value, p, depth+1)
			}
			return out
		case yaml.SequenceNode:
			out := make([]any, 0, len(n.Content))
			for i, v := range n.Content {
				out = append(out, walk(v, path+"/"+strconv.Itoa(i), depth+1))
			}
			return out
		case yaml.ScalarNode:
			switch n.Tag {
			case "!!str", "!!timestamp":
				return n.Value
			case "!!null":
				return nil
			case "!!bool":
				return n.Value == "true"
			case "!!int", "!!float":
				var value any
				if err := n.Decode(&value); err != nil {
					add(path, err.Error())
					return nil
				}
				return value
			default:
				add(path, "Unsupported YAML scalar type.")
				return nil
			}
		default:
			add(path, "Unsupported YAML value.")
			return nil
		}
	}
	value := walk(root.Content[0], "", 0)
	if len(result.Diagnostics) > 0 {
		return result
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		add("", "Document contains a value that cannot be represented as JSON.")
		return result
	}
	var normalized any
	if err = json.Unmarshal(encoded, &normalized); err != nil {
		add("", err.Error())
		return result
	}
	schema, err := documentSchema()
	if err != nil {
		add("", "Document schema unavailable: "+err.Error())
		return result
	}
	if err = schema.Validate(normalized); err != nil {
		var flatten func(*jsonschema.ValidationError)
		flatten = func(e *jsonschema.ValidationError) {
			if len(e.Causes) == 0 {
				add(e.InstanceLocation, e.Message)
				return
			}
			for _, cause := range e.Causes {
				flatten(cause)
			}
		}
		if validation, ok := err.(*jsonschema.ValidationError); ok {
			flatten(validation)
		} else {
			add("", err.Error())
		}
		return result
	}
	var document Document
	if err = json.Unmarshal(encoded, &document); err != nil {
		add("", err.Error())
		return result
	}
	kinds := map[string]string{}
	index := func(id, kind, path string) {
		if _, ok := kinds[id]; ok {
			add(path+"/id", "Object ID is already in use.")
		} else {
			kinds[id] = kind
		}
	}
	for i, v := range document.Nodes {
		index(v.ID, "node", fmt.Sprintf("/nodes/%d", i))
	}
	for i, v := range document.Groups {
		index(v.ID, "group", fmt.Sprintf("/groups/%d", i))
	}
	for i, v := range document.Services {
		index(v.ID, "service", fmt.Sprintf("/services/%d", i))
	}
	for i, v := range document.Instances {
		index(v.ID, "instance", fmt.Sprintf("/instances/%d", i))
	}
	for i, v := range document.Resources {
		index(v.ID, "resource", fmt.Sprintf("/resources/%d", i))
	}
	for i, v := range document.Relations {
		index(v.ID, "relation", fmt.Sprintf("/relations/%d", i))
	}
	for i, v := range document.Evidence {
		index(v.ID, "evidence", fmt.Sprintf("/evidence/%d", i))
	}
	check := func(id, path string, allowed ...string) {
		for _, kind := range allowed {
			if kinds[id] == kind {
				return
			}
		}
		add(path, "Reference must identify an existing "+strings.Join(allowed, ", ")+".")
	}
	checkEvidence := func(refs []string, path string) {
		for i, id := range refs {
			check(id, fmt.Sprintf("%s/%d", path, i), "evidence")
		}
	}
	observe := func(o *Observation, path string) {
		if o != nil {
			checkEvidence(o.EvidenceRefs, path+"/observation/evidenceRefs")
		}
	}
	instanceNodes := map[string]string{}
	for _, instance := range document.Instances {
		instanceNodes[instance.ID] = instance.NodeRef
	}
	for i, g := range document.Groups {
		members := map[string]bool{}
		for j, id := range g.NodeRefs {
			p := fmt.Sprintf("/groups/%d/nodeRefs/%d", i, j)
			check(id, p, "node")
			members[id] = true
		}
		for j, id := range g.InstanceRefs {
			p := fmt.Sprintf("/groups/%d/instanceRefs/%d", i, j)
			check(id, p, "instance")
			if node, ok := instanceNodes[id]; ok && !members[node] {
				add(p, "A grouped instance must run on one of the group's member nodes.")
			}
		}
	}
	for i, v := range document.Nodes {
		observe(v.Observation, fmt.Sprintf("/nodes/%d", i))
	}
	for i, v := range document.Instances {
		p := fmt.Sprintf("/instances/%d", i)
		check(v.NodeRef, p+"/nodeRef", "node")
		check(v.ServiceRef, p+"/serviceRef", "service")
		observe(v.Observation, p)
	}
	for i, v := range document.Resources {
		p := fmt.Sprintf("/resources/%d", i)
		observe(v.Observation, p)
		if unsafeLocator(v.Endpoint) {
			add(p+"/endpoint", "Endpoints must not contain credentials, query strings, fragments, or executable URL schemes.")
		}
	}
	for i, v := range document.Relations {
		p := fmt.Sprintf("/relations/%d", i)
		check(v.From, p+"/from", "service", "instance", "resource")
		check(v.To, p+"/to", "service", "instance", "resource")
		checkEvidence(v.EvidenceRefs, p+"/evidenceRefs")
	}
	for i, v := range document.Evidence {
		if unsafeLocator(v.Locator) {
			add(fmt.Sprintf("/evidence/%d/locator", i), "Evidence locators must not contain credentials, query strings, fragments, or executable URL schemes.")
		}
	}
	if p := document.Presentation; p != nil {
		for i, id := range p.InitiallyExpanded {
			check(id, fmt.Sprintf("/presentation/initiallyExpanded/%d", i), "node", "group")
		}
		for i, id := range p.Order {
			check(id, fmt.Sprintf("/presentation/order/%d", i), "node", "group", "service", "instance", "resource", "relation")
		}
		seen := map[string]bool{}
		for i, pos := range p.Positions {
			path := fmt.Sprintf("/presentation/positions/%d/objectRef", i)
			check(pos.ObjectRef, path, "node", "group", "resource")
			if seen[pos.ObjectRef] {
				add(path, "An object can have only one layout position.")
			}
			seen[pos.ObjectRef] = true
		}
	}
	if strings.TrimSpace(document.Metadata.Title) == "" {
		add("/metadata/title", "Title must not be blank.")
	}
	result.Valid = len(result.Diagnostics) == 0
	if result.Valid {
		result.Document = &document
	}
	return result
}

func unsafeLocator(value string) bool {
	if strings.ContainsAny(value, "\r\n\x00") {
		return true
	}
	u, err := url.Parse(value)
	if err != nil {
		return strings.Contains(value, "://") || strings.ContainsAny(value, "@?#")
	} // Plain NAS descriptions remain data; malformed URLs do not bypass credential checks.
	if u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return true
	}
	switch strings.ToLower(u.Scheme) {
	case "javascript", "data", "vbscript":
		return true
	}
	return false
}

func documentYAML(d *Document) (string, error) {
	b, err := json.Marshal(d)
	if err != nil {
		return "", err
	}
	var value any
	if err = json.Unmarshal(b, &value); err != nil {
		return "", err
	}
	b, err = yaml.Marshal(value)
	return string(b), err
}
