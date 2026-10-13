package ai

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"path"
	"strings"
	"unicode"

	fltools "github.com/floegence/floret/v7/tools"
)

type computerAuthorizedTargetKey struct{}
type computerAuthorizedCandidateKey struct{}
type computerAuthorizedNavigationKey struct{}

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
		u, err := parseComputerNavigationURL(anyToString(inv.Args["url"]))
		if err != nil {
			return nil, errors.New("invalid browser navigation URL")
		}
		// Resource approval is scoped to the exact normalized destination. This
		// keeps file/data/about destinations usable without turning an opaque
		// origin into a wildcard grant.
		resources = append(resources, fltools.ResourceRef{Kind: "url", Value: normalizedComputerNavigationURL(u)})
	}
	return resources, nil
}

const maxComputerNavigationURLLength = 4096

func parseComputerNavigationURL(raw string) (*url.URL, error) {
	for _, r := range raw {
		if unicode.IsControl(r) {
			return nil, errors.New("URL contains control characters")
		}
	}
	value := strings.TrimSpace(raw)
	if value == "" || len(value) > maxComputerNavigationURLLength {
		return nil, errors.New("empty or oversized URL")
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return nil, errors.New("URL contains control characters")
		}
	}
	u, err := url.Parse(value)
	if err != nil || !u.IsAbs() || u.Scheme == "" {
		return nil, errors.New("URL must be absolute")
	}
	return u, nil
}

func normalizedComputerNavigationURL(u *url.URL) string {
	if u == nil {
		return ""
	}
	copy := *u
	// Never carry credentials into activity, approval or resource records.
	copy.User = nil
	copy.Scheme = strings.ToLower(copy.Scheme)
	copy.Host = strings.ToLower(copy.Host)
	if copy.Scheme == "file" {
		if copy.Host == "localhost" {
			copy.Host = ""
		}
		if copy.Path == "" {
			copy.Path = "/"
		}
		copy.Path = path.Clean(copy.Path)
		copy.RawPath = ""
	} else if copy.Host != "" && copy.Path == "" {
		copy.Path = "/"
	}
	return copy.String()
}
