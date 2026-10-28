package ai

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"path/filepath"
	"slices"
	"strings"
	"sync/atomic"
	"time"

	"github.com/godbus/dbus/v5"
)

const atspiAccessible = "org.a11y.atspi.Accessible"

type atspiObject struct {
	Bus  string
	Path dbus.ObjectPath
}
type atspiReference struct {
	object       atspiObject
	role         string
	nameIdentity [32]byte
	revision     uint64
}
type atspiClient struct {
	connection *dbus.Conn
	root       atspiObject
	prefix     string
	references map[string]atspiReference
	revision   atomic.Uint64
	changes    chan struct{}
	done       chan struct{}
}

// The only address accepted here comes from the private session's a11y bus.
// Never use dbus.SessionBus or an inherited desktop address.
func connectATSPIDesktop(ctx context.Context, sessionAddress, directory string) (*atspiClient, error) {
	session, err := dbus.Connect(sessionAddress)
	if err != nil {
		return nil, err
	}
	defer session.Close()
	var address string
	if err := session.Object("org.a11y.Bus", "/org/a11y/bus").CallWithContext(ctx, "org.a11y.Bus.GetAddress", 0).Store(&address); err != nil {
		return nil, err
	}
	if err := validatePrivateATSPISocket(address, directory); err != nil {
		return nil, err
	}
	conn, err := dbus.Connect(address)
	if err != nil {
		return nil, err
	}
	seed := make([]byte, 16)
	if _, err := rand.Read(seed); err != nil {
		conn.Close()
		return nil, err
	}
	client := &atspiClient{connection: conn, root: atspiObject{"org.a11y.atspi.Registry", "/org/a11y/atspi/accessible/root"}, prefix: hex.EncodeToString(seed), references: make(map[string]atspiReference), changes: make(chan struct{}, 1), done: make(chan struct{})}
	signals := make(chan *dbus.Signal, 128)
	conn.Signal(signals)
	if err := conn.AddMatchSignal(dbus.WithMatchInterface("org.a11y.atspi.Event.Object")); err != nil {
		conn.Close()
		return nil, err
	}
	if err := conn.Object("org.a11y.atspi.Registry", "/org/a11y/atspi/registry").CallWithContext(ctx, "org.a11y.atspi.Registry.RegisterEvent", 0, "object:", []string{}, "").Err; err != nil {
		conn.Close()
		return nil, err
	}
	go func() {
		defer close(client.done)
		for signal := range signals {
			identityChanged := false
			if strings.HasSuffix(signal.Name, ".PropertyChange") && len(signal.Body) > 0 {
				property, _ := signal.Body[0].(string)
				identityChanged = slices.Contains([]string{"accessible-name", "accessible-role", "accessible-parent"}, property)
			}
			if strings.HasSuffix(signal.Name, ".ChildrenChanged") || identityChanged {
				client.revision.Add(1)
			}
			select {
			case client.changes <- struct{}{}:
			default:
			}
		}
	}()
	return client, nil
}

func validatePrivateATSPISocket(address, directory string) error {
	if !strings.HasPrefix(address, "unix:") || strings.Contains(address, ";") {
		return errors.New("AT-SPI requires one private Unix bus")
	}
	var socket string
	for _, field := range strings.Split(strings.TrimPrefix(address, "unix:"), ",") {
		key, value, ok := strings.Cut(field, "=")
		if !ok || (key != "path" && key != "guid") {
			return errors.New("unsupported AT-SPI bus address")
		}
		if key == "path" {
			if socket != "" {
				return errors.New("ambiguous AT-SPI socket")
			}
			decoded, err := url.PathUnescape(value)
			if err != nil {
				return err
			}
			socket = decoded
		}
	}
	relative, err := filepath.Rel(directory, socket)
	if !filepath.IsAbs(socket) || err != nil || relative == "." || relative == ".." || strings.HasPrefix(relative, "../") {
		return errors.New("AT-SPI bus escaped the private desktop")
	}
	return nil
}

func (c *atspiClient) close() { _ = c.connection.Close(); <-c.done }
func (c *atspiClient) call(ctx context.Context, object atspiObject, method string, args ...any) *dbus.Call {
	return c.connection.Object(object.Bus, object.Path).CallWithContext(ctx, method, 0, args...)
}

