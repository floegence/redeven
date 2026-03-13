package codeapp

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
)

type controlplaneOrigin struct {
	scheme     string
	region     string
	baseDomain string
	port       string
}

func parseControlplaneBase(raw string) (controlplaneOrigin, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		// Local UI mode does not require a control plane. Keep the service usable
		// without a configured controlplane base.
		return controlplaneOrigin{}, nil
	}

	u, err := url.Parse(raw)
	if err != nil {
		return controlplaneOrigin{}, err
	}
	scheme := strings.ToLower(strings.TrimSpace(u.Scheme))
	if scheme != "http" && scheme != "https" {
		return controlplaneOrigin{}, fmt.Errorf("unsupported ControlplaneBaseURL scheme: %q", u.Scheme)
	}

	host := strings.ToLower(strings.TrimSpace(u.Hostname()))
	if host == "" {
		return controlplaneOrigin{}, errors.New("invalid ControlplaneBaseURL host")
	}

	labels := strings.Split(host, ".")
	if len(labels) < 3 {
		return controlplaneOrigin{}, errors.New("invalid ControlplaneBaseURL host: expected <region>.<base-domain>")
	}

	region := strings.TrimSpace(labels[0])
	baseDomain := strings.Join(labels[1:], ".")
	if region == "" || baseDomain == "" {
		return controlplaneOrigin{}, errors.New("invalid ControlplaneBaseURL host")
	}

	return controlplaneOrigin{
		scheme:     scheme,
		region:     region,
		baseDomain: baseDomain,
		port:       strings.TrimSpace(u.Port()),
	}, nil
}

func (o controlplaneOrigin) configured() bool {
	return strings.TrimSpace(o.scheme) != "" && strings.TrimSpace(o.region) != "" && strings.TrimSpace(o.baseDomain) != ""
}

func (o controlplaneOrigin) sandboxBaseDomain() string {
	if strings.TrimSpace(o.baseDomain) == "" {
		return ""
	}

	labels := strings.Split(o.baseDomain, ".")
	if len(labels) == 0 {
		return ""
	}

	first := strings.TrimSpace(labels[0])
	if first == "" {
		return ""
	}
	if !strings.HasSuffix(first, "-sandbox") {
		first += "-sandbox"
	}
	labels[0] = first
	return strings.Join(labels, ".")
}

func (o controlplaneOrigin) trustedLauncherOrigin(sandboxID string) (string, error) {
	if !o.configured() {
		return "", errors.New("controlplane base not configured")
	}

	sandboxID = strings.ToLower(strings.TrimSpace(sandboxID))
	if sandboxID == "" {
		return "", errors.New("missing sandboxID")
	}

	sandboxBaseDomain := strings.TrimSpace(o.sandboxBaseDomain())
	if sandboxBaseDomain == "" {
		return "", errors.New("invalid sandbox base domain")
	}

	host := fmt.Sprintf("%s.%s.%s", sandboxID, o.region, sandboxBaseDomain)
	if strings.TrimSpace(o.port) != "" {
		host += ":" + o.port
	}
	return fmt.Sprintf("%s://%s", o.scheme, host), nil
}
