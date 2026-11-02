package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"flag"
	"io"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/gatewayhost"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

const attachmentHelp = `Usage:
  redeven-gateway operations query --operation-id ID [--state-root PATH]
  redeven-gateway invite [--state-root PATH]
  redeven-gateway endpoints show [--state-root PATH]
  redeven-gateway endpoints set --file PATH [--state-root PATH]
  redeven-gateway clients access-code [--state-root PATH]
  redeven-gateway clients list [--state-root PATH]
  redeven-gateway clients revoke --client ID [--state-root PATH]
  redeven-gateway attachments list [--state-root PATH]
  redeven-gateway attachments remove --attachment ID --version N [--state-root PATH]
  redeven-gateway attachments reevaluate --attachment ID --version N [--state-root PATH]
  redeven-gateway attachments policy --attachment ID --version N --egress inherit|allow|deny [--state-root PATH]
  redeven-gateway policy show [--state-root PATH]
  redeven-gateway policy set [--default-egress allow|deny] [--destinations host:443,host:8443] [--apply] [--state-root PATH]

Invitation codes expire after ten minutes and can be used by one Runtime. The command prints the administrator's address and code; it never writes a join file.
The endpoints file is a JSON array of endpoint_id, address, scope and priority.
Policy set previews affected attachments; --apply saves with a version check.
Egress is local network policy; an empty destination list disables forwarding.
Mutating commands accept --operation-id ID. Preserve the ID to query an uncertain result.
Host commands require the running Gateway's private local administrator credential.
`

func hostAdminTokenPath(root string) string { return gatewayhost.TokenPath(root) }

