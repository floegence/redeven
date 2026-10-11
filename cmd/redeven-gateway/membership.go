package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"io"
	"os"
	"strings"
	"time"

	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	"github.com/floegence/redeven/internal/gatewayhost"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

const membershipHelp = `Usage:
  redeven-gateway invite [--state-root PATH]
  redeven-gateway endpoints show [--state-root PATH]
  redeven-gateway endpoints set --file PATH [--state-root PATH]
  redeven-gateway clients access-code [--state-root PATH]
  redeven-gateway clients list [--state-root PATH]
  redeven-gateway clients revoke --client ID [--state-root PATH]
  redeven-gateway members list [--state-root PATH]
  redeven-gateway members remove --member ID --version N [--state-root PATH]
  redeven-gateway members reevaluate --member ID --version N [--state-root PATH]
  redeven-gateway members policy --member ID --version N --cloud inherit|allow|deny [--state-root PATH]
  redeven-gateway policy show [--state-root PATH]
  redeven-gateway policy set [--default-cloud allow|deny] [--publication-mode manual|automatic] [--apply] [--state-root PATH]

Invitation codes expire after ten minutes and can be used by one Runtime. The command prints the administrator's address and code; it never writes a join file.
The endpoints file is a JSON array of endpoint_id, address, scope and priority.
Policy set previews affected members; --apply saves with a version check.
Automatic publication still requires Namespace authorization in Redeven Cloud.
Host commands require the running Gateway's private local administrator credential.
`

func hostAdminTokenPath(root string) string { return gatewayhost.TokenPath(root) }

