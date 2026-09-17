package ai

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"

	fltools "github.com/floegence/floret/v7/tools"
)

type computerAuthorizedTargetKey struct{}
type computerAuthorizedCandidateKey struct{}

func floretComputerResources(r *run, inv fltools.Invocation[map[string]any]) ([]fltools.ResourceRef, error) {
	if inv.Name == "computer.targets" {
		return []fltools.ResourceRef{{Kind: "computer_inventory", Value: string(inv.ThreadID)}}, nil
	}
	if inv.Name == "computer.select_target" {
		host, ok := r.targetToolExecutor.(*ComputerUseRuntime)
		if !ok {
			return nil, errors.New("computer runtime is unavailable")
		}
		ref := strings.TrimSpace(anyToString(inv.Args["candidate_ref"]))
		if _, err := host.computerCandidate(string(inv.ThreadID), ref); err != nil {
			return nil, err
		}
		return []fltools.ResourceRef{{Kind: "computer_candidate", Value: ref}}, nil
	}

	if r.targetResolver == nil {
		return nil, errors.New("computer target resolver is unavailable")
	}
	alias := targetIDFromToolArgs(inv.Args)
	if alias == "" {
		alias = "current"
	}
	var target TargetDescriptor
	var err error
	if resolver, ok := r.targetResolver.(interface {
		ResolveTargetForThread(context.Context, string, string) (TargetDescriptor, error)
	}); ok {
		target, err = resolver.ResolveTargetForThread(context.Background(), string(inv.ThreadID), alias)
	} else {
		target, err = r.targetResolver.ResolveTarget(context.Background(), alias)
	}
	if err != nil {
		if errors.Is(err, errTargetNotRegistered) || errors.Is(err, errTargetAmbiguous) {
			return nil, fmt.Errorf("discover pages and windows with computer.targets, then select a candidate with computer.select_target: %w", err)
		}
		return nil, err
	}
	if !targetAllowedByPolicy(r.toolTargetPolicy, target.ID) {
		return nil, errors.New("computer target is not authorized")
	}
	resources := []fltools.ResourceRef{{Kind: "computer_target", Value: target.ID}}
	if inv.Name == "browser.navigate" {
		u, err := url.Parse(strings.TrimSpace(anyToString(inv.Args["url"])))
		if err != nil || u.Hostname() == "" || u.User != nil || (u.Scheme != "http" && u.Scheme != "https") {
			return nil, errors.New("invalid browser navigation URL")
		}
		resources = append(resources, fltools.ResourceRef{Kind: "url", Value: u.Scheme + "://" + u.Host})
	}
	return resources, nil
}
