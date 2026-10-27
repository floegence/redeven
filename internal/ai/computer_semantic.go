package ai

import (
	"encoding/json"
	"errors"
	"math"
	"slices"
	"strings"
	"unicode/utf8"
)

const computerSemanticSchemaVersion = 2
const computerSemanticMaxBytes = 262144

// Platform adapters collect native facts. This is the single model-visible
// schema boundary; unsupported facts are omitted rather than inferred.
type computerSemanticNode struct {
	Ref               string                  `json:"ref"`
	ParentRef         string                  `json:"parent_ref,omitempty"`
	ChildRefs         []string                `json:"child_refs"`
	ChildrenTruncated bool                    `json:"children_truncated,omitempty"`
	FrameID           string                  `json:"frame_id,omitempty"`
	Role              string                  `json:"role"`
	PlatformRole      string                  `json:"platform_role"`
	CanonicalRole     string                  `json:"canonical_role"`
	Name              string                  `json:"name"`
	Description       string                  `json:"description,omitempty"`
	Relations         map[string][]string     `json:"relations,omitempty"`
	States            map[string]any          `json:"states"`
	Actions           []string                `json:"actions"`
	PlatformActions   []string                `json:"platform_actions,omitempty"`
	Value             any                     `json:"value,omitempty"`
	Bounds            *computerSemanticBounds `json:"bounds,omitempty"`
	Subrole           string                  `json:"platform_subrole,omitempty"`
}
type computerSemanticBounds struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}
type computerSemanticSnapshot struct {
	Source        string                 `json:"source,omitempty"`
	Coverage      string                 `json:"coverage,omitempty"`
	Version       int                    `json:"semantic_schema_version"`
	DocumentID    string                 `json:"document_id"`
	Roots         []string               `json:"roots"`
	FocusRef      string                 `json:"focus_ref,omitempty"`
	Nodes         []computerSemanticNode `json:"nodes"`
	Truncated     bool                   `json:"truncated"`
	Total         *int                   `json:"total,omitempty"`
	ExecutionMode string                 `json:"execution_mode,omitempty"`
}

// One role inventory owns both normalization and portable selector aliases.
var computerRoleAliases = map[string][]string{
	"button":           {"button", "push button", "toggle button", "AXButton"},
	"link":             {"link", "AXLink"},
	"textbox":          {"textbox", "text", "entry", "AXTextField", "AXTextArea"},
	"searchbox":        {"searchbox", "AXSearchField"},
	"combobox":         {"combobox", "combo box", "AXComboBox", "AXPopUpButton"},
	"checkbox":         {"checkbox", "check box", "AXCheckBox"},
	"radio":            {"radio", "radio button", "AXRadioButton"},
	"switch":           {"switch"},
	"tab":              {"tab", "page tab"},
	"tablist":          {"tablist", "page tab list", "AXTabGroup"},
	"tabpanel":         {"tabpanel"},
	"listbox":          {"listbox"},
	"option":           {"option"},
	"radiogroup":       {"radiogroup"},
	"tooltip":          {"tooltip", "tool tip"},
	"separator":        {"separator", "AXSeparator"},
	"tree":             {"tree", "AXTree", "AXOutline"},
	"treeitem":         {"treeitem", "tree item"},
	"menu":             {"menu", "AXMenu"},
	"menubar":          {"menubar", "menu bar", "AXMenuBar"},
	"menuitem":         {"menuitem", "menu item", "AXMenuItem"},
	"menuitemcheckbox": {"menuitemcheckbox", "check menu item"},
	"menuitemradio":    {"menuitemradio", "radio menu item"},
	"dialog":           {"dialog", "AXWindow", "window", "frame"},
	"alertdialog":      {"alertdialog"},
	"heading":          {"heading", "AXHeading"},
	"list":             {"list", "AXList"},
	"listitem":         {"listitem", "list item"},
	"status":           {"status", "statusbar", "status bar"},
	"alert":            {"alert"},
	"region":           {"region", "AXScrollArea", "scroll pane"},
	"scrollbar":        {"scrollbar", "scroll bar", "AXScrollBar"},
	"image":            {"image", "img", "AXImage", "icon"},
	"canvas":           {"canvas", "AXCanvas"},
	"document":         {"RootWebArea", "WebArea", "AXWebArea", "document", "document frame", "document web", "application"},
	"group":            {"group", "generic", "panel", "AXGroup", "section", "form"},
	"text":             {"StaticText", "AXStaticText", "label", "paragraph"},
	"table":            {"table", "AXTable"},
	"grid":             {"grid"},
	"row":              {"row", "AXRow", "table row"},
	"cell":             {"cell", "AXCell", "table cell"},
	"columnheader":     {"columnheader", "column header", "table column header"},
	"rowheader":        {"rowheader", "row header", "table row header"},
	"slider":           {"slider", "AXSlider"},
	"progressbar":      {"progressbar", "progress bar", "AXProgressIndicator"},
	"spinbutton":       {"spinbutton", "spin button"},
	"navigation":       {"navigation", "landmark navigation"},
	"main":             {"main", "landmark main"},
	"banner":           {"banner", "landmark banner"},
	"contentinfo":      {"contentinfo", "landmark content info"},
	"complementary":    {"complementary", "landmark complementary"},
	"search":           {"search", "landmark search"},
	"article":          {"article"},
	"toolbar":          {"toolbar", "tool bar", "AXToolbar"},
	"rowgroup":         {"rowgroup"},
	"gridcell":         {"gridcell"},
	"treegrid":         {"treegrid"},
	"log":              {"log"},
	"timer":            {"timer"},
	"marquee":          {"marquee"},
	"meter":            {"meter", "AXLevelIndicator"},
}