func (c *cli) membershipCmd(args []string) int {
	command, action, rest := args[0], "", args[1:]
	if command != "invite" && len(rest) > 0 && !strings.HasPrefix(rest[0], "-") {
		action, rest = rest[0], rest[1:]
	}
	flags := newFlagSet(command)
	root := flags.String("state-root", "", "Gateway state root")
	filePath := flags.String("file", "", "JSON file containing administrator-confirmed connection endpoints")
	clientKeyID := flags.String("client", "", "Client key ID")
	member := flags.String("member", "", "Member ID")
	version := flags.Int64("version", 0, "Expected member version")
	cloud := flags.String("cloud", "", "Member Cloud permission: inherit, allow, deny")
	defaultCloud := flags.String("default-cloud", "", "New member default: allow, deny")
	mode := flags.String("publication-mode", "", "Publication mode: manual, automatic")
	apply := flags.Bool("apply", false, "Save the previewed policy change")
	if err := parseFlags(flags, rest); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, membershipHelp)
			return 0
		}
		writeError(c.stderr, err.Error())
		return 2
	}
	valid := flags.NArg() == 0 && (command == "endpoints" || *filePath == "") && ((command == "clients" && action == "revoke") || *clientKeyID == "")
	switch command + "/" + action {
	case "clients/access-code", "clients/list":
		valid = valid && *clientKeyID == "" && *member == "" && *version == 0 && *cloud == "" && *defaultCloud == "" && *mode == "" && !*apply
	case "clients/revoke":
		valid = valid && *clientKeyID != "" && *member == "" && *version == 0 && *cloud == "" && *defaultCloud == "" && *mode == "" && !*apply
	case "endpoints/show", "endpoints/set":
		valid = valid && *member == "" && *version == 0 && *cloud == "" && *defaultCloud == "" && *mode == "" && !*apply && ((action == "show" && *filePath == "") || (action == "set" && *filePath != ""))
	case "invite/":
		valid = valid && *member == "" && *version == 0 && *cloud == "" && *defaultCloud == "" && *mode == "" && !*apply
	case "members/list", "policy/show":
		valid = valid && *member == "" && *version == 0 && *cloud == "" && *defaultCloud == "" && *mode == "" && !*apply
	case "members/remove", "members/reevaluate":
		valid = valid && *member != "" && *version > 0 && *cloud == "" && *defaultCloud == "" && *mode == "" && !*apply
	case "members/policy":
		valid = valid && *member != "" && *version > 0 && (*cloud == "inherit" || *cloud == "allow" || *cloud == "deny") && *defaultCloud == "" && *mode == "" && !*apply
	case "policy/set":
		valid = valid && (*defaultCloud != "" || *mode != "") && (*defaultCloud == "" || *defaultCloud == "allow" || *defaultCloud == "deny") && (*mode == "" || *mode == "manual" || *mode == "automatic") && *member == "" && *version == 0 && *cloud == ""
	default:
		valid = false
	}
	if !valid {
		writeText(c.stderr, membershipHelp)
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
	var result any
	switch command + "/" + action {
	case "clients/access-code":
		err = client.request(ctx, "/gateway/v5/clients/access-codes", gp.ClientAccessCodeRequest{ProtocolVersion: gp.Version}, &result)
	case "clients/list":
		err = client.request(ctx, "/gateway/v5/clients/list", gp.ClientListRequest{ProtocolVersion: gp.Version}, &result)
	case "clients/revoke":
		err = client.request(ctx, "/gateway/v5/clients/revoke", gp.ClientRevokeRequest{ProtocolVersion: gp.Version, ClientKeyID: *clientKeyID}, &result)
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
		err = client.request(ctx, "/gateway/v5/endpoints", gp.EndpointUpdateRequest{ProtocolVersion: gp.Version, Endpoints: endpoints}, &updated)
		result = updated.Endpoints
	case "invite/":
		var delivery gc.InvitationCodeDelivery
		err = client.request(ctx, "/gateway/v5/invitation-codes", gp.InvitationRequest{ProtocolVersion: gp.Version}, &delivery)
		result = delivery
	case "members/remove":
		err = client.request(ctx, "/gateway/v5/members/remove", gp.RemoveMemberRequest{ProtocolVersion: gp.Version, MemberID: *member, ExpectedMemberVersion: *version}, &result)
	case "members/reevaluate":
		err = client.request(ctx, "/gateway/v5/members/reevaluate", gp.RemoveMemberRequest{ProtocolVersion: gp.Version, MemberID: *member, ExpectedMemberVersion: *version}, &result)
	case "members/policy":
		var results []gp.MemberOperationResult
		err = client.request(ctx, "/gateway/v5/members/policy", gp.UpdateMembersRequest{ProtocolVersion: gp.Version, Items: []gp.MemberPolicyUpdate{{MemberID: *member, ExpectedMemberVersion: *version, CloudPermission: gp.CloudPermission(*cloud)}}}, &results)
		result = results
	default:
		var catalog gp.CatalogResponse
		err = client.request(ctx, "/gateway/v5/catalog", gp.CatalogRequest{ProtocolVersion: gp.Version}, &catalog)
		if err != nil {
			break
		}
		if command == "members" {
			result = catalog.Members
			break
		}
		if command == "endpoints" {
			result = catalog.Gateway.MemberEndpoints
			break
		}
		if action == "show" {
			result = catalog
			break
		}
		policy := catalog.Policy
		if *defaultCloud != "" {
			policy.DefaultCloudAllowed = *defaultCloud == "allow"
		}
		if *mode != "" {
			policy.PublicationMode = gp.PublicationMode(*mode)
		}
		affected := []gp.Member{}
		for _, item := range catalog.Members {
			if item.CloudPermission == gp.CloudInherit && policy.DefaultCloudAllowed != catalog.Policy.DefaultCloudAllowed {
				affected = append(affected, item)
			}
		}
		if *apply {
			err = client.request(ctx, "/gateway/v5/policy", gp.UpdatePolicyRequest{ProtocolVersion: gp.Version, ExpectedRevision: catalog.Policy.Revision, Policy: policy}, nil)
			if err == nil {
				policy.Revision = catalog.Policy.Revision + 1
			}
		}
		result = struct {
			Policy   gp.GatewayPolicy `json:"policy"`
			Affected []gp.Member      `json:"affected_members"`
			Applied  bool             `json:"applied"`
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

type hostAdminClient struct{ client *gatewayhost.Client }

func newHostAdminClient(root string) (*hostAdminClient, error) {
	status := readServiceStatus(root)
	if status.Status != "running" {
		return nil, errors.New("gateway is not running; start it before managing members")
	}
	client, err := gatewayhost.New(root, status.Listen)
	if err != nil {
		return nil, err
	}
	return &hostAdminClient{client}, nil
}
func (c *hostAdminClient) request(ctx context.Context, route string, input, output any) error {
	return c.client.Request(ctx, route, input, output)
}
