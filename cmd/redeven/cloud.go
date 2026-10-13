package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"time"

	"github.com/floegence/redeven/internal/runtimecloud"
	rc "github.com/floegence/redeven/internal/runtimecloud/protocol"
	"github.com/floegence/redeven/internal/runtimemanagement"
)

const cloudHelp = `Usage: redeven cloud <status|manage|retry|disconnect|route|query|commit|cancel|enrollment> [flags]

 --state-root PATH          Runtime state root
 --route direct|gateway    Preflight the selected Cloud route
 --member-id ID            Gateway member for --route gateway
 --operation-id ID         Original route operation ID for query, commit or cancel
 --yes                     Confirm commit or disconnect in automation

Run the Runtime before managing Cloud. Route preflight prints an operation ID;
query it after an unknown result, then commit that same ID after confirmation.
A route switch preserves Cloud identity and ownership. Background tasks continue.
Disconnect stops local Cloud intent. Retry resumes intent without granting approval.
Manage serves a short-lived local owner UI. Enrollment status/resume/cancel manages
the original unfinished registration while the Runtime is stopped.
`

func (c *cli) cloudCmd(args []string) int {
	if len(args) > 0 && args[0] == "enrollment" {
		return c.cloudEnrollmentCmd(args[1:])
	}
	if len(args) == 0 || isHelpToken(args[0]) {
		writeText(c.stdout, cloudHelp)
		return 0
	}
	action := args[0]
	flags := newCLIFlagSet("cloud " + action)
	root := flags.String("state-root", "", "Runtime state root")
	kind := flags.String("route", "", "Cloud route")
	member := flags.String("member-id", "", "Gateway member")
	operationID := flags.String("operation-id", "", "Original operation ID")
	yes := flags.Bool("yes", false, "Confirm committed changes")
	if err := parseCommandFlags(flags, args[1:]); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, cloudHelp)
			return 0
		}
		return 2
	}
	if flags.NArg() != 0 {
		writeText(c.stderr, cloudHelp)
		return 2
	}
	switch action {
	case "status", "manage", "retry", "disconnect", "route", "query", "commit", "cancel":
	default:
		writeText(c.stderr, cloudHelp)
		return 2
	}
	if action == "route" && (*kind != "direct" && *kind != "gateway" || *kind == "gateway" && *member == "" || *kind == "direct" && *member != "") || action != "route" && (*kind != "" || *member != "") {
		writeText(c.stderr, cloudHelp)
		return 2
	}
	if (action == "query" || action == "commit" || action == "cancel") != (*operationID != "") {
		writeText(c.stderr, cloudHelp)
		return 2
	}
	layout, err := resolveBootstrapTargetLayout(*root)
	if err != nil {
		return c.printRunStateLayoutGuidance(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	status, err := runtimemanagement.LoadStatus(ctx, layout.RuntimeControlSocketPath, 2*time.Second)
	if err != nil {
		fmt.Fprintln(c.stderr, "Start this Runtime, then retry Cloud management. Local configuration was not changed.")
		return 1
	}
	cloud := status.RuntimeService.Bindings.CloudLink.Cloud
	if action == "manage" {
		return c.cloudManage(layout.RuntimeControlSocketPath)
	}
	method, path, body := http.MethodGet, "/v2/cloud-link", any(struct{}{})
	switch action {
	case "retry":
		if cloud == nil {
			fmt.Fprintln(c.stderr, "Enroll this Runtime with a setup ticket or gateway publish first.")
			return 1
		}
		method, path, body = http.MethodPost, "/v2/cloud/retry", rc.RetryRequest{ExpectedAssociationRevision: cloud.AssociationRevision}
	case "disconnect":
		if !*yes && !c.confirmGatewayAction("Disconnect Cloud sessions and stop local Cloud intent? Background tasks continue.") {
			return 1
		}
		method, path = http.MethodPost, "/v2/cloud-link/disconnect"
	case "route":
		if cloud == nil {
			fmt.Fprintln(c.stderr, "Enroll this Runtime before choosing a Cloud route.")
			return 1
		}
		id, err := runtimecloud.NewOperationID()
		if err != nil {
			fmt.Fprintln(c.stderr, err)
			return 1
		}
		fmt.Fprintln(c.stdout, "Route operation ID:", id)
		method, path, body = http.MethodPost, "/v2/cloud/route/preflight", rc.RoutePreflightRequest{OperationID: id, ExpectedRouteRevision: cloud.RouteRevision, Selection: rc.RouteSelection{Kind: *kind, MemberID: *member}}
	case "query", "cancel", "commit":
		if !validOperationID(*operationID) {
			fmt.Fprintln(c.stderr, "Use the original operation ID printed by cloud route.")
			return 2
		}
		path = "/v2/cloud/route/operations/" + *operationID
		if action == "cancel" {
			method = http.MethodDelete
		}
		if action == "commit" {
			var original rc.RouteOperation
			if err := ownerRuntimeRequest(ctx, layout.RuntimeControlSocketPath, http.MethodGet, path, struct{}{}, &original); err != nil {
				fmt.Fprintln(c.stderr, err)
				return 1
			}
			if original.State == "committed" {
				_ = json.NewEncoder(c.stdout).Encode(original)
				return 0
			}
			fmt.Fprintf(c.stdout, "Selected route: %s %s\n", original.Selection.Kind, original.Selection.MemberID)
			if !*yes && !c.confirmGatewayAction("Reconnect Cloud sessions through this route? Background tasks continue; Cloud identity and ownership remain.") {
				return 1
			}
			method, path, body = http.MethodPost, "/v2/cloud/route/commit", rc.RouteCommitRequest{OperationID: *operationID, Confirmed: true}
		}
	}
	var result json.RawMessage
	if err := ownerRuntimeRequest(ctx, layout.RuntimeControlSocketPath, method, path, body, &result); err != nil {
		fmt.Fprintln(c.stderr, err, "Query the original operation after an unknown result.")
		return 1
	}
	_ = json.NewEncoder(c.stdout).Encode(result)
	return 0
}

func validOperationID(id string) bool {
	raw, err := base64.RawURLEncoding.DecodeString(id)
	return err == nil && len(raw) == 32 && base64.RawURLEncoding.EncodeToString(raw) == id
}