func computerCanonicalRole(role string) string {
	for canonical, aliases := range computerRoleAliases {
		for _, alias := range aliases {
			if strings.EqualFold(alias, role) {
				return canonical
			}
		}
	}
	return "other"
}

func normalizeComputerSemanticNode(node *computerSemanticNode) error {
	if node.Ref == "" || len(node.Ref) > 1024 || node.Role == "" || len(node.Role) > 100 {
		return errors.New("invalid semantic node identity")
	}
	if node.PlatformRole != node.Role {
		return errors.New("invalid semantic platform role")
	}
	if len(node.Subrole) > 100 || len(node.FrameID) > 1024 || len(node.ParentRef) > 1024 {
		return errors.New("invalid semantic platform identity")
	}
	if node.Role == "password text" || node.Subrole == "AXSecureTextField" {
		return errors.New("protected semantic node")
	}
	node.CanonicalRole = computerCanonicalRole(node.Role)
	if node.ChildRefs == nil {
		node.ChildRefs = []string{}
	}
	if node.States == nil {
		node.States = map[string]any{}
	}
	for _, value := range []string{node.Name, node.Description} {
		if !utf8.ValidString(value) || utf8.RuneCountInString(value) > 2000 {
			return errors.New("semantic text exceeds its limit")
		}
	}
	if len(node.ChildRefs) > 1000 || len(node.Actions) > 16 || len(node.PlatformActions) > 64 {
		return errors.New("semantic node exceeds its limit")
	}
	for key, value := range node.States {
		if !slices.Contains([]string{"disabled", "enabled", "focused", "checked", "selected", "expanded", "readonly", "required", "invalid", "busy", "visible", "showing", "editable", "defunct", "focusable", "multiline", "modal"}, key) {
			delete(node.States, key)
			continue
		}
		if _, ok := value.(bool); !ok {
			text, ok := value.(string)
			if !ok || !((key == "checked" && text == "mixed") || (key == "invalid" && slices.Contains([]string{"grammar", "spelling"}, text))) {
				return errors.New("invalid semantic state")
			}
		}
	}
	for key, refs := range node.Relations {
		if !slices.Contains([]string{"labelled_by", "described_by", "controls", "details", "error_message", "active_descendant"}, key) {
			delete(node.Relations, key)
			continue
		}
		if len(refs) > 64 {
			return errors.New("semantic relation exceeds its limit")
		}
	}
	for _, action := range node.Actions {
		if !slices.Contains([]string{"read", "click", "fill", "press", "scroll"}, action) {
			return errors.New("invalid semantic action")
		}
	}
	if !slices.Contains(node.Actions, "read") {
		return errors.New("semantic read capability missing")
	}
	if node.Value != nil {
		switch value := node.Value.(type) {
		case string:
			if !utf8.ValidString(value) || utf8.RuneCountInString(value) > 2000 {
				return errors.New("semantic value exceeds its limit")
			}
		case bool:
		case float64:
			if math.IsNaN(value) || math.IsInf(value, 0) {
				return errors.New("invalid semantic value")
			}
		default:
			return errors.New("invalid semantic value")
		}
	}
	if node.Bounds != nil {
		b := node.Bounds
		for _, v := range []float64{b.X, b.Y, b.Width, b.Height} {
			if math.IsNaN(v) || math.IsInf(v, 0) {
				return errors.New("invalid semantic geometry")
			}
		}
		if b.Width < 0 || b.Height < 0 {
			return errors.New("invalid semantic geometry")
		}
	}
	return nil
}