func (c *atspiClient) name(ctx context.Context, object atspiObject) (string, error) {
	var value dbus.Variant
	if err := c.call(ctx, object, "org.freedesktop.DBus.Properties.Get", atspiAccessible, "Name").Store(&value); err != nil {
		return "", err
	}
	name, ok := value.Value().(string)
	if !ok {
		return "", errors.New("invalid AT-SPI name")
	}
	return name, nil
}

func truncateATSPITerm(value string, limit int) string {
	runes := []rune(value)
	if len(runes) > limit {
		return string(runes[:limit])
	}
	return value
}

func (c *atspiClient) children(ctx context.Context, object atspiObject) ([]atspiObject, error) {
	var children []atspiObject
	err := c.call(ctx, object, atspiAccessible+".GetChildren").Store(&children)
	if len(children) > 5000 {
		return nil, errors.New("AT-SPI subtree exceeds its limit")
	}
	return children, err
}

func (c *atspiClient) role(ctx context.Context, object atspiObject) (string, error) {
	var role string
	err := c.call(ctx, object, atspiAccessible+".GetRoleName").Store(&role)
	return role, err
}

func (c *atspiClient) state(ctx context.Context, object atspiObject) (map[string]bool, error) {
	var bits []uint32
	if err := c.call(ctx, object, atspiAccessible+".GetState").Store(&bits); err != nil {
		return nil, err
	}
	states := make(map[string]bool)
	// AT-SPI 2 state values are the public bit-set contract, not GTK ordinals.
	for key, bit := range map[string]uint{"busy": 3, "invalid": 36, "focusable": 11, "multiline": 17, "modal": 16, "checked": 4, "indeterminate": 32, "defunct": 6, "editable": 7, "enabled": 8, "expanded": 10, "focused": 12, "selected": 23, "showing": 25, "visible": 30, "required": 33, "readonly": 43} {
		states[key] = int(bit/32) < len(bits) && bits[bit/32]&(1<<(bit%32)) != 0
	}
	return states, nil
}

func (c *atspiClient) safety(ctx context.Context) (*InteractionSafetyDecision, error) {
	queue := []atspiObject{c.root}
	seen := make(map[atspiObject]bool)
	reasons := []string{}
	for len(queue) > 0 && len(seen) < 5000 {
		node := queue[0]
		queue = queue[1:]
		if seen[node] {
			continue
		}
		seen[node] = true
		role, err := c.role(ctx, node)
		if err != nil {
			return nil, err
		}
		if role == "password text" {
			reasons = append(reasons, "secret_input")
		}
		children, err := c.children(ctx, node)
		if err != nil {
			return nil, err
		}
		queue = append(queue, children...)
		if len(queue) > 10000 {
			break
		}
	}
	if len(queue) > 0 && len(reasons) == 0 {
		return nil, errors.New("TARGET_OBSERVATION_UNAVAILABLE")
	}
	if len(reasons) > 0 {
		return &InteractionSafetyDecision{Level: "takeover", ReasonCodes: reasons}, nil
	}
	return &InteractionSafetyDecision{Level: "routine", SafeToCapture: true, SafeToSendToModel: true}, nil
}