func (c *cli) attachmentCmd(args []string) int {
	command, action, rest := args[0], "", args[1:]
	if command != "invite" && len(rest) > 0 && !strings.HasPrefix(rest[0], "-") {
		action, rest = rest[0], rest[1:]
	}
	flags := newFlagSet(command)
	operationID := flags.String("operation-id", "", "Stable operation ID for mutation or result recovery")
	root := flags.String("state-root", "", "Gateway state root")
	filePath := flags.String("file", "", "JSON file containing administrator-confirmed connection endpoints")
	clientKeyID := flags.String("client", "", "Client key ID")
	member := flags.String("attachment", "", "Runtime attachment ID")
	version := flags.Int64("version", 0, "Expected attachment version")
	cloud := flags.String("egress", "", "Runtime egress permission: inherit, allow, deny")
	defaultCloud := flags.String("default-egress", "", "New attachment default: allow, deny")
	destinations := flags.String("destinations", "", "Comma-separated exact host:port destinations; use none to disable forwarding")
	apply := flags.Bool("apply", false, "Save the previewed policy change")
	if err := parseFlags(flags, rest); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, attachmentHelp)
			return 0
		}
		writeError(c.stderr, err.Error())
		return 2
	}
	valid := flags.NArg() == 0 && (command == "endpoints" || *filePath == "") && ((command == "clients" && action == "revoke") || *clientKeyID == "")
	switch command + "/" + action {
	case "operations/query":
		valid = valid && *operationID != "" && *clientKeyID == "" && *member == "" && *version == 0 && *cloud == "" && *defaultCloud == "" && *destinations == "" && !*apply
	case "clients/access-code", "clients/list":
		valid = valid && *clientKeyID == "" && *member == "" && *version == 0 && *cloud == "" && *defaultCloud == "" && *destinations == "" && !*apply
	case "clients/revoke":
		valid = valid && *clientKeyID != "" && *member == "" && *version == 0 && *cloud == "" && *defaultCloud == "" && *destinations == "" && !*apply
	case "endpoints/show", "endpoints/set":
		valid = valid && *member == "" && *version == 0 && *cloud == "" && *defaultCloud == "" && *destinations == "" && !*apply && ((action == "show" && *filePath == "") || (action == "set" && *filePath != ""))
	case "invite/":
		valid = valid && *member == "" && *version == 0 && *cloud == "" && *defaultCloud == "" && *destinations == "" && !*apply
	case "attachments/list", "policy/show":
		valid = valid && *member == "" && *version == 0 && *cloud == "" && *defaultCloud == "" && *destinations == "" && !*apply
	case "attachments/remove", "attachments/reevaluate":
		valid = valid && *member != "" && *version > 0 && *cloud == "" && *defaultCloud == "" && *destinations == "" && !*apply
	case "attachments/policy":
		valid = valid && *member != "" && *version > 0 && (*cloud == "inherit" || *cloud == "allow" || *cloud == "deny") && *defaultCloud == "" && *destinations == "" && !*apply
	case "policy/set":
		valid = valid && (*defaultCloud != "" || *destinations != "") && (*defaultCloud == "" || *defaultCloud == "allow" || *defaultCloud == "deny") && *member == "" && *version == 0 && *cloud == ""
	default:
		valid = false
	}
	if !valid {
		writeText(c.stderr, attachmentHelp)
		return 2
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	client, err := newHostAdminClient(normalizeStateRoot(*root))
	if err != nil {
		writeError(c.stderr, err.Error())
		return 1
	}
	defer client.client.Close()
	client.operationID = *operationID
	if client.operationID == "" {
		client.operationID = rand.Text()
	}
	var result any
	switch command + "/" + action {
	case "operations/query":
		err = client.request(ctx, "/gateway/v6/operations/query", gp.CatalogRequest{ProtocolVersion: gp.Version}, &result)
	case "clients/access-code":
		err = client.request(ctx, "/gateway/v6/clients/access-codes", gp.ClientAccessCodeRequest{ProtocolVersion: gp.Version}, &result)
	case "clients/list":
		err = client.request(ctx, "/gateway/v6/clients/list", gp.ClientListRequest{ProtocolVersion: gp.Version}, &result)
	case "clients/revoke":
		err = client.request(ctx, "/gateway/v6/clients/revoke", gp.ClientRevokeRequest{ProtocolVersion: gp.Version, ClientKeyID: *clientKeyID}, &result)
	case "endpoints/set":
		file, openErr := os.Open(*filePath)
		if openErr != nil {
			writeError(c.stderr, "cannot read connection endpoints file")
			return 1
		}
		defer file.Close()
		decoder := json.NewDecoder(io.LimitReader(file, 64<<10))
		decoder.DisallowUnknownFields()
		var endpoints []gp.GatewayEndpoint
		if decoder.Decode(&endpoints) != nil || decoder.Decode(new(any)) != io.EOF {
			writeError(c.stderr, "invalid connection endpoints file")
			return 2
		}
		var updated gp.EndpointUpdateResponse
		err = client.request(ctx, "/gateway/v6/endpoints", gp.EndpointUpdateRequest{ProtocolVersion: gp.Version, Endpoints: endpoints}, &updated)
		result = updated.Endpoints
	case "invite/":
		var delivery gp.InvitationCodeDelivery
		err = client.request(ctx, "/gateway/v6/invitation-codes", gp.InvitationRequest{ProtocolVersion: gp.Version}, &delivery)
		result = delivery
	case "attachments/remove":
		err = client.request(ctx, "/gateway/v6/attachments/remove", gp.RemoveMemberRequest{ProtocolVersion: gp.Version, AttachmentID: *member, ExpectedAttachmentVersion: *version}, &result)
	case "attachments/reevaluate":
		err = client.request(ctx, "/gateway/v6/attachments/reevaluate", gp.RemoveMemberRequest{ProtocolVersion: gp.Version, AttachmentID: *member, ExpectedAttachmentVersion: *version}, &result)
	case "attachments/policy":
		var results []gp.MemberOperationResult
		err = client.request(ctx, "/gateway/v6/attachments/policy", gp.UpdateMembersRequest{ProtocolVersion: gp.Version, Items: []gp.MemberPolicyUpdate{{AttachmentID: *member, ExpectedAttachmentVersion: *version, EgressPermission: gp.EgressPermission(*cloud)}}}, &results)
		result = results
	default:
		var catalog gp.CatalogResponse
		err = client.request(ctx, "/gateway/v6/catalog", gp.CatalogRequest{ProtocolVersion: gp.Version}, &catalog)
		if err != nil {
			break
		}
		if command == "attachments" {
			result = catalog.Attachments
			break
		}
		if command == "endpoints" {
			result = catalog.Gateway.Endpoints
			break
		}
		if action == "show" {
			result = catalog
			break
		}
		policy := catalog.Policy
		if *defaultCloud != "" {
			policy.DefaultEgressAllowed = *defaultCloud == "allow"
		}
		if *destinations != "" {
			policy.Destinations = []string{}
			if *destinations != "none" {
				policy.Destinations = strings.Split(*destinations, ",")
			}
			if err := gp.ValidateEgressDestinations(policy.Destinations); err != nil {
				writeError(c.stderr, err.Error())
				return 2
			}
		}
		affected := []gp.RuntimeAttachment{}
		for _, item := range catalog.Attachments {
			if policyAffectsAttachment(item, catalog.Policy, policy) {
				affected = append(affected, item)
			}
		}
		if *apply {
			err = client.request(ctx, "/gateway/v6/policy", gp.UpdatePolicyRequest{ProtocolVersion: gp.Version, ExpectedRevision: catalog.Policy.Revision, Policy: policy}, nil)
			if err == nil {
				policy.Revision = catalog.Policy.Revision + 1
			}
		}
		result = struct {
			Policy   gp.GatewayPolicy       `json:"policy"`
			Affected []gp.RuntimeAttachment `json:"affected_attachments"`
			Applied  bool                   `json:"applied"`
		}{policy, affected, *apply && err == nil}
	}
	if err != nil {
		writeError(c.stderr, err.Error())
		return 1
	}
	if err := json.NewEncoder(c.stdout).Encode(result); err != nil {
		return 1
	}
	if results, ok := result.([]gp.MemberOperationResult); ok {
		for _, item := range results {
			if item.ErrorCode != "" {
				return 1
			}
		}
	}
	return 0
}

type hostAdminClient struct {
	client      *gatewayhost.Client
	operationID string
}

func newHostAdminClient(root string) (*hostAdminClient, error) {
	status := readServiceStatus(root)
	if status.Status != "running" {
		return nil, errors.New("gateway is not running; start it before managing attachments")
	}
	client, err := gatewayhost.New(root, status.Listen)
	if err != nil {
		return nil, err
	}
	return &hostAdminClient{client: client}, nil
}
func (c *hostAdminClient) request(ctx context.Context, route string, input, output any) error {
	if c.operationID == "" {
		return c.client.Request(ctx, route, input, output)
	}
	return c.client.RequestWithOperation(ctx, route, input, output, c.operationID)
}

func policyAffectsAttachment(item gp.RuntimeAttachment, before, after gp.GatewayPolicy) bool {
	if item.State != "active" || item.EgressPermission == gp.EgressDeny {
		return false
	}
	oldDestinations, newDestinations := slices.Clone(before.Destinations), slices.Clone(after.Destinations)
	slices.Sort(oldDestinations)
	slices.Sort(newDestinations)
	return (item.EgressPermission == gp.EgressInherit && before.DefaultEgressAllowed != after.DefaultEgressAllowed) || (!slices.Equal(oldDestinations, newDestinations) && (item.EgressPermission == gp.EgressAllow || before.DefaultEgressAllowed || after.DefaultEgressAllowed))
}