func normalizeComputerObservation(value any) (map[string]any, error) {
	body, err := json.Marshal(value)
	if err != nil || len(body) > 8*1024*1024 {
		return nil, errors.New("semantic snapshot exceeds its limit")
	}
	var snapshot computerSemanticSnapshot
	if json.Unmarshal(body, &snapshot) != nil || snapshot.Version != computerSemanticSchemaVersion || snapshot.DocumentID == "" || len(snapshot.DocumentID) > 1024 || snapshot.Nodes == nil || len(snapshot.Nodes) > 1000 {
		return nil, errors.New("invalid semantic snapshot protocol")
	}
	if snapshot.Source != "" && snapshot.Source != "macos_accessibility" || snapshot.Coverage != "" && snapshot.Coverage != "application_provided" {
		return nil, errors.New("invalid semantic coverage")
	}
	byRef := make(map[string]*computerSemanticNode, len(snapshot.Nodes))
	for index := range snapshot.Nodes {
		node := &snapshot.Nodes[index]
		if err := normalizeComputerSemanticNode(node); err != nil {
			return nil, err
		}
		if byRef[node.Ref] != nil {
			return nil, errors.New("duplicate semantic reference")
		}
		byRef[node.Ref] = node
	}
	snapshot.Roots = []string{}
	snapshot.FocusRef = ""
	for index := range snapshot.Nodes {
		node := &snapshot.Nodes[index]
		if node.ParentRef == "" {
			snapshot.Roots = append(snapshot.Roots, node.Ref)
		} else if parent := byRef[node.ParentRef]; parent == nil || !slices.Contains(parent.ChildRefs, node.Ref) {
			return nil, errors.New("invalid semantic parent")
		}
		seen := map[string]bool{}
		for _, ref := range node.ChildRefs {
			child := byRef[ref]
			if seen[ref] || child == nil || child.ParentRef != node.Ref {
				return nil, errors.New("invalid semantic child")
			}
			seen[ref] = true
		}
		for _, refs := range node.Relations {
			seen := map[string]bool{}
			for _, ref := range refs {
				if byRef[ref] == nil || seen[ref] {
					return nil, errors.New("invalid semantic relation")
				}
				seen[ref] = true
			}
		}
	}
	visited := map[string]bool{}
	var walk func(string) error
	walk = func(ref string) error {
		if visited[ref] {
			return errors.New("cyclic semantic tree")
		}
		visited[ref] = true
		for _, child := range byRef[ref].ChildRefs {
			if err := walk(child); err != nil {
				return err
			}
		}
		return nil
	}
	for _, ref := range snapshot.Roots {
		if err := walk(ref); err != nil {
			return nil, err
		}
	}
	if len(visited) != len(byRef) {
		return nil, errors.New("unreachable semantic tree")
	}
	if snapshot.Total != nil && *snapshot.Total < len(snapshot.Nodes) {
		return nil, errors.New("invalid semantic total")
	}
	if snapshot.ExecutionMode != "" && !slices.Contains([]string{"background", "foreground"}, snapshot.ExecutionMode) {
		return nil, errors.New("invalid semantic execution mode")
	}
	// Export parent-first order so a byte-bounded prefix remains a complete
	// forest. Pruning removes dangling edges, never fabricates relationships.
	ordered := make([]computerSemanticNode, 0, len(snapshot.Nodes))
	pending := slices.Clone(snapshot.Roots)
	for len(pending) > 0 {
		ref := pending[0]
		pending = pending[1:]
		ordered = append(ordered, *byRef[ref])
		pending = append(pending, byRef[ref].ChildRefs...)
	}
	snapshot.Nodes = ordered
	project := func(count int) computerSemanticSnapshot {
		bounded := snapshot
		bounded.Nodes = make([]computerSemanticNode, count)
		bounded.Roots = []string{}
		included := map[string]bool{}
		for _, node := range ordered[:count] {
			included[node.Ref] = true
		}
		for index, original := range ordered[:count] {
			node := original
			node.ChildRefs = []string{}
			for _, ref := range original.ChildRefs {
				if included[ref] {
					node.ChildRefs = append(node.ChildRefs, ref)
				} else {
					node.ChildrenTruncated = true
				}
			}
			node.Relations = map[string][]string{}
			for key, refs := range original.Relations {
				for _, ref := range refs {
					if included[ref] {
						node.Relations[key] = append(node.Relations[key], ref)
					}
				}
			}
			bounded.Nodes[index] = node
			if node.ParentRef == "" {
				bounded.Roots = append(bounded.Roots, node.Ref)
			}
		}
		bounded.FocusRef = computerSemanticFocus(bounded.Nodes)
		if count < len(ordered) {
			bounded.Truncated = true
		}
		return bounded
	}
	snapshot = project(len(ordered))
	body, err = json.Marshal(snapshot)
	if err != nil {
		return nil, err
	}
	if len(body) > computerSemanticMaxBytes {
		low, high := 0, len(ordered)
		for low < high {
			mid := (low + high + 1) / 2
			encoded, _ := json.Marshal(project(mid))
			if len(encoded) <= computerSemanticMaxBytes {
				low = mid
			} else {
				high = mid - 1
			}
		}
		snapshot = project(low)
		body, err = json.Marshal(snapshot)
		if err != nil || len(body) > computerSemanticMaxBytes {
			return nil, errors.New("semantic envelope exceeds its limit")
		}
	}
	var result map[string]any
	err = json.Unmarshal(body, &result)
	return result, err
}