func (c *atspiClient) describe(ctx context.Context, object atspiObject) (map[string]any, error) {
	role, err := c.role(ctx, object)
	if err != nil {
		return nil, err
	}
	name, err := c.name(ctx, object)
	if err != nil {
		return nil, err
	}
	state, err := c.state(ctx, object)
	if err != nil {
		return nil, err
	}
	var interfaces []string
	if err := c.call(ctx, object, atspiAccessible+".GetInterfaces").Store(&interfaces); err != nil {
		return nil, err
	}
	revision := c.revision.Load()
	identity := sha256.Sum256([]byte(name))
	ref := fmt.Sprintf("%s:%d:%s:%s:%x", c.prefix, revision, object.Bus, object.Path, sha256.Sum256([]byte(role+"\x00"+name)))
	if len(c.references) >= 2000 {
		clear(c.references)
	}
	c.references[ref] = atspiReference{object, role, identity, revision}
	actions := []string{"read"}
	if slices.Contains(interfaces, "org.a11y.atspi.Action") && state["enabled"] {
		actions = append(actions, "click")
	}
	if slices.Contains(interfaces, "org.a11y.atspi.EditableText") && state["editable"] && !state["readonly"] && role != "password text" {
		actions = append(actions, "fill")
	}
	state["disabled"] = !state["enabled"]
	semanticStates := map[string]any{}
	for key, value := range state {
		if key != "indeterminate" {
			semanticStates[key] = value
		}
	}
	if state["indeterminate"] {
		semanticStates["checked"] = "mixed"
	}
	output := map[string]any{"ref": ref, "child_refs": []string{}, "role": role, "platform_role": role, "name": truncateATSPITerm(name, 2000), "states": semanticStates, "actions": actions}
	if output["name"] != name {
		output["name_truncated"] = true
	}
	var description dbus.Variant
	if err := c.call(ctx, object, "org.freedesktop.DBus.Properties.Get", atspiAccessible, "Description").Store(&description); err != nil {
		if !atspiUnsupportedProperty(err) {
			return nil, err
		}
	} else if text, ok := description.Value().(string); ok && text != "" {
		output["description"] = truncateATSPITerm(text, 2000)
		if output["description"] != text {
			output["description_truncated"] = true
		}
	}
	if slices.Contains(interfaces, "org.a11y.atspi.Component") {
		var rect struct{ X, Y, Width, Height int32 }
		if err := c.call(ctx, object, "org.a11y.atspi.Component.GetExtents", uint32(0)).Store(&rect); err == nil {
			output["bounds"] = map[string]any{"x": rect.X, "y": rect.Y, "width": rect.Width, "height": rect.Height}
		}
	}
	if role != "password text" && slices.Contains(interfaces, "org.a11y.atspi.Text") {
		var count dbus.Variant
		if err := c.call(ctx, object, "org.freedesktop.DBus.Properties.Get", "org.a11y.atspi.Text", "CharacterCount").Store(&count); err != nil {
			return nil, err
		}
		length, ok := count.Value().(int32)
		if !ok || length < 0 {
			return nil, errors.New("invalid AT-SPI text size")
		}
		var text string
		if err := c.call(ctx, object, "org.a11y.atspi.Text.GetText", int32(0), min(length, 2000)).Store(&text); err != nil {
			return nil, err
		}
		output["value"] = text
		if length > 2000 {
			output["value_truncated"] = true
		}
	}
	return output, nil
}

func (c *atspiClient) observe(ctx context.Context, args map[string]any) (map[string]any, error) {
	revision := c.revision.Load()
	limit := 200
	if raw, exists := args["limit"]; exists {
		value, ok := raw.(float64)
		if !ok || value != float64(int(value)) || value < 1 || value > 1000 {
			return nil, errors.New("invalid AT-SPI observation limit")
		}
		limit = int(value)
	}
	root := c.root
	if ref, ok := args["root_ref"].(string); ok {
		resolved, err := c.resolve(ctx, map[string]any{"ref": ref})
		if err != nil {
			return nil, err
		}
		root = resolved.object
	}
	type queuedNode struct {
		object atspiObject
		parent string
	}
	queue := []queuedNode{{object: root}}
	seen := make(map[atspiObject]bool)
	nodes := []map[string]any{}
	indices := make(map[string]int)
	objects := make(map[atspiObject]string)
	ordered := []atspiObject{}
	for len(queue) > 0 && len(nodes) < limit {
		entry := queue[0]
		queue = queue[1:]
		if seen[entry.object] {
			continue
		}
		seen[entry.object] = true
		item, err := c.describe(ctx, entry.object)
		if err != nil {
			return nil, err
		}
		ref := item["ref"].(string)
		if entry.parent != "" {
			item["parent_ref"] = entry.parent
			parent := nodes[indices[entry.parent]]
			parent["child_refs"] = append(parent["child_refs"].([]string), ref)
		}
		indices[ref] = len(nodes)
		objects[entry.object] = ref
		nodes = append(nodes, item)
		ordered = append(ordered, entry.object)
		children, err := c.children(ctx, entry.object)
		if err != nil {
			return nil, err
		}
		for _, child := range children {
			queue = append(queue, queuedNode{child, ref})
		}
		if len(queue) > 10000 {
			break
		}
	}
	for index, object := range ordered {
		var relations []struct {
			Kind    uint32
			Targets []atspiObject
		}
		if err := c.call(ctx, object, atspiAccessible+".GetRelationSet").Store(&relations); err != nil {
			if atspiUnsupportedProperty(err) {
				continue
			}
			return nil, err
		}
		projected := map[string][]string{}
		for _, relation := range relations {
			key := map[uint32]string{2: "labelled_by", 3: "controls", 18: "described_by", 19: "details", 21: "error_message"}[relation.Kind]
			if key == "" {
				continue
			}
			for _, target := range relation.Targets {
				if ref := objects[target]; ref != "" && !slices.Contains(projected[key], ref) && len(projected[key]) < 64 {
					projected[key] = append(projected[key], ref)
				}
			}
		}
		if len(projected) > 0 {
			nodes[index]["relations"] = projected
		}
	}
	if revision != c.revision.Load() {
		return nil, errors.New("OBSERVATION_INVALIDATED")
	}
	return map[string]any{"semantic_schema_version": computerSemanticSchemaVersion, "document_id": fmt.Sprintf("%s:%d", c.prefix, revision), "nodes": nodes, "truncated": len(queue) > 0, "execution_mode": "background"}, nil
}

