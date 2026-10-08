package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/gatewayservice"
	"github.com/floegence/redeven/internal/gatewaystate"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

const membershipHelp = `Usage:
  redeven-gateway invite --output PATH [--state-root PATH]
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

Invitations expire after ten minutes and can be used by one Runtime.
The endpoints file is a JSON array of endpoint_id, address, scope and priority.
Policy set previews affected members; --apply saves with a version check.
Automatic publication still requires Namespace authorization in Redeven Cloud.
Host commands require the running Gateway's private local administrator credential.
`

func hostAdminTokenPath(root string) string { return filepath.Join(root, "gateway-host-admin.json") }

func (c *cli) membershipCmd(args []string) int {
	command, action, rest := args[0], "", args[1:]
	if command != "invite" && len(rest) > 0 && !strings.HasPrefix(rest[0], "-") {
		action, rest = rest[0], rest[1:]
	}
	flags := newFlagSet(command)
	root := flags.String("state-root", "", "Gateway state root")
	output := flags.String("output", "", "Create a private invitation file; use - for stdout")
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
		valid = valid && *clientKeyID == "" && *member == "" && *output == "" && *version == 0 && *cloud == "" && *defaultCloud == "" && *mode == "" && !*apply
	case "clients/revoke":
		valid = valid && *clientKeyID != "" && *member == "" && *output == "" && *version == 0 && *cloud == "" && *defaultCloud == "" && *mode == "" && !*apply
	case "endpoints/show", "endpoints/set":
		valid = valid && *output == "" && *member == "" && *version == 0 && *cloud == "" && *defaultCloud == "" && *mode == "" && !*apply && ((action == "show" && *filePath == "") || (action == "set" && *filePath != ""))
	case "invite/":
		valid = valid && *output != "" && *member == "" && *version == 0 && *cloud == "" && *defaultCloud == "" && *mode == "" && !*apply
	case "members/list", "policy/show":
		valid = valid && *output == "" && *member == "" && *version == 0 && *cloud == "" && *defaultCloud == "" && *mode == "" && !*apply
	case "members/remove", "members/reevaluate":
		valid = valid && *member != "" && *version > 0 && *cloud == "" && *defaultCloud == "" && *mode == "" && *output == "" && !*apply
	case "members/policy":
		valid = valid && *member != "" && *version > 0 && (*cloud == "inherit" || *cloud == "allow" || *cloud == "deny") && *defaultCloud == "" && *mode == "" && *output == "" && !*apply
	case "policy/set":
		valid = valid && (*defaultCloud != "" || *mode != "") && (*defaultCloud == "" || *defaultCloud == "allow" || *defaultCloud == "deny") && (*mode == "" || *mode == "manual" || *mode == "automatic") && *member == "" && *version == 0 && *cloud == "" && *output == ""
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
	defer client.transport.CloseIdleConnections()
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
		var invitation gp.MemberInvitation
		err = client.request(ctx, "/gateway/v5/invitations", gp.InvitationRequest{ProtocolVersion: gp.Version}, &invitation)
		if err == nil && *output != "-" {
			err = writeInvitationFile(*output, invitation)
			if err == nil {
				fmt.Fprintln(c.stdout, "Invitation saved. Confirm membership on the Runtime before it expires.")
				return 0
			}
		}
		result = invitation
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

func writeInvitationFile(path string, invitation gp.MemberInvitation) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return errors.New("cannot create private invitation file; choose a new path")
	}
	defer file.Close()
	if err := json.NewEncoder(file).Encode(invitation); err != nil {
		_ = os.Remove(path)
		return errors.New("cannot write invitation file")
	}
	return file.Sync()
}

type hostAdminClient struct {
	endpoint, token string
	transport       *http.Transport
}

func newHostAdminClient(root string) (*hostAdminClient, error) {
	status := readServiceStatus(root)
	if status.Status != "running" {
		return nil, errors.New("gateway is not running; start it before managing members")
	}
	host, port, err := net.SplitHostPort(status.Listen)
	if err != nil {
		return nil, errors.New("invalid Gateway administration endpoint")
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return nil, errors.New("gateway administration requires a local IP endpoint")
	}
	if ip.IsUnspecified() {
		if ip.To4() == nil {
			host = "::1"
		} else {
			host = "127.0.0.1"
		}
	} else if !ip.IsLoopback() {
		return nil, errors.New("gateway administration listener must include loopback")
	}
	var token string
	if err := gatewaystate.Read(hostAdminTokenPath(root), &token); err != nil || len(token) < 32 {
		return nil, errors.New("gateway host administrator credential is unavailable")
	}
	return &hostAdminClient{endpoint: "http://" + net.JoinHostPort(host, port), token: token, transport: &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: 5 * time.Second}).DialContext, MaxResponseHeaderBytes: 16 << 10}}, nil
}

func (c *hostAdminClient) request(ctx context.Context, route string, input, output any) error {
	raw, err := json.Marshal(input)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint+route, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	request.Header.Set(gatewayservice.HostAdminHeader, c.token)
	request.Header.Set("Content-Type", "application/json")
	client := &http.Client{Transport: c.transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		return errors.New("gateway administration is unavailable")
	}
	defer response.Body.Close()
	var envelope struct {
		OK    bool            `json:"ok"`
		Data  json.RawMessage `json:"data"`
		Error *struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&envelope) != nil {
		return errors.New("invalid Gateway administration response")
	}
	if response.StatusCode != http.StatusOK || !envelope.OK {
		if envelope.Error != nil {
			return fmt.Errorf("gateway operation failed (%s)", envelope.Error.Code)
		}
		return errors.New("gateway operation failed")
	}
	if output != nil {
		return json.Unmarshal(envelope.Data, output)
	}
	return nil
}