// Platforms can focus both a document/container and its descendant. Keep the
// native flags and expose the deepest focused node only for a single chain.
func computerSemanticFocus(nodes []computerSemanticNode) string {
	byRef := map[string]computerSemanticNode{}
	for _, node := range nodes {
		byRef[node.Ref] = node
	}
	candidate := ""
	for _, node := range nodes {
		if node.States["focused"] != true {
			continue
		}
		ancestor := func(ref, target string) bool {
			for ref != "" {
				if ref == target {
					return true
				}
				ref = byRef[ref].ParentRef
			}
			return false
		}
		if candidate == "" || ancestor(node.Ref, candidate) {
			candidate = node.Ref
		} else if !ancestor(candidate, node.Ref) {
			return ""
		}
	}
	return candidate
}

func normalizeComputerSemanticResult(result *TargetToolResult) error {
	payload, ok := result.Result.(map[string]any)
	if !ok {
		return nil
	}
	if value, exists := payload["observation"]; exists && value != nil {
		normalized, err := normalizeComputerObservation(value)
		if err != nil {
			return err
		}
		payload["observation"] = normalized
	}
	if value, exists := payload["node"]; exists {
		version, ok := payload["semantic_schema_version"]
		if !ok || (version != computerSemanticSchemaVersion && version != float64(computerSemanticSchemaVersion)) {
			return errors.New("invalid semantic node protocol")
		}
		body, err := json.Marshal(value)
		if err != nil || len(body) > computerSemanticMaxBytes {
			return errors.New("invalid semantic node")
		}
		var node computerSemanticNode
		if json.Unmarshal(body, &node) != nil {
			return errors.New("invalid semantic node")
		}
		if err := normalizeComputerSemanticNode(&node); err != nil {
			return err
		}
		body, err = json.Marshal(node)
		if err != nil {
			return err
		}
		var normalized map[string]any
		if err := json.Unmarshal(body, &normalized); err != nil {
			return err
		}
		payload["node"] = normalized
	}
	return nil
}

// Portable role aliases are projected once by Runtime. Native adapters retain
// their own event-driven waits and revalidation, without platform role maps.
func resolveComputerCanonicalSelector(call TargetToolCall) (TargetToolCall, error) {
	var args map[string]any
	if json.Unmarshal(call.Arguments, &args) != nil {
		return call, computerTargetFailure(call, "INVALID_REQUEST")
	}
	selector, ok := args["selector"].(map[string]any)
	if !ok || selector["canonical_role"] == nil {
		return call, nil
	}
	role, roleOK := selector["canonical_role"].(string)
	if !roleOK || len(selector) > 4 {
		return call, computerTargetFailure(call, "INVALID_REQUEST")
	}
	for key := range selector {
		if !slices.Contains([]string{"canonical_role", "name", "exact", "root_ref"}, key) {
			return call, computerTargetFailure(call, "INVALID_REQUEST")
		}
	}
	if role == "img" {
		role = "image"
	}
	if name, exists := selector["name"]; exists {
		if _, ok := name.(string); !ok {
			return call, computerTargetFailure(call, "INVALID_REQUEST")
		}
	}
	roles := slices.Clone(computerRoleAliases[role])
	if len(roles) == 0 {
		return call, computerTargetFailure(call, "INVALID_REQUEST")
	}
	delete(selector, "canonical_role")
	selector["roles"] = roles
	if root, exists := selector["root_ref"]; exists {
		text, ok := root.(string)
		if !ok || text == "" {
			return call, computerTargetFailure(call, "INVALID_REQUEST")
		}
	}
	if exact, exists := selector["exact"]; exists {
		if _, ok := exact.(bool); !ok {
			return call, computerTargetFailure(call, "INVALID_REQUEST")
		}
	}
	call.Arguments, _ = json.Marshal(args)
	return call, nil
}