func atspiUnsupportedProperty(err error) bool {
	var busError dbus.Error
	if errors.As(err, &busError) {
		return slices.Contains([]string{"org.freedesktop.DBus.Error.UnknownProperty", "org.freedesktop.DBus.Error.UnknownMethod", "org.freedesktop.DBus.Error.NotSupported"}, busError.Name)
	}
	return false
}

func (c *atspiClient) resolve(ctx context.Context, selector map[string]any) (atspiReference, error) {
	if ref, ok := selector["ref"].(string); ok {
		entry, exists := c.references[ref]
		if !exists || entry.revision != c.revision.Load() {
			return atspiReference{}, errors.New("STALE_REFERENCE")
		}
		role, roleErr := c.role(ctx, entry.object)
		name, nameErr := c.name(ctx, entry.object)
		state, stateErr := c.state(ctx, entry.object)
		if roleErr != nil || nameErr != nil || stateErr != nil || state["defunct"] || role != entry.role || sha256.Sum256([]byte(name)) != entry.nameIdentity {
			return atspiReference{}, errors.New("STALE_REFERENCE")
		}
		return entry, nil
	}
	roles := []string{}
	if role, ok := selector["role"].(string); ok {
		roles = append(roles, role)
	}
	if values, ok := selector["roles"].([]any); ok {
		for _, value := range values {
			role, ok := value.(string)
			if !ok {
				return atspiReference{}, errors.New("INVALID_REQUEST")
			}
			roles = append(roles, role)
		}
	}
	name, nameOK := selector["name"].(string)
	exact, _ := selector["exact"].(bool)
	if len(roles) == 0 {
		return atspiReference{}, errors.New("INVALID_REQUEST")
	}
	observeArgs := map[string]any{"limit": float64(1000)}
	if root, exists := selector["root_ref"]; exists {
		observeArgs["root_ref"] = root
	}
	observed, err := c.observe(ctx, observeArgs)
	if err != nil {
		return atspiReference{}, err
	}
	if observed["truncated"] == true {
		return atspiReference{}, errors.New("AMBIGUOUS_ELEMENT")
	}
	var matches []atspiReference
	for _, node := range observed["nodes"].([]map[string]any) {
		if !slices.Contains(roles, node["role"].(string)) {
			continue
		}
		entry := c.references[node["ref"].(string)]
		candidateName, err := c.name(ctx, entry.object)
		if err != nil {
			return atspiReference{}, err
		}
		if sha256.Sum256([]byte(candidateName)) != entry.nameIdentity {
			return atspiReference{}, errors.New("STALE_REFERENCE")
		}
		nameMatch := !nameOK || (exact && candidateName == name) || (!exact && strings.Contains(strings.ToLower(candidateName), strings.ToLower(name)))
		if nameMatch {
			matches = append(matches, c.references[node["ref"].(string)])
		}
	}
	if len(matches) == 0 {
		return atspiReference{}, errors.New("ELEMENT_NOT_FOUND")
	}
	if len(matches) != 1 {
		return atspiReference{}, errors.New("AMBIGUOUS_ELEMENT")
	}
	return matches[0], nil
}

func (c *atspiClient) action(ctx context.Context, args map[string]any) (map[string]any, error) {
	selector, _ := args["selector"].(map[string]any)
	if args["action"] == "wait" {
		return c.wait(ctx, selector, args)
	}
	entry, err := c.resolve(ctx, selector)
	if err != nil {
		return nil, err
	}
	switch args["action"] {
	case "read":
		node, err := c.describe(ctx, entry.object)
		return map[string]any{"semantic_schema_version": computerSemanticSchemaVersion, "node": node}, err
	case "click":
		var countValue dbus.Variant
		if err := c.call(ctx, entry.object, "org.freedesktop.DBus.Properties.Get", "org.a11y.atspi.Action", "NActions").Store(&countValue); err != nil {
			return nil, errors.New("TARGET_CAPABILITY_UNAVAILABLE")
		}
		count, ok := countValue.Value().(int32)
		if !ok || count < 0 || count > 64 {
			return nil, errors.New("TARGET_CAPABILITY_UNAVAILABLE")
		}
		index := -1
		for i := int32(0); i < count; i++ {
			// GetActions exposes localized labels. Only GetName is a machine
			// action identity and is stable across application locales.
			var name string
			if err := c.call(ctx, entry.object, "org.a11y.atspi.Action.GetName", i).Store(&name); err != nil {
				return nil, errors.New("TARGET_CAPABILITY_UNAVAILABLE")
			}
			if slices.Contains([]string{"click", "press", "activate"}, name) {
				if index >= 0 {
					return nil, errors.New("AMBIGUOUS_ELEMENT")
				}
				index = int(i)
			}
		}
		if index < 0 {
			return nil, errors.New("TARGET_CAPABILITY_UNAVAILABLE")
		}
		var confirmed bool
		if err := c.call(ctx, entry.object, "org.a11y.atspi.Action.DoAction", int32(index)).Store(&confirmed); err != nil || !confirmed {
			return nil, errComputerEffectUnknown
		}
	case "fill":
		text, ok := args["text"].(string)
		if !ok || len(text) > 20000 || entry.role == "password text" {
			return nil, errors.New("INVALID_REQUEST")
		}
		state, err := c.state(ctx, entry.object)
		if err != nil {
			return nil, err
		}
		if !state["editable"] || state["readonly"] || !state["enabled"] {
			return nil, errors.New("TARGET_CAPABILITY_UNAVAILABLE")
		}
		var confirmed bool
		if err := c.call(ctx, entry.object, "org.a11y.atspi.EditableText.SetTextContents", text).Store(&confirmed); err != nil || !confirmed {
			return nil, errComputerEffectUnknown
		}
	default:
		return nil, errors.New("TARGET_CAPABILITY_UNAVAILABLE")
	}
	return map[string]any{"action_executed": true, "execution_mode": "background"}, nil
}

func (c *atspiClient) wait(ctx context.Context, selector, args map[string]any) (map[string]any, error) {
	state := "visible"
	if value, ok := args["state"].(string); ok {
		state = value
	}
	if !slices.Contains([]string{"visible", "hidden", "enabled"}, state) {
		return nil, errors.New("INVALID_REQUEST")
	}
	timeout := 10 * time.Second
	if raw, exists := args["timeout_ms"]; exists {
		value, ok := raw.(float64)
		if !ok || value < 0 || value > 30000 || value != float64(int(value)) {
			return nil, errors.New("INVALID_REQUEST")
		}
		timeout = time.Duration(value) * time.Millisecond
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	for {
		entry, err := c.resolve(ctx, selector)
		invalidated := atspiWaitInvalidated(err)
		if err != nil && err.Error() != "ELEMENT_NOT_FOUND" && !invalidated {
			return nil, err
		}
		found, enabled := err == nil, false
		if found {
			states, err := c.state(ctx, entry.object)
			invalidated = atspiWaitInvalidated(err)
			if err != nil && !invalidated {
				return nil, err
			}
			found = states["showing"]
			enabled = states["enabled"]
		}
		// A removed object invalidates this read, not the wait condition. Only
		// a complete observation can establish that the selected control is hidden.
		if !invalidated && ((state == "hidden" && !found) || (state == "visible" && found) || (state == "enabled" && found && enabled)) {
			return map[string]any{"state": state}, nil
		}
		select {
		case <-ctx.Done():
			if ctx.Err() != context.DeadlineExceeded {
				return nil, ctx.Err()
			}
			return map[string]any{"state": "timeout", "requested_state": state, "last_known": map[string]any{"found": found, "enabled": enabled}}, nil
		case <-c.changes:
		}
	}
}

func atspiWaitInvalidated(err error) bool {
	if err == nil {
		return false
	}
	var busError dbus.Error
	return err.Error() == "STALE_REFERENCE" || err.Error() == "OBSERVATION_INVALIDATED" || (errors.As(err, &busError) && busError.Name == "org.freedesktop.DBus.Error.UnknownObject")
}
